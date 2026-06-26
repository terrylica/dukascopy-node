/**
 * High-detail per-section screenshots of the AI-stocks page for close visual audit.
 * Captures each major block as its own PNG so text/values are legible.
 */
import { chromium } from "playwright";

const URL = process.env.PAGE_URL ?? `file://${process.cwd()}/site/index.html`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(800);

// shoot a region by the heading text -> the element after it
const shots: Array<[string, string]> = [
  ["header", "body > .wrap"],
];
// capture specific blocks
const blocks = await page.evaluate(() => {
  const d = (globalThis as { document?: { querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): { top: number; height: number } }> } }).document;
  if (!d) return [] as string[];
  return [];
});
void blocks; void shots;

const cap = async (sel: string, name: string) => {
  const el = page.locator(sel).first();
  try { await el.screenshot({ path: `/tmp/sec_${name}.png` }); console.log(`shot ${name}: ok`); }
  catch (e) { console.log(`shot ${name}: FAIL ${(e as Error).message}`); }
};

await cap(".rgrid", "rankings");
await cap(".tscroll", "downloads");
await cap(".grid", "tiers");
await cap(".dict", "dict");
await cap(".grandbar", "grandbar");
// caveats: the warn callout
await cap(".callout.warn", "caveats");
await browser.close();
