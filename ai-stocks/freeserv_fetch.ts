/**
 * Fetch 5-min bid+ask OHLCV for the AI stock universe from Dukascopy's freeserv json3 chart API
 * (https://freeserv.dukascopy.com/2.0/index.php?path=chart/json3). freeserv generates the JSON
 * SERVER-SIDE from its own archive, so our IP never touches the rate-blocked datafeed CDN — this
 * bypasses the block entirely. Free, no auth, split-adjusted, bid (B) and ask (A), deep history.
 *
 * Output matches the dukascopy-node pipeline exactly: raw/<TICKER>/<iid>-m5-<side>-<year>.csv,
 * header `timestamp,open,high,low,close,volume`, UTC `YYYY-MM-DD HH:mm:ss`, so build_outputs.ts
 * ingests it unchanged.
 *
 * Usage:  bun run freeserv_fetch.ts [TICKER]   (TICKER optional: single-stock test; default all)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ALIGN = 300_000; // 5 min in ms
const PAGE = 6000; // candles per request (freeserv allows 6000+)
const PAUSE_MS = 450; // gentle pacing between requests
const MAX_PAGES = 400; // safety cap per side
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const REFERER = "https://eu-demo.dukascopy.com/web-platform/";

type Candle = [number, number, number, number, number, number]; // ts,o,h,l,c,v

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alignFloor = (ms: number) => Math.floor(ms / ALIGN) * ALIGN;
const fmtTs = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

interface Instr { ticker: string; instrument_id: string; dukascopy_title: string; from_date: string }
const INSTR = JSON.parse(readFileSync(join(HERE, "instruments.json"), "utf8")) as { instruments: Instr[] };

async function fetchPage(title: string, side: "B" | "A", anchorMs: number): Promise<Candle[]> {
  const qs = new URLSearchParams({
    path: "chart/json3", instrument: title, offer_side: side, interval: "5MIN",
    splits: "true", limit: String(PAGE), time_direction: "P", timestamp: String(anchorMs), jsonp: "cb",
  });
  const url = `https://freeserv.dukascopy.com/2.0/index.php?${qs.toString()}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Referer: REFERER }, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      const m = text.match(/^cb\((.*)\);?\s*$/s);
      if (!m) throw new Error(`unparseable: ${text.slice(0, 80)}`);
      if (/error\(/.test(text)) throw new Error("freeserv error([null])");
      return JSON.parse(m[1]) as Candle[];
    } catch (e) {
      if (attempt === 5) { console.error(`    page fail (${side}) @${anchorMs}: ${(e as Error).message}`); return []; }
      await sleep(1500 * attempt);
    }
  }
  return [];
}

async function fetchSide(title: string, side: "B" | "A", fromMs: number): Promise<Map<number, Candle>> {
  const out = new Map<number, Candle>();
  let anchor = alignFloor(Date.now());
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await fetchPage(title, side, anchor);
    if (page.length === 0) break;
    let oldest = anchor;
    for (const c of page) { out.set(c[0], c); if (c[0] < oldest) oldest = c[0]; }
    if (oldest <= fromMs) break;
    if (oldest >= anchor) break; // no progress
    anchor = oldest; // next page ends just before the oldest we have
    await sleep(PAUSE_MS);
  }
  return out;
}

function writeYearCsvs(ticker: string, iid: string, side: "bid" | "ask", candles: Candle[], fromMs: number) {
  const dir = join(HERE, "raw", ticker);
  mkdirSync(dir, { recursive: true });
  const byYear = new Map<number, string[]>();
  for (const x of candles.filter((k) => k[0] >= fromMs).toSorted((a, b) => a[0] - b[0])) {
    const year = new Date(x[0]).getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)?.push(`${fmtTs(x[0])},${x[1]},${x[2]},${x[3]},${x[4]},${x[5]}`);
  }
  let total = 0;
  for (const [year, rows] of byYear) {
    const f = join(dir, `${iid}-m5-${side}-${year}.csv`);
    writeFileSync(f, `timestamp,open,high,low,close,volume\n${rows.join("\n")}\n`);
    total += rows.length;
  }
  return total;
}

const only = process.argv[2]?.toUpperCase();
const targets = INSTR.instruments.filter((i) => !only || i.ticker.toUpperCase() === only);
console.log(`freeserv fetch: ${targets.length} instrument(s)${only ? ` (filter=${only})` : ""}`);

for (const [idx, inst] of targets.entries()) {
  const fromMs = new Date(`${inst.from_date}T00:00:00Z`).getTime();
  console.log(`[${idx + 1}/${targets.length}] ${inst.ticker} (${inst.dukascopy_title}) from ${inst.from_date}`);
  for (const [side, name] of [["B", "bid"], ["A", "ask"]] as const) {
    const map = await fetchSide(inst.dukascopy_title, side, fromMs);
    const rows = writeYearCsvs(inst.ticker, inst.instrument_id, name, Array.from(map.values()), fromMs);
    console.log(`    ${name}: ${rows} rows`);
    await sleep(PAUSE_MS);
  }
}
console.log("freeserv fetch: DONE");
