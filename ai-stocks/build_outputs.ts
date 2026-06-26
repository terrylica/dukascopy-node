/**
 * Phase 2 — turn raw Dukascopy m5 bid/ask CSVs into the deliverable file set + manifest.json.
 *
 * Per ticker (from instruments.json), concatenating the per-year raw files in raw/<ticker>/:
 *   - merged CSV : ts + bid_* + ask_* + mid_*  (mid OHLC = (bid+ask)/2)
 *   - bid CSV / ask CSV (passthrough OHLCV)
 *   - per-ticker zip <ticker>-m5.zip {merged, bid, ask, README, DATA_DICTIONARY}
 *   - SHA256 for every published artifact
 * Then one grand bundle (ai-stocks-m5-all.zip) + CHECKSUMS.txt + manifest.json.
 *
 * Invariants (HARD FAIL): timestamps unique + monotonic per side; OHLC consistency
 * (high>=max(o,c,l), low<=min(o,c,h)); ask>=bid on close for >=99% of bars (CFD sanity).
 *
 * Libraries: fflate (SOTA pure-TS zip/gzip), node:crypto (sha256). Run: bun run build_outputs.ts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, zipSync } from "fflate";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const BUILD = join(HERE, "build");
const INSTR = JSON.parse(readFileSync(join(HERE, "instruments.json"), "utf8"));

const OHLCV = ["open", "high", "low", "close", "volume"] as const;
const FMT = "%Y-%m-%d %H:%M:%S";

const DATA_DICTIONARY = `DATA DICTIONARY — Dukascopy 5-minute OHLCV (AI US stocks)
=========================================================
Source : Dukascopy stock-CFD price feed via the freeserv chart API (json3).
Prices : SPLIT-ADJUSTED (corporate splits back-applied for a continuous series).
Bars   : 5-minute aggregates. Timestamps are the bar OPEN, in UTC (YYYY-MM-DD HH:MM:SS).
Note   : Dukascopy provides QUOTES (bid/ask), not exchange trades. There is no
         consolidated-tape volume; the volume column is Dukascopy's INDICATIVE CFD
         volume, useful for relative activity only.

MERGED columns:
  ts                       bar open time, UTC
  bid_open/high/low/close  bid-side OHLC price
  bid_volume               bid-side indicative volume
  ask_open/high/low/close  ask-side OHLC price
  ask_volume               ask-side indicative volume
  mid_open/high/low/close  (bid + ask) / 2, computed per OHLC field

BID / ASK files columns:
  ts, open, high, low, close, volume   (single side)
`;

interface Bar { ts: string; open: number; high: number; low: number; close: number; volume: number; }

const sha256 = (buf: Uint8Array | string): string => createHash("sha256").update(buf).digest("hex");
const enc = new TextEncoder();

/** Read + concat all per-year CSVs for one side; validate; return bars sorted by ts. */
function loadSide(tickerDir: string, iid: string, side: string): Bar[] | null {
  const files = readdirSync(tickerDir)
    .filter((f) => f.startsWith(`${iid}-m5-${side}-`) && f.endsWith(".csv"))
    .toSorted();
  if (files.length === 0) return null;

  const seen = new Set<string>();
  const raw: Bar[] = [];
  for (const f of files) {
    const text = readFileSync(join(tickerDir, f), "utf8").trim();
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const [ts, o, h, l, c, v] = line.split(",");
      if (seen.has(ts)) continue; // de-dup across year-boundary overlaps
      seen.add(ts);
      raw.push({ ts, open: +o, high: +h, low: +l, close: +c, volume: +v });
    }
  }
  const bars = raw.toSorted((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // invariants
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].ts <= bars[i - 1].ts) throw new Error(`${iid} ${side}: ts not strictly increasing at ${bars[i].ts}`);
  }
  for (const b of bars) {
    if (b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high)) {
      throw new Error(`${iid} ${side}: OHLC inconsistency at ${b.ts}`);
    }
  }
  return bars;
}

const csvFromRows = (header: string, rows: string[]): Uint8Array =>
  enc.encode(header + "\n" + rows.join("\n") + "\n");

function buildTicker(rec: Record<string, string>): Record<string, unknown> | null {
  const ticker = rec.ticker, iid = rec.instrument_id;
  const tdir = join(RAW, ticker);
  if (!existsSync(tdir)) { console.log(`  SKIP ${ticker}: no raw dir`); return null; }
  const bid = loadSide(tdir, iid, "bid");
  const ask = loadSide(tdir, iid, "ask");
  if (!bid || !ask) { console.log(`  SKIP ${ticker}: missing ${!bid ? "bid" : ""} ${!ask ? "ask" : ""} raw`); return null; }

  const askByTs = new Map(ask.map((b) => [b.ts, b]));
  const mergedRows: string[] = [];
  const bidRows: string[] = [];
  const askRows: string[] = [];
  let negSpread = 0, n = 0;
  let dmin = "", dmax = "";
  const midCloseSeries: number[] = [];

  for (const b of bid) {
    const a = askByTs.get(b.ts);
    if (!a) continue; // inner join
    n++;
    if (a.close < b.close) negSpread++;
    if (!dmin) dmin = b.ts;
    dmax = b.ts;
    const mid = (k: "open" | "high" | "low" | "close") => Math.round(((b[k] + a[k]) / 2) * 1e5) / 1e5;
    midCloseSeries.push(mid("close"));
    mergedRows.push([b.ts,
      b.open, b.high, b.low, b.close, b.volume,
      a.open, a.high, a.low, a.close, a.volume,
      mid("open"), mid("high"), mid("low"), mid("close")].join(","));
    bidRows.push([b.ts, b.open, b.high, b.low, b.close, b.volume].join(","));
    askRows.push([a.ts, a.open, a.high, a.low, a.close, a.volume].join(","));
  }
  if (n === 0) { console.log(`  SKIP ${ticker}: no overlapping bars`); return null; }
  if (negSpread / n >= 0.01) throw new Error(`${ticker}: ${negSpread}/${n} bars ask<bid close (>1%)`);

  const out = join(BUILD, ticker);
  mkdirSync(out, { recursive: true });

  const mergedHeader = "ts,bid_open,bid_high,bid_low,bid_close,bid_volume," +
    "ask_open,ask_high,ask_low,ask_close,ask_volume,mid_open,mid_high,mid_low,mid_close";
  const sideHeader = "ts,open,high,low,close,volume";

  const mergedCsv = csvFromRows(mergedHeader, mergedRows);
  const bidCsv = csvFromRows(sideHeader, bidRows);
  const askCsv = csvFromRows(sideHeader, askRows);
  const readme = enc.encode(
    `${ticker} — ${rec.description}\n` +
    `Dukascopy instrument: ${rec.dukascopy_title} (id ${iid})\n` +
    `5-minute OHLCV, bid & ask & mid. UTC. ${n.toLocaleString()} bars ${dmin.slice(0, 10)} .. ${dmax.slice(0, 10)}.\n` +
    `AI thesis: ${rec.ai_thesis}\n\n${DATA_DICTIONARY}`);
  const ddict = enc.encode(DATA_DICTIONARY);

  // write plain CSVs (for analysts) + the user-facing zip
  writeFileSync(join(out, `${ticker}-m5-merged.csv`), mergedCsv);
  writeFileSync(join(out, `${ticker}-m5-bid.csv`), bidCsv);
  writeFileSync(join(out, `${ticker}-m5-ask.csv`), askCsv);

  const zipBytes = zipSync({
    [`${ticker}-m5-merged.csv`]: mergedCsv,
    [`${ticker}-m5-bid.csv`]: bidCsv,
    [`${ticker}-m5-ask.csv`]: askCsv,
    "README.txt": readme,
    "DATA_DICTIONARY.txt": ddict,
  }, { level: 9 });
  const zipName = `${ticker}-m5.zip`;
  writeFileSync(join(out, zipName), zipBytes);

  // also a gzipped merged CSV for streaming analysts
  const gzName = `${ticker}-m5-merged.csv.gz`;
  const gzBytes = gzipSync(mergedCsv, { level: 9 });
  writeFileSync(join(out, gzName), gzBytes);

  const artifacts = [
    { name: zipName, kind: "zip", bytes: zipBytes.length, sha256: sha256(zipBytes), rel: `${ticker}/${zipName}` },
    { name: gzName, kind: "gz", bytes: gzBytes.length, sha256: sha256(gzBytes), rel: `${ticker}/${gzName}` },
  ];
  // downsample mid-close to ~48 points for the page sparkline
  const SPARK_N = 48;
  const step = Math.max(1, Math.floor(midCloseSeries.length / SPARK_N));
  const spark: number[] = [];
  for (let i = 0; i < midCloseSeries.length; i += step) spark.push(Math.round(midCloseSeries[i] * 100) / 100);

  console.log(`  OK ${ticker.padEnd(6)} ${String(n).padStart(7)} bars  ${dmin.slice(0, 10)}..${dmax.slice(0, 10)}  zip=${Math.round(zipBytes.length / 1024)}KB`);
  return {
    ticker, instrument_id: iid, dukascopy_title: rec.dukascopy_title, description: rec.description,
    category: rec.category, ai_thesis: rec.ai_thesis, is_bonus_etf: rec.is_bonus_etf,
    bars: n, date_start: dmin, date_end: dmax, primary_zip: zipName, spark, artifacts,
  };
}

function main(): void {
  mkdirSync(BUILD, { recursive: true });
  const built: Record<string, unknown>[] = [];
  for (const rec of INSTR.instruments) {
    const r = buildTicker(rec);
    if (r) built.push(r);
  }
  if (built.length === 0) throw new Error("No tickers built (raw fetch incomplete?).");

  // grand bundle of all per-ticker zips
  const grandEntries: Record<string, Uint8Array> = {};
  for (const r of built) {
    const t = r.ticker as string;
    grandEntries[`${t}/${r.primary_zip}`] = readFileSync(join(BUILD, t, r.primary_zip as string));
  }
  const grandBytes = zipSync(grandEntries, { level: 9 });
  writeFileSync(join(BUILD, "ai-stocks-m5-all.zip"), grandBytes);
  const grand = { name: "ai-stocks-m5-all.zip", kind: "zip", bytes: grandBytes.length, sha256: sha256(grandBytes), rel: "ai-stocks-m5-all.zip" };

  const checks: string[] = [];
  for (const r of built) for (const a of r.artifacts as { sha256: string; rel: string }[]) checks.push(`${a.sha256}  ${a.rel}`);
  checks.push(`${grand.sha256}  ${grand.name}`);
  writeFileSync(join(BUILD, "CHECKSUMS.txt"), checks.join("\n") + "\n");

  const manifest = {
    generated_utc: new Date().toISOString().replace("T", " ").slice(0, 19),
    source: INSTR.source,
    timeframe: "m5 (5-minute OHLCV)",
    price_sides: ["bid", "ask", "mid (computed)"],
    note: INSTR.note,
    grand_bundle: grand,
    stocks: built,
  };
  writeFileSync(join(BUILD, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nBuilt ${built.length} instruments. Grand bundle ${Math.round(grandBytes.length / 1024 / 1024)}MB. manifest.json + CHECKSUMS.txt -> ${BUILD}`);
}

main();
