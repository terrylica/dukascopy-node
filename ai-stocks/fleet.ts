/**
 * Parallel spot-fleet fetcher — one cheap t4g.nano per stock, each with a FRESH IP that
 * fits a single Dukascopy fast-window. Each instance self-provisions (bun), fetches its
 * stock's full history (bid+ask, all years), uploads a tarball to S3 via a PRESIGNED PUT URL
 * (no creds on the instance), and self-terminates. No SSH needed.
 *
 * Usage: AWS_PROFILE=el-dev bun run fleet.ts [TICKER ...]   (default: all in instruments.json)
 * Then:  AWS_PROFILE=el-dev bun run fleet_collect.ts
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION ?? "us-west-2";
const PROFILE = process.env.AWS_PROFILE ?? "el-dev";
const BUCKET = process.env.BUCKET ?? "terryli-dukascopy-ai-stocks";
const AMI = "ami-0decb2fdb9992e37d"; // Ubuntu 24.04 ARM
const SUBNET = "subnet-f63de0bc";
const SG = "sg-0f2704d85381caf23";
const KEY = "el-dev";
const TYPE = process.env.ITYPE ?? "t4g.nano";

const instr = JSON.parse(await Bun.file(new URL("./instruments.json", import.meta.url)).text());
const want = Bun.argv.slice(2);
const picks = instr.instruments.filter((r: any) => want.length === 0 || want.includes(r.ticker));

const s3 = new S3Client({ region: REGION });
const presignPut = (key: string) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 21600 });

function userData(t: string, iid: string, from: string, putData: string, putLog: string): string {
  return `#!/bin/bash
mkdir -p /home/ubuntu/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOyDudT6A4Fng2ctG+NJ67ITMRqA+/EWvf1wA5Bx4BLZ terry@eonlabs.com' >> /home/ubuntu/.ssh/authorized_keys
chmod 700 /home/ubuntu/.ssh; chmod 600 /home/ubuntu/.ssh/authorized_keys; chown -R ubuntu:ubuntu /home/ubuntu/.ssh
exec > /var/log/fleet.log 2>&1; set -x
export HOME=/root DEBIAN_FRONTEND=noninteractive PATH=/root/.bun/bin:$PATH
apt-get update -y; apt-get install -y unzip curl
curl -fsSL https://bun.sh/install | bash
export PATH=/root/.bun/bin:$PATH
TICKER='${t}'; IID='${iid}'; FROM='${from}'
TODAY=$(date +%F); ENDY=\${TODAY:0:4}; SY=\${FROM:0:4}
mkdir -p /data/$TICKER
for side in bid ask; do
  for ((y=SY; y<=ENDY; y++)); do
    yf=$y-01-01; [ $y -eq $SY ] && yf=$FROM
    yt=$y-12-31; [ $y -eq $ENDY ] && yt=$TODAY
    out=/data/$TICKER/\${IID}-m5-\${side}-\${y}.csv
    best=0
    for attempt in 1 2 3 4; do
      rm -rf /tmp/t; mkdir -p /tmp/t
      timeout 300 bunx dukascopy-node@1.46.4 -i $IID -from $yf -to $yt -t m5 -p $side -v -f csv -df "YYYY-MM-DD HH:mm:ss" -dir /tmp/t --cache -bs 20 -bp 80 -r 5 -rp 800 -re
      f=$(ls /tmp/t/*.csv 2>/dev/null | head -1)
      if [ -s "$f" ]; then rows=$(wc -l < "$f"); if [ "$rows" -gt "$best" ]; then mv "$f" "$out"; best=$rows; fi; fi
      [ "$best" -gt 0 ] && break
      sleep 3
    done
  done
done
cd /data && tar czf /tmp/$TICKER.tar.gz $TICKER
curl -sS -X PUT --upload-file /tmp/$TICKER.tar.gz "${putData}"
curl -sS -X PUT --upload-file /var/log/fleet.log "${putLog}"
shutdown -h now
`;
}

const tmp = mkdtempSync(join(tmpdir(), "fleet-"));
const launched: string[] = [];
for (const r of picks) {
  const putData = await presignPut(`incoming/${r.ticker}.tar.gz`);
  const putLog = await presignPut(`incoming/${r.ticker}.log`);
  const ud = userData(r.ticker, r.instrument_id, r.from_date, putData, putLog);
  const udFile = join(tmp, `${r.ticker}.sh`);
  writeFileSync(udFile, ud);
  const cmd = [
    "aws ec2 run-instances", `--region ${REGION}`, `--profile ${PROFILE}`,
    `--image-id ${AMI}`, `--instance-type ${TYPE}`, "--count 1",
    `--subnet-id ${SUBNET}`, `--security-group-ids ${SG}`, `--key-name ${KEY}`,
    "--instance-initiated-shutdown-behavior terminate",
    // on-demand by default (spot capacity for nano is flaky); SPOT=1 to use spot
    process.env.SPOT === "1" ? `--instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time"}}'` : "",
    `--block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":8,"DeleteOnTermination":true,"VolumeType":"gp3"}}]'`,
    `--tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=aistk-${r.ticker}},{Key=fleet,Value=aistk}]'`,
    `--user-data file://${udFile}`,
    "--query 'Instances[0].InstanceId' --output text",
  ].join(" ");
  try {
    const id = execSync(cmd, { encoding: "utf8" }).trim();
    launched.push(`${r.ticker}=${id}`);
    console.log(`launched ${r.ticker} -> ${id}`);
  } catch (e: any) {
    console.error(`FAILED ${r.ticker}: ${e.message?.split("\n")[0]}`);
  }
}
console.log(`\n${launched.length}/${picks.length} instances launched. Collect with fleet_collect.ts`);
