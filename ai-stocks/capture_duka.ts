/**
 * Drive a real Chrome through Dukascopy's historical-data tool and capture the EXACT network
 * requests/responses that carry candle data — to find the (unblocked) web endpoint format.
 * Run: bunx playwright install chrome (once) ; bun run capture_duka.ts
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
});
const page = await ctx.newPage();

const dataReqs = new Set<string>();
page.on("request", (r) => {
  const u = r.url();
  if (/json3|candle|datafeed|historical|quotes?\/|stock|jsonp|interval=/i.test(u)) dataReqs.add(`${r.method()} ${u}`);
});
page.on("response", async (r) => {
  const u = r.url();
  if (/json3|candle|historical|quotes?\/|interval=/i.test(u)) {
    try {
      const t = await r.text();
      if (t && t.length > 5 && !/error|\[null\]/i.test(t.slice(0, 60))) {
        console.log(`DATA-RESP ${r.status()} ${u.slice(0, 160)}`);
        console.log(`  body: ${t.slice(0, 200).replace(/\s+/g, " ")}`);
      }
    } catch { /* ignore */ }
  }
});

console.log("loading Dukascopy historical tool...");
await page.goto("https://www.dukascopy.com/swiss/english/marketwatch/historical/", { waitUntil: "domcontentloaded", timeout: 40000 }).catch((e) => console.log("goto:", e.message));
await page.waitForTimeout(12000); // let the widget/iframe fire its data requests

console.log("\n=== candle/data requests the tool made ===");
for (const r of dataReqs) console.log(r);
await browser.close();
