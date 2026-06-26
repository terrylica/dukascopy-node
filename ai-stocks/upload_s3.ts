/**
 * Phase 3 — upload the built data pack to a dedicated PUBLIC-READ S3 bucket and
 * write permanent public URLs back into manifest.json.
 *
 * Credentials: standard AWS env/profile chain. Use the working el-dev profile
 * (account 050214414362, user terryli — Doppler's aws-credentials keys are stale):
 *   AWS_PROFILE=el-dev bun run upload_s3.ts
 *
 * Env overrides: BUCKET (default terryli-dukascopy-ai-stocks), AWS_REGION (default us-west-2),
 *                PREFIX (default v1), DRY_RUN=1 (skip mutations, just print the plan).
 *
 * Public links are durable (the page just works); the data is public market data.
 * Library: @aws-sdk/client-s3 (official AWS SDK v3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand,
  PutObjectCommand, PutPublicAccessBlockCommand, S3Client,
} from "@aws-sdk/client-s3";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "build");
const BUCKET = process.env.BUCKET ?? "terryli-dukascopy-ai-stocks";
const REGION = process.env.AWS_REGION ?? "us-west-2";
const PREFIX = process.env.PREFIX ?? "v1";
const DRY = process.env.DRY_RUN === "1";

const CT: Record<string, string> = {
  zip: "application/zip", gz: "application/gzip",
  json: "application/json", txt: "text/plain; charset=utf-8",
};
const ext = (k: string) => k.split(".").pop()!.toLowerCase();
const publicUrl = (key: string) => `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

const s3 = new S3Client({ region: REGION });

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`bucket exists: ${BUCKET}`);
  } catch {
    console.log(`creating bucket: ${BUCKET} (${REGION})`);
    if (DRY) return;
    await s3.send(new CreateBucketCommand({
      Bucket: BUCKET,
      ...(REGION === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: REGION as never } }),
    }));
  }
  if (DRY) return;
  // allow public read (modern path: bucket policy, not object ACLs)
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true,
      BlockPublicPolicy: false, RestrictPublicBuckets: false,
    },
  }));
  await s3.send(new PutBucketPolicyCommand({
    Bucket: BUCKET,
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Sid: "PublicReadGetObject", Effect: "Allow", Principal: "*",
        Action: "s3:GetObject", Resource: `arn:aws:s3:::${BUCKET}/*`,
      }],
    }),
  }));
  console.log("public-read policy applied");
}

async function put(key: string, body: Uint8Array): Promise<string> {
  if (!DRY) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body,
      ContentType: CT[ext(key)] ?? "application/octet-stream",
      CacheControl: "public, max-age=86400",
    }));
  }
  return publicUrl(key);
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(BUILD, "manifest.json"), "utf8"));
  await ensureBucket();

  // per-ticker artifacts
  for (const st of manifest.stocks) {
    for (const a of st.artifacts) {
      const key = `${PREFIX}/${a.rel}`;
      a.s3_url = await put(key, readFileSync(join(BUILD, a.rel)));
      console.log(`  ↑ ${key}`);
    }
  }
  // grand bundle + manifest + checksums
  manifest.grand_bundle.s3_url = await put(`${PREFIX}/${manifest.grand_bundle.name}`, readFileSync(join(BUILD, manifest.grand_bundle.name)));
  await put(`${PREFIX}/CHECKSUMS.txt`, readFileSync(join(BUILD, "CHECKSUMS.txt")));
  manifest.s3 = { bucket: BUCKET, region: REGION, prefix: PREFIX, base_url: publicUrl(`${PREFIX}/`) };

  writeFileSync(join(BUILD, "manifest.json"), JSON.stringify(manifest, null, 2));
  // also upload the URL-enriched manifest
  await put(`${PREFIX}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  console.log(`\n${DRY ? "[DRY] " : ""}done. base: ${manifest.s3.base_url}`);
}

main();
