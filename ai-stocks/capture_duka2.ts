/**
 * Discovery: load the Dukascopy historical-data-export widget directly and dump its interactive
 * controls + any data/download network activity. Determines whether the CSV export is server-side
 * (which would bypass our datafeed IP-block entirely).
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

page.on("response", (r) => {
  const u = r.url();
  const ct = r.headers()["content-type"] ?? "";
  if (/dukascopy\.com/i.test(u) && /(csv|octet-stream|json|text\/plain)/i.test(ct) && !/\.(js|css|woff2?|svg|png)/i.test(u)) {
    console.log(`NET ${r.status()} [${ct}] ${u.slice(0, 160)}`);
  }
});
page.on("download", (d) => console.log(`DOWNLOAD: ${d.suggestedFilename()} from ${d.url().slice(0, 120)}`));

try {
  await page.goto("https://widgets.dukascopy.com/en/historical-data-export", { waitUntil: "networkidle", timeout: 45000 });
} catch (e) {
  console.log("goto:", (e as Error).message);
}
await page.waitForTimeout(6000);

const controls = await page.evaluate(() => {
  const d = (globalThis as { document?: { querySelectorAll: (s: string) => unknown[] } }).document;
  if (!d) return [];
  const out: string[] = [];
  for (const elU of Array.from(d.querySelectorAll("input,select,button,[role=button],[role=combobox],mat-select,mat-form-field,a"))) {
    const el = elU as { innerText?: string; placeholder?: string; getAttribute: (a: string) => string | null; tagName: string };
    const t = el.innerText?.trim().slice(0, 50) || "";
    const ph = el.placeholder || "";
    const aria = el.getAttribute("aria-label") || "";
    const label = [t, ph, aria].filter(Boolean).join(" | ");
    if (label) out.push(`${el.tagName.toLowerCase()}: ${label}`);
  }
  return out.slice(0, 45);
});
console.log("\n=== widget controls ===");
for (const c of controls) console.log(c);
await browser.close();
