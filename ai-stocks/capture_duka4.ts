/**
 * Robust drive of the Dukascopy historical-data-export widget: search NVDA, select it, set 5-min,
 * click Export, and capture the exact jetta endpoint + any CSV download. Verbose step logging +
 * screenshots so failures are visible. Goal: confirm the export is server-side (bypasses our block).
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

const jetta: string[] = [];
page.on("request", (r) => {
  const u = r.url();
  if (/jetta\.dukascopy\.com/i.test(u)) {
    let body = ""; try { body = r.postData()?.slice(0, 300) ?? ""; } catch { body = ""; }
    jetta.push(`${r.method()} ${u}${body ? `  BODY=${body}` : ""}`);
  }
});
page.on("response", async (r) => {
  const u = r.url();
  if (/jetta\.dukascopy\.com/i.test(u) && /(feed|hist|candle|csv|export|chart|price)/i.test(u)) {
    try { console.log(`>> DATA RESP ${r.status()} ${u.slice(0, 150)}\n   ${(await r.text()).slice(0, 200).replace(/\s+/g, " ")}`); } catch { /* */ }
  }
});
page.on("download", async (d) => {
  const p = `/tmp/duka_export.csv`;
  console.log(`>> DOWNLOAD ${d.suggestedFilename()} from ${d.url().slice(0, 120)}`);
  try { await d.saveAs(p); const txt = await Bun.file(p).text(); console.log(`>> SAVED ${p} (${txt.length} bytes)\n   head: ${txt.slice(0, 160).replace(/\n/g, " | ")}`); } catch (e) { console.log("dl save:", (e as Error).message); }
});

const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`step OK: ${name}`); } catch (e) { console.log(`step FAIL: ${name}: ${(e as Error).message}`); }
};

try {
  await page.goto("https://widgets.dukascopy.com/en/historical-data-export", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

  await step("search NVDA", async () => {
    const s = page.getByPlaceholder("Search instrument");
    await s.click(); await s.fill("NVDA"); await page.waitForTimeout(2500);
  });
  // dump what options appeared
  const opts = await page.evaluate(() => {
    const d = (globalThis as { document?: { body: { innerText: string } } }).document;
    return d ? d.body.innerText.split("\n").filter((l) => /NVDA|NVIDIA/i.test(l)).slice(0, 6) : [];
  });
  console.log("options containing NVDA:", JSON.stringify(opts));

  await step("select NVDA result", async () => {
    await page.getByText(/NVDA\.US\/USD|NVIDIA/i).first().click({ timeout: 6000 });
    await page.waitForTimeout(2500);
  });
  // dump controls now visible
  const ctrls = await page.evaluate(() => {
    const d = (globalThis as { document?: { querySelectorAll: (s: string) => unknown[] } }).document;
    if (!d) return [];
    return Array.from(d.querySelectorAll("button,mat-select,[role=combobox],input"))
      .map((e) => (e as { innerText?: string; placeholder?: string }).innerText?.trim() || (e as { placeholder?: string }).placeholder || "")
      .filter(Boolean).slice(0, 30);
  });
  console.log("controls after select:", JSON.stringify(ctrls));

  await step("click Export", async () => {
    await page.getByRole("button", { name: /^export$/i }).first().click({ timeout: 6000 });
    await page.waitForTimeout(10000);
  });
  await page.screenshot({ path: "/tmp/duka_widget.png" }).catch(() => {});
} catch (e) {
  console.log("flow error:", (e as Error).message);
}

console.log("\n=== ALL jetta requests ===");
for (const r of Array.from(new Set(jetta))) console.log(r);
await browser.close();
