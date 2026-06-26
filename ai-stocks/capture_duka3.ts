/**
 * Drive the Dukascopy historical-data-export widget to perform a real NVDA export and capture the
 * exact jetta.dukascopy.com request + any CSV download. Reveals the (reachable, unblocked) export
 * endpoint and whether the CSV is generated server-side (bypassing our datafeed IP-block).
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

const jettaReqs: string[] = [];
page.on("request", (r) => {
  const u = r.url();
  if (/jetta\.dukascopy\.com/i.test(u) && !/\/instruments(\?|$|\/rating)/i.test(u)) {
    let body = "";
    try { body = r.postData()?.slice(0, 200) ?? ""; } catch { body = ""; }
    jettaReqs.push(`${r.method()} ${u}${body ? `  BODY=${body}` : ""}`);
  }
});
page.on("response", async (r) => {
  const u = r.url();
  if (/jetta\.dukascopy\.com/i.test(u) && /(csv|octet|export|history|candle|chart)/i.test(u)) {
    try { console.log(`RESP ${r.status()} ${u.slice(0, 140)} -> ${(await r.text()).slice(0, 160).replace(/\s+/g, " ")}`); } catch (e) { console.log("resp read:", (e as Error).message); }
  }
});
page.on("download", async (d) => {
  console.log(`DOWNLOAD ${d.suggestedFilename()} from ${d.url().slice(0, 120)}`);
  try { const p = `/tmp/duka_export_${d.suggestedFilename()}`; await d.saveAs(p); console.log(`  saved -> ${p}`); } catch (e) { console.log("dl:", (e as Error).message); }
});

try {
  await page.goto("https://widgets.dukascopy.com/en/historical-data-export", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);
  // pick a stock
  const search = page.getByPlaceholder("Search instrument");
  await search.click();
  await search.fill("NVDA");
  await page.waitForTimeout(2500);
  // click the NVDA result
  await page.getByText("NVDA.US/USD", { exact: false }).first().click({ timeout: 8000 }).catch((e) => console.log("pick NVDA:", (e as Error).message));
  await page.waitForTimeout(2500);
  // click Export (use defaults — we just need the endpoint)
  await page.getByRole("button", { name: /export/i }).first().click({ timeout: 8000 }).catch((e) => console.log("export click:", (e as Error).message));
  await page.waitForTimeout(9000);
} catch (e) {
  console.log("flow error:", (e as Error).message);
}

console.log("\n=== jetta (non-instruments) requests during export flow ===");
for (const r of Array.from(new Set(jettaReqs))) console.log(r);
await browser.close();
