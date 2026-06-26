/**
 * Render the live AI-stocks page at desktop/tablet/mobile widths, screenshot full-page, and report
 * layout diagnostics (horizontal overflow, element counts) for the CEO-grade aesthetic audit.
 */
import { chromium } from "playwright";

const URL = process.env.PAGE_URL ?? "https://eon.25u.com/ai-stocks/";
const views = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true, channel: "chrome" });
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  const diag = await page.evaluate(() => {
    const d = (globalThis as { document?: { documentElement: { scrollWidth: number; clientWidth: number }; querySelectorAll(s: string): ArrayLike<unknown>; title: string } }).document;
    if (!d) return {};
    const de = d.documentElement;
    // find elements wider than viewport (overflow culprits)
    const over: string[] = [];
    const w = de.clientWidth;
    for (const elU of Array.from(d.querySelectorAll("*"))) {
      const el = elU as { getBoundingClientRect(): { right: number; left: number; width: number }; tagName: string; className?: string };
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 || r.left < -1) {
        const cls = typeof el.className === "string" ? el.className : "";
        over.push(`${el.tagName}.${cls}`.slice(0, 60));
      }
    }
    return {
      title: d.title,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      hOverflow: de.scrollWidth > de.clientWidth,
      tables: d.querySelectorAll("table").length,
      overflowers: Array.from(new Set(over)).slice(0, 15),
    };
  });
  await page.screenshot({ path: `/tmp/aistk_${v.name}.png`, fullPage: true });
  console.log(`\n=== ${v.name} (${v.width}px) ===`);
  console.log(JSON.stringify(diag, null, 1));
  await ctx.close();
}
await browser.close();
