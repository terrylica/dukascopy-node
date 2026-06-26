/**
 * Fetch AUTHORITATIVE market cap + average volume for the 28 US stock names from Nasdaq's own API
 * (api.nasdaq.com — the exchange's data, covers NYSE listings too). Replaces hand-curated guesses.
 * Computes: mcapUsdB = MarketCap/1e9 ; advUsdB = AverageVolume(shares) x lastSalePrice / 1e9.
 * Writes fundamentals.json with values + source + as-of date. Gentle pacing; retries.
 * PROCESS-STORM-OK: sequential fetch only, no subprocess spawning.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const INSTR = JSON.parse(readFileSync(join(HERE, "instruments.json"), "utf8")) as {
  instruments: Array<{ ticker: string; is_bonus_etf: boolean }>;
};
const tickers = INSTR.instruments.filter((i) => !i.is_bonus_etf).map((i) => i.ticker);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (s: string | undefined) => (s && s !== "N/A" ? Number(s.replace(/[$,]/g, "")) : NaN);

async function getJson(url: string): Promise<any> {
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) throw new Error("429");
      return await r.json();
    } catch (e) { if (a === 4) throw e; await sleep(1500 * a); }
  }
}

const data: Record<string, { mcapUsdB: number; advUsdB: number; marketCap: number; avgVolume: number; price: number }> = {};
let isoNow = "";
for (const [i, t] of tickers.entries()) {
  try {
    const info = await getJson(`https://api.nasdaq.com/api/quote/${t}/info?assetclass=stocks`);
    await sleep(450);
    const summ = await getJson(`https://api.nasdaq.com/api/quote/${t}/summary?assetclass=stocks`);
    const price = num(info?.data?.primaryData?.lastSalePrice);
    const mcap = num(summ?.data?.summaryData?.MarketCap?.value);
    const avgVol = num(summ?.data?.summaryData?.AverageVolume?.value);
    isoNow = info?.data?.primaryData?.lastTradeTimestamp ?? isoNow;
    if (!Number.isFinite(mcap) || !Number.isFinite(avgVol) || !Number.isFinite(price)) {
      console.log(`${t.padEnd(6)} INCOMPLETE mcap=${mcap} avgVol=${avgVol} price=${price}`);
    } else {
      data[t] = {
        mcapUsdB: Math.round(mcap / 1e9),
        advUsdB: Math.round((avgVol * price) / 1e9 * 10) / 10,
        marketCap: mcap, avgVolume: avgVol, price,
      };
      console.log(`${t.padEnd(6)} mcap=$${(mcap / 1e9).toFixed(0)}B adv=$${data[t].advUsdB}B (px $${price}, avgVol ${(avgVol / 1e6).toFixed(1)}M) [${i + 1}/${tickers.length}]`);
    }
  } catch (e) { console.log(`${t.padEnd(6)} FAIL ${(e as Error).message}`); }
  await sleep(550);
}

const out = {
  source: "Nasdaq (api.nasdaq.com) — exchange market data; covers NYSE & Nasdaq listings",
  as_of: isoNow || "see generated_utc",
  fields: { mcapUsdB: "market capitalization, USD billions", advUsdB: "avg daily $ volume = AverageVolume(shares) x last price, USD billions" },
  count: Object.keys(data).length,
  data,
};
writeFileSync(join(HERE, "fundamentals.json"), JSON.stringify(out, null, 2));
console.log(`\nwrote fundamentals.json — ${out.count}/${tickers.length} tickers, as-of ${out.as_of}`);
