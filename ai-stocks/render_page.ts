/**
 * Phase 4 — render the CEO-facing page (site/index.html) from build/manifest.json + rankings.ts.
 *
 * Produces a single self-contained HTML file: justification, four ranking views, composite
 * tiers, data dictionary, honest caveats, per-stock sparklines, and the S3 download matrix.
 * Run AFTER upload_s3.ts (so manifest carries s3_url). Run: bun run render_page.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RANK_META, RANKINGS, type Rank } from "./rankings.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, "build", "manifest.json"), "utf8"));
const OUT_DIR = join(HERE, "site");
const stocks = manifest.stocks as Array<Record<string, any>>;
const singles = stocks.filter((s) => !s.is_bonus_etf && RANKINGS[s.ticker]);
const etfs = stocks.filter((s) => s.is_bonus_etf);

// AUTHORITATIVE financials (market cap + avg $ volume) from Nasdaq's own API; merged over the
// editorial AI-relevance / retail-buzz scores. Objective figures are sourced, not estimated.
const FUND = JSON.parse(readFileSync(join(HERE, "fundamentals.json"), "utf8")) as {
  source: string; as_of: string; data: Record<string, { mcapUsdB: number; advUsdB: number }>;
};
const RANK: Record<string, Rank> = {};
for (const t of Object.keys(RANKINGS)) {
  const f = FUND.data[t];
  RANK[t] = f ? { ...RANKINGS[t], mcapUsdB: f.mcapUsdB, advUsdB: f.advUsdB } : { ...RANKINGS[t] };
}

const METHODS = [
  { key: "advUsdB", title: "Liquidity", sub: "avg daily $ volume", unit: "$B", src: "nasdaq" },
  { key: "aiPurity", title: "AI relevance", sub: "how core AI is", unit: "/100", src: "editorial" },
  { key: "mcapUsdB", title: "Market cap", sub: "company size", unit: "$B", src: "nasdaq" },
  { key: "retailBuzz", title: "Options / retail buzz", sub: "speculative interest", unit: "/100", src: "editorial" },
] as const;

// per-method ranking + top-10 membership
const ranked: Record<string, string[]> = {};
for (const m of METHODS) {
  ranked[m.key] = singles
    .map((s) => s.ticker)
    .toSorted((a, b) => RANK[b][m.key as keyof Rank] - RANK[a][m.key as keyof Rank]);
}
const top10 = (key: string) => new Set(ranked[key].slice(0, 10));
const topSets = Object.fromEntries(METHODS.map((m) => [m.key, top10(m.key)]));
const tierOf = (t: string): 1 | 2 | 3 => {
  const hits = METHODS.filter((m) => topSets[m.key].has(t)).length;
  return hits >= 3 ? 1 : hits >= 1 ? 2 : 3;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// money in USD billions; rolls into trillions above 1000 ($3800B -> "$3.8T", not "$3.8TB")
const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}T` : `$${n}B`);

function sparkline(series: number[], w = 120, h = 30): string {
  if (!series || series.length < 2) return "";
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const pts = series.map((v, i) =>
    `${((i / (series.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  const up = series[series.length - 1] >= series[0];
  const color = up ? "#3fb950" : "#f85149";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

const byTicker = Object.fromEntries(stocks.map((s) => [s.ticker, s]));
// flag any instrument whose feed ends well before the freshest in the set (broker discontinued the CFD)
const endMs = (s: Record<string, any>) => new Date(`${String(s.date_end).replace(" ", "T")}Z`).getTime();
const maxEndMs = Math.max(...stocks.map(endMs));
const isStale = (s: Record<string, any>) => maxEndMs - endMs(s) > 30 * 86400 * 1000;
const staleCount = stocks.filter(isStale).length;
const dl = (t: string, kind: string) => {
  const a = (byTicker[t]?.artifacts ?? []).find((x: any) => x.kind === kind);
  return a?.s3_url ?? "#";
};
const sha = (t: string, kind: string) => {
  const a = (byTicker[t]?.artifacts ?? []).find((x: any) => x.kind === kind);
  return a ? a.sha256.slice(0, 12) : "";
};

// ---- ranking tables ----
const srcChip = (src: string) => src === "nasdaq"
  ? `<span class="src srcN" title="Live market data from Nasdaq's API, as-of ${esc(FUND.as_of)}">Nasdaq · ${esc(FUND.as_of)}</span>`
  : `<span class="src srcE" title="Our editorial estimate — a qualitative lens, not a sourced financial figure">editorial estimate</span>`;
const rankTables = METHODS.map((m) => {
  const rows = ranked[m.key].map((t, i) => {
    const r = RANK[t];
    const v = r[m.key as keyof Rank];
    const val = m.unit === "$B" ? (v === 0 ? "—" : money(v)) : `${v}`;
    return `<tr><td class="rk">${i + 1}</td><td class="tk">${t}</td><td>${esc(byTicker[t]?.description ?? "")}</td><td class="num">${val}</td><td><span class="tier t${tierOf(t)}">T${tierOf(t)}</span></td></tr>`;
  }).join("");
  return `<div class="card"><h3>${m.title} <small>${m.sub}</small> ${srcChip(m.src)}</h3>
  <table><thead><tr><th>#</th><th>Ticker</th><th>Company</th><th class="num">${m.unit === "$B" ? "Value" : "Score"}</th><th>Tier</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}).join("");

// ---- composite tiers ----
const tierGroups: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] };
for (const s of singles) tierGroups[tierOf(s.ticker)].push(s.ticker);
const tierBlurb: Record<number, string> = {
  1: "Top-10 in 3+ ranking methods — the core, must-have AI names.",
  2: "Top-10 in 1–2 ranking methods — strong secondary AI exposure.",
  3: "Broader AI universe — sector completeness.",
};
const tierCards = [1, 2, 3].map((tn) =>
  `<div class="card tcard"><h3><span class="tier t${tn}">Tier ${tn}</span> <small>${tierBlurb[tn]}</small></h3>
   <p class="chips">${tierGroups[tn as 1 | 2 | 3].map((t) => `<span class="chip">${t}</span>`).join(" ") || "—"}</p></div>`).join("");

// ---- download matrix ----
const dlRow = (s: Record<string, any>) => `<tr>
  <td class="tk">${s.ticker}</td>
  <td>${esc(s.description)}<div class="thesis">${esc(s.ai_thesis)}</div></td>
  <td class="cat">${esc(s.category)}</td>
  <td class="num">${(s.bars as number).toLocaleString()}</td>
  <td class="rng">${s.date_start.slice(0, 10)}<br>→ ${s.date_end.slice(0, 10)}${isStale(s) ? `<br><span class="stale" title="Dukascopy discontinued this CFD feed after this date">⚠ feed ended</span>` : ""}</td>
  <td>${sparkline(s.spark)}</td>
  <td class="dls">
    <a class="btn" href="${dl(s.ticker, "zip")}" title="sha256 ${sha(s.ticker, "zip")}">CSV .zip</a>
    <a class="btn ghost" href="${dl(s.ticker, "gz")}" title="merged sha256 ${sha(s.ticker, "gz")}">merged .gz</a>
  </td></tr>`;

const dlRows = singles.map(dlRow).join("");
const etfRows = etfs.map(dlRow).join("");
const grand = manifest.grand_bundle;

const totalBars = stocks.reduce((s, x) => s + (x.bars as number), 0);
const s3base = manifest.s3?.base_url ?? "";
const manifestUrl = `${s3base}manifest.json`;
const grandUrl = grand.s3_url ?? "#";
const recipe = `You are analyzing a public dataset: 5-minute OHLCV bars (bid, ask, and a computed mid)
for ${singles.length} AI-related US stock CFDs (plus the WTAI AI ETF), sourced from Dukascopy.

MACHINE-READABLE INDEX — start here (lists every instrument, date range, bar count, SHA-256, URLs):
  ${manifestUrl}

Per stock there is a .zip (merged + bid-only + ask-only CSV) and a merged .gz.
Download everything at once:  ${grandUrl}

MERGED CSV COLUMNS:
  ts                       bar OPEN time, UTC, "YYYY-MM-DD HH:MM:SS", 5-minute bars
  bid_open/high/low/close  bid-side OHLC (split-adjusted)
  bid_volume               indicative CFD volume
  ask_open/high/low/close  ask-side OHLC (split-adjusted)
  ask_volume               indicative CFD volume
  mid_open/high/low/close  (bid + ask) / 2, per field

IMPORTANT SEMANTICS:
  - Dukascopy CFD quotes (bid/ask), NOT exchange trades; volume is indicative only.
  - Timestamps are UTC. US regular session = 13:30-20:00 UTC (summer) / 14:30-21:00 UTC (winter).
  - Gaps (nights, weekends, holidays) are market-closed, not missing data.
  - Verify each download against the SHA-256 in manifest.json.

DO THIS:
  1. Fetch manifest.json and print each stock with its date range and bar count.
  2. Download NVDA's merged CSV, load it, and chart mid_close over time.
  3. <replace with your question — e.g. "average bid-ask spread per stock in 2026">`;

const repoUrl = "https://github.com/terrylica/dukascopy-node/tree/main/ai-stocks";
const readmeUrl = "https://github.com/terrylica/dukascopy-node/blob/main/ai-stocks/README.md";
const releaseUrl = "https://github.com/terrylica/dukascopy-node/releases/tag/ai-stocks-v1";
const demoUrl = "https://www.dukascopy.com/swiss/english/forex/demo-fx-account/";
const reproRecipe = `Reproduce the Dukascopy AI US-stock 5-minute data pack end-to-end.

STEP 0 — HUMAN, REQUIRED, CANNOT BE AUTOMATED (do this yourself before running anything):
  Register a FREE Dukascopy demo account at:
    ${demoUrl}
  Fill the form (name, email, country, phone). No email confirmation/click-to-verify is needed —
  the account works immediately. Within minutes you receive an email ("Your Demo Trading Account
  Is Ready") with your JForex Login + Password. Keep them. (The bar data is pulled from Dukascopy's
  public chart API and needs no credentials stored in the scripts; the demo account is your
  authorized access to the platform and how to inspect/verify the source.)

THEN, in a Claude Code session (all scripts live at ${repoUrl}):
  git clone https://github.com/terrylica/dukascopy-node && cd dukascopy-node/ai-stocks && bun install
  bun run freeserv_fetch.ts         # pull 5-min bid+ask for all instruments -> raw/
  bun run fetch_fundamentals.ts      # refresh market cap + liquidity from Nasdaq
  bun run validate_timestamps.ts     # integrity gate (expect "ALL TIMESTAMP CHECKS PASSED")
  bun run build_outputs.ts           # merge/mid/validate/zip/sha256 -> build/ + manifest.json
  AWS_PROFILE=<you> AWS_REGION=us-west-2 bun run upload_s3.ts   # public-read S3 bucket
  bun run render_page.ts             # regenerate the page (site/index.html), then deploy it

Full write-up, schema and notes: ${readmeUrl}`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>AI US-Stock 5-min Data Pack — Dukascopy</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--bd:#30363d;--fg:#e6edf3;--mut:#8b949e;--ac:#58a6ff;--grn:#3fb950}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:36px 28px 90px}
h1{font-size:30px;margin:0 0 6px}h2{font-size:21px;margin:42px 0 14px;border-bottom:1px solid var(--bd);padding-bottom:8px}
h3{font-size:16px;margin:0 0 12px}h3 small,h2 small{color:var(--mut);font-weight:400;font-size:13px}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
.lede{color:var(--mut);font-size:16px;max-width:80ch}
.meta{color:var(--mut);font-size:13px;margin-top:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}
.rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(600px,100%),1fr));gap:18px}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:16px;overflow-x:auto}
.tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.rk{color:var(--mut);width:24px}.tk{font-weight:700;color:#fff;white-space:nowrap}
.cat{color:var(--mut);font-size:12px}.rng{color:var(--mut);font-size:12px;white-space:nowrap}
.stale{color:#d29922;font-weight:600}
.thesis{color:var(--mut);font-size:12px;margin-top:2px}
.tier{display:inline-block;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:700}
.t1{background:#1f6feb33;color:#79c0ff;border:1px solid #1f6feb}
.t2{background:#3fb95033;color:#7ee787;border:1px solid #2ea043}
.t3{background:#6e768133;color:#c9d1d9;border:1px solid #484f58}
.src{display:inline-block;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:5px;vertical-align:middle;white-space:nowrap}
.srcN{background:#1f6feb22;color:#79c0ff;border:1px solid #1f6feb55}
.srcE{background:#6e768122;color:#8b949e;border:1px solid #484f58}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0}.chip{background:#21262d;border:1px solid var(--bd);border-radius:6px;padding:2px 8px;font-weight:600;font-size:12px}
.btn{display:inline-block;background:#21262d;border:1px solid var(--bd);border-radius:6px;padding:4px 10px;margin:1px 0;font-size:12px;font-weight:600;color:var(--fg)}
.btn:hover{border-color:var(--ac);text-decoration:none}.btn.ghost{background:transparent;color:var(--mut)}
.dls{white-space:nowrap}.spark{display:block}
.grandbar{display:flex;flex-wrap:wrap;align-items:center;gap:16px;background:linear-gradient(90deg,#1f6feb22,#161b22);border:1px solid #1f6feb55;border-radius:10px;padding:16px 20px;margin:18px 0}
.grandbar .big{font-size:17px;font-weight:700}
.callout{background:#161b22;border-left:3px solid var(--ac);padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;color:var(--mut)}
.warn{border-left-color:#d29922}
code{background:#21262d;padding:1px 6px;border-radius:5px;font-size:13px}
pre.recipe{background:#0b0f14;border:1px solid var(--bd);border-radius:8px;padding:16px 18px;overflow-x:auto;font:12.5px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#c9d1d9;white-space:pre-wrap;word-break:break-word}
.vbadge{display:inline-block;background:#3fb95022;border:1px solid #2ea043;color:#7ee787;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;margin-top:8px}
.dict{font-size:13px}.dict td:first-child{color:#79c0ff;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
footer{color:var(--mut);font-size:12px;margin-top:50px;border-top:1px solid var(--bd);padding-top:18px}
</style></head><body><div class="wrap">

${process.env.PARTIAL_NOTE ? `<div style="background:#d29922;color:#1c1300;font-weight:700;padding:10px 16px;border-radius:8px;margin-bottom:16px">⏳ PARTIAL PREVIEW — ${esc(process.env.PARTIAL_NOTE)} This page auto-updates as the full multi-year history finishes downloading.</div>` : ""}
<h1>AI US-Stock Data Pack — 5-minute OHLCV (bid &amp; ask)</h1>
<p class="lede">Historical 5-minute price bars for ${singles.length} of the most actively-traded, AI-related US stocks${etfs.length ? " (plus a bonus AI thematic ETF)" : ""}, sourced from Dukascopy. Because Dukascopy quotes stock CFDs rather than exchange trades, every bar is provided on <b>both the bid and the ask side</b>, with a computed <b>mid</b>. Pick a tier below, or grab everything in one bundle.</p>
<p class="meta">Generated ${manifest.generated_utc} UTC · Prices: ${esc(manifest.source)} · Financials: Nasdaq (${esc(FUND.as_of)}) · Timestamps UTC.</p>

<div class="grandbar">
  <div><div class="big">⬇︎ Download everything</div><div class="meta">All ${stocks.length} instruments · per-stock CSV bundles in one archive</div></div>
  <a class="btn" style="font-size:14px;padding:8px 16px" href="${grand.s3_url ?? "#"}">ai-stocks-m5-all.zip · ${(grand.bytes / 1024 / 1024).toFixed(1)} MB</a>
  <a class="btn ghost" href="${(manifest.s3?.base_url ?? "") + "CHECKSUMS.txt"}">CHECKSUMS.txt</a>
  <a class="btn ghost" href="${(manifest.s3?.base_url ?? "") + "manifest.json"}">manifest.json</a>
</div>

<h2>Why these stocks <small>the selection, justified</small></h2>
<div class="callout">
<b>AI-related &amp; actively traded.</b> We started from the US single-stock CFDs Dukascopy carries and kept the companies whose value is driven by AI: the chipmakers that build AI accelerators, the mega-cap platforms running frontier models, the enterprise-AI software vendors, and the networking/infrastructure that wires AI data-centers. Names that are <i>not</i> on Dukascopy (e.g. SMCI, CRWD, ARM Holdings, ASML US ADR) are intentionally absent — verified against Dukascopy's live instrument feed.
</div>
<p>Rather than one opinionated "top 10", the same universe is ranked <b>four different ways</b> so you can pick the lens that matters. Each stock's <b>composite tier</b> reflects how many of these lenses rank it in the top 10:</p>
<div class="grid">${tierCards}</div>

<h2>Four ranking views</h2>
<p class="meta"><b>Market cap</b> and <b>Liquidity</b> (avg daily $ volume) are live figures from <b>Nasdaq</b> (api.nasdaq.com), as-of ${esc(FUND.as_of)} — not estimates. <b>AI relevance</b> and <b>Options / retail buzz</b> are clearly-labelled <i>editorial</i> scores: qualitative lenses for ordering, not sourced financials. ${esc(RANK_META.disclaimer)}</p>
<div class="rgrid">${rankTables}</div>

<h2>Downloads <small>5-minute OHLCV · bid + ask + mid · CSV (zipped)</small></h2>
<p class="meta">Each <code>.zip</code> contains merged + bid-only + ask-only CSVs, a README and a data dictionary. <code>.gz</code> is the merged CSV alone, gzipped, for analysts. Hover a button for its SHA-256.</p>
<div class="tscroll"><table style="min-width:680px"><thead><tr><th>Ticker</th><th>Company / AI thesis</th><th>Category</th><th class="num">Bars</th><th>Coverage</th><th>Mid trend</th><th>Download</th></tr></thead>
<tbody>${dlRows}${etfs.length ? `<tr><td colspan="7" style="color:#8b949e;padding-top:14px"><b>Bonus — AI thematic ETF</b></td></tr>${etfRows}` : ""}</tbody></table></div>

<h2>What's in the data <small>column dictionary</small></h2>
<div class="tscroll"><table class="dict" style="min-width:520px"><tbody>
<tr><td>ts</td><td>Bar open time, UTC (YYYY-MM-DD HH:MM:SS).</td></tr>
<tr><td>bid_open/high/low/close</td><td>Bid-side OHLC price for the 5-minute bar (split-adjusted).</td></tr>
<tr><td>ask_open/high/low/close</td><td>Ask-side OHLC price for the 5-minute bar (split-adjusted).</td></tr>
<tr><td>mid_open/high/low/close</td><td>(bid + ask) / 2, computed per OHLC field.</td></tr>
<tr><td>bid_volume / ask_volume</td><td>Dukascopy <i>indicative</i> CFD volume per side (relative activity only).</td></tr>
</tbody></table></div>

<h2>Data &amp; timestamps <small>read this before using the bars</small></h2>
<div class="callout">
<b>Each row is one 5-minute bar; the <code>ts</code> column is the bar's OPEN time, in UTC</b> (24-hour clock, no daylight-saving). Because the stamps are UTC, the US regular session lands at <b>13:30–20:00 UTC in summer</b> (09:30–16:00 New York EDT) and <b>14:30–21:00 UTC in winter</b> (09:30–16:00 EST) — the 1-hour seasonal shift is real and visible in the data, and confirms the UTC labelling. Nights, weekends and market holidays are <b>gaps, not missing data</b>. Most US names are regular-session; a few (e.g. <b>PLTR</b>, <b>SNOW</b>) carry some extended-hours bars, and the bonus <b>WTAI</b> ETF trades on a European schedule (~08:00–16:25 UTC). Prices are split-adjusted; volume is indicative.
<div class="vbadge">✓ ${totalBars.toLocaleString()} bars validated — every timestamp UTC, 5-minute-aligned, strictly increasing, zero duplicates</div>
</div>

<h2>Use it with Claude Code <small>two ready-to-paste recipes</small></h2>
<h3 style="margin-top:8px">1 · Consume the data <small>no setup, no account</small></h3>
<p class="meta">The dataset ships with a machine-readable <a href="${manifestUrl}">manifest.json</a> indexing every file. Paste this into a Claude Code (or any AI coding-agent) session — it is self-contained and will discover, download, verify and use the data on its own.</p>
<pre class="recipe">${esc(recipe)}</pre>

<h3 style="margin-top:26px">2 · Reproduce the whole pipeline <small>regenerate everything — e.g. to add fresh data next month</small></h3>
<div class="callout warn" style="margin-top:8px"><b>⚠ One human step, required.</b> Reproducing from scratch uses Dukascopy's demo platform, and the free <b>demo account must be registered by a person — it cannot be automated</b>. No email confirmation/click-to-verify is needed; your JForex login + password arrive by email ("Your Demo Trading Account Is Ready") within minutes. <a href="${demoUrl}">Register a demo account →</a></div>
<pre class="recipe">${esc(reproRecipe)}</pre>
<p class="meta">Full method, all scripts and the release are on GitHub: <a href="${repoUrl}">ai-stocks/ source</a> · <a href="${readmeUrl}">README</a> · <a href="${releaseUrl}">v1 release (data + checksums)</a>.</p>

<div class="callout warn">
<b>Read me — honest caveats.</b> This is <b>Dukascopy CFD quote data</b>, not the official consolidated exchange tape. There are <b>no trade prints</b> (hence bid/ask), prices are <b>split-adjusted</b> (corporate splits back-applied for a continuous series), volume is <b>indicative only</b>, all timestamps are <b>UTC</b> (see <i>Data &amp; timestamps</i> above for session windows), and history depth varies by listing (mega-caps from ~2017; newer names later). The ranking figures are analyst-curated approximations for ordering only — not exact financials, not investment advice.${staleCount ? ` A <span class="stale">⚠ feed ended</span> tag marks instruments whose Dukascopy CFD was discontinued before the dataset's latest date (e.g. ANET, after its Dec-2024 4-for-1 split) — their history is complete up to that date.` : ""}
</div>

<footer>
Source: Dukascopy stock-CFD price feed (freeserv chart API) · Bun/TypeScript pipeline · ${manifest.timeframe}.
Integrity: every file's SHA-256 is in CHECKSUMS.txt and manifest.json. Method &amp; code: <a href="${repoUrl}">GitHub</a> · <a href="${releaseUrl}">v1 release</a>. ${esc(RANK_META.disclaimer)}
</footer>
</div></body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`wrote ${join(OUT_DIR, "index.html")} (${(html.length / 1024).toFixed(0)} KB) — ${singles.length} stocks, ${etfs.length} ETF`);
