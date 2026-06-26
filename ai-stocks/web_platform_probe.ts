/**
 * Probe the Dukascopy EU demo web-platform with our demo account via a real DOM browser.
 * Goal: log in, see if it loads chart/historical data, and capture WHICH endpoints carry that data
 * — specifically whether anything bypasses the blocked datafeed.dukascopy.com CDN (16.62.187.25).
 * One surgical session, no looping/hammering.
 */
import { URL } from "node:url";
import { chromium } from "playwright";

type El = { type?: string; name?: string; placeholder?: string; id?: string };
type Doc = { querySelectorAll(s: string): ArrayLike<El>; body: { innerText: string } };

// Register your OWN free Dukascopy demo account, then pass the emailed login/password via env:
//   JFOREX_USER=... JFOREX_PASS=... bun run web_platform_probe.ts
const USER = process.env.JFOREX_USER ?? "";
const PASS = process.env.JFOREX_PASS ?? "";
if (!USER || !PASS) { console.error("Set JFOREX_USER and JFOREX_PASS (your own Dukascopy demo creds)."); process.exit(2); }
const PLATFORM_URL = "https://eu-demo.dukascopy.com/web-platform/";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const hosts = new Map<string, number>();
const dataHits: string[] = [];
const fullUrls = new Set<string>();
const wsUrls = new Set<string>();
page.on("request", (r) => {
  try {
    const u = new URL(r.url());
    if (/dukascopy|proxymity|ex2archive/i.test(u.host)) hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
    // full URLs for the candidate data hosts (freeserv = likely candle JSON; datafeed = blocked CDN)
    if (/freeserv|datafeed/i.test(u.host)) fullUrls.add(`${r.method()} ${u.href}`);
    if (/candle|hist|feed|quote|chart|bar|tick|price|json3|instrument/i.test(u.pathname)) dataHits.push(`${r.method()} ${u.host}${u.pathname}`);
  } catch { /* ignore */ }
});
page.on("websocket", (ws) => { wsUrls.add(ws.url()); });

const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`step OK: ${name}`); } catch (e) { console.log(`step FAIL: ${name}: ${(e as Error).message}`); }
};

try {
  await page.goto(PLATFORM_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/wp_login.png" }).catch(() => {});

  const inputs = await page.evaluate(() => {
    const d = (globalThis as { document?: Doc }).document;
    if (!d) return [] as string[];
    return Array.from(d.querySelectorAll("input")).map((el) =>
      `${el.type}|name=${el.name}|ph=${el.placeholder}|id=${el.id}`).slice(0, 20);
  });
  console.log("login inputs:", JSON.stringify(inputs));

  await step("fill login", async () => {
    const userIn = page.locator('input[type="text"], input[name*="login" i], input[placeholder*="login" i], input[placeholder*="user" i]').first();
    const passIn = page.locator('input[type="password"]').first();
    await userIn.fill(USER, { timeout: 8000 });
    await passIn.fill(PASS, { timeout: 8000 });
  });
  // is a captcha image present (blocks headless login)?
  const captcha = await page.evaluate(() => {
    const d = (globalThis as { document?: { querySelectorAll(s: string): ArrayLike<{ src?: string; offsetParent?: unknown }> } }).document;
    if (!d) return { imgs: [] as string[] };
    const imgs = Array.from(d.querySelectorAll("img")).map((i) => i.src || "").filter((s) => /captcha|secure|code/i.test(s));
    return { imgs };
  });
  console.log("captcha images:", JSON.stringify(captcha));

  await step("submit login", async () => {
    await page.getByText("Log in", { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(12000);
  });
  await page.screenshot({ path: "/tmp/wp_after_login.png" }).catch(() => {});
  // detect error/captcha-required message
  const errText = await page.evaluate(() => {
    const d = (globalThis as { document?: { body: { innerText: string } } }).document;
    return d ? (d.body.innerText || "").slice(0, 500).replace(/\s+/g, " ") : "";
  });
  console.log("after-submit text:", errText);

  const bodyText = await page.evaluate(() => {
    const d = (globalThis as { document?: Doc }).document;
    return d ? (d.body.innerText || "").slice(0, 400).replace(/\s+/g, " ") : "";
  });
  console.log("post-login body sample:", bodyText);
  await page.waitForTimeout(6000); // let charts try to load data

  // KEY TEST: fetch the freeserv json3 candle API from INSIDE the authenticated session.
  // If a stock returns OHLC, freeserv (server-side) bypasses our datafeed IP-block.
  const nowMs = Number(process.env.NOW_MS ?? "0");
  const probe = await page.evaluate(async (args: { insts: string[]; ts: number }) => {
    const out: Record<string, string> = {};
    for (const inst of args.insts) {
      const url = `https://freeserv.dukascopy.com/2.0/index.php?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=5MIN&splits=true&limit=5&time_direction=P&timestamp=${args.ts}`;
      try {
        const r = await fetch(url, { credentials: "include" });
        out[inst] = (await r.text()).slice(0, 280);
      } catch (e) { out[inst] = `ERR ${(e as Error).message}`; }
    }
    return out;
  }, { insts: ["EUR/USD", "NVDA.US/USD", "AAPL.US/USD", "TSM.US/USD", "PLTR.US/USD"], ts: nowMs });
  console.log("\n=== in-session freeserv json3 probe (5MIN bid) ===");
  for (const [k, v] of Object.entries(probe)) console.log(`${k}:\n  ${v}\n`);
} catch (e) {
  console.log("flow error:", (e as Error).message);
}

console.log("\n=== dukascopy/data hosts contacted (host -> #requests) ===");
for (const [h, n] of Array.from(hosts.entries()).toSorted((a, b) => b[1] - a[1])) console.log(`${n}\t${h}`);
console.log("\n=== FULL freeserv/datafeed URLs (candle API candidates) ===");
for (const u of fullUrls) console.log(u);
console.log("\n=== websocket URLs ===");
for (const w of wsUrls) console.log(w);
console.log("\n=== data-ish requests (first 30) ===");
for (const d of Array.from(new Set(dataHits)).slice(0, 30)) console.log(d);
await browser.close();
