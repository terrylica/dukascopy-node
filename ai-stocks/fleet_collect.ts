/**
 * Collect spot-fleet results: poll s3://BUCKET/incoming/<ticker>.tar.gz, download + extract each
 * into raw/<ticker>/ as it appears, until all expected tickers arrive or the timeout elapses.
 *
 * Usage: AWS_PROFILE=el-dev bun run fleet_collect.ts [TICKER ...]   (default: all in instruments.json)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REGION = process.env.AWS_REGION ?? "us-west-2";
const PROFILE = process.env.AWS_PROFILE ?? "el-dev";
const BUCKET = process.env.BUCKET ?? "terryli-dukascopy-ai-stocks";
const TIMEOUT_MIN = Number(process.env.TIMEOUT_MIN ?? 30);

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const instr = JSON.parse(await Bun.file(join(HERE, "instruments.json")).text());
const want = Bun.argv.slice(2);
const tickers: string[] = instr.instruments
  .map((r: any) => r.ticker)
  .filter((t: string) => want.length === 0 || want.includes(t));

const aws = (args: string) => execSync(`aws ${args} --region ${REGION} --profile ${PROFILE}`, { encoding: "utf8" });
const sh = (c: string) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
mkdirSync(RAW, { recursive: true });

const pending = new Set(tickers);
const done = new Set<string>();
const deadline = Date.now() + TIMEOUT_MIN * 60_000;
console.log(`collecting ${pending.size} tickers (timeout ${TIMEOUT_MIN}m)...`);

while (pending.size > 0 && Date.now() < deadline) {
  let listing = "";
  try { listing = aws(`s3 ls s3://${BUCKET}/incoming/`); } catch { /* keep polling */ }
  for (const t of Array.from(pending)) {
    if (!listing.includes(`${t}.tar.gz`)) continue;
    try {
      const tgz = `/tmp/${t}.tar.gz`;
      aws(`s3 cp s3://${BUCKET}/incoming/${t}.tar.gz ${tgz}`);
      sh(`tar xzf ${tgz} -C ${RAW}`);
      pending.delete(t); done.add(t);
      const n = sh(`find ${join(RAW, t)} -name '*.csv' | wc -l`).trim();
      console.log(`  ✓ ${t} (${n} chunks)  [${done.size}/${tickers.length}]`);
    } catch (e: any) {
      console.error(`  ! ${t} extract failed: ${e.message?.split("\n")[0]}`);
    }
  }
  if (pending.size > 0) await Bun.sleep(20_000);
}

console.log(`\ncollected ${done.size}/${tickers.length}.`);
if (pending.size) console.log(`MISSING (check s3 incoming/<ticker>.log): ${[...pending].join(", ")}`);
