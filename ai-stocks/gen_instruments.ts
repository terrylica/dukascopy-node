/**
 * Freeze the AI-related US-stock universe into instruments.json (the run SSoT).
 *
 * Reads the live Dukascopy instrument snapshot (dukascopy_instruments_snapshot.jsonp,
 * captured from https://freeserv.dukascopy.com/2.0/index.php?path=common/instruments)
 * and joins it against a CURATED AI universe (human-selected, with category + thesis).
 *
 * dukascopy-node `-i` id == lowercase(historical_filename): NVDA -> "NVDAUSUSD" -> "nvdaususd";
 * META trades under its legacy id FB -> "fbususd". `from_date` is derived from each
 * instrument's actual `history_start_tick` (epoch ms) so we never request data too early.
 *
 * Run: bun run gen_instruments.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, "dukascopy_instruments_snapshot.jsonp");
const OUT = join(HERE, "instruments.json");

type Cur = readonly [category: string, thesis: string];

// Curated AI universe: ticker -> [category, one-line AI thesis].
const CURATED: Record<string, Cur> = {
  // AI compute / semiconductors
  NVDA: ["AI compute / semiconductors", "The dominant AI training/inference GPU supplier."],
  AMD: ["AI compute / semiconductors", "MI-series data-center GPUs; #2 AI accelerator."],
  AVGO: ["AI compute / semiconductors", "Custom AI ASICs + AI networking silicon."],
  TSM: ["AI compute / semiconductors", "Foundry that fabricates virtually every AI chip."],
  MU: ["AI compute / semiconductors", "HBM memory — the bottleneck for AI accelerators."],
  MRVL: ["AI compute / semiconductors", "Custom AI silicon + data-center interconnect."],
  QCOM: ["AI compute / semiconductors", "On-device / edge AI inference (NPU)."],
  INTC: ["AI compute / semiconductors", "Gaudi accelerators + AI-PC CPUs; foundry ambitions."],
  TXN: ["AI compute / semiconductors", "Analog/embedded silicon feeding AI hardware."],
  AMAT: ["AI compute / semiconductors", "Wafer-fab equipment enabling advanced AI nodes."],
  LRCX: ["AI compute / semiconductors", "Etch/deposition tools for leading-edge AI chips."],
  // Mega-cap AI platforms
  MSFT: ["Mega-cap AI platform", "Copilot + Azure OpenAI; largest AI-cloud spender."],
  GOOGL: ["Mega-cap AI platform", "Gemini, TPUs, DeepMind (Class A)."],
  GOOG: ["Mega-cap AI platform", "Gemini, TPUs, DeepMind (Class C)."],
  META: ["Mega-cap AI platform", "Llama open models + AI-driven ad ranking."],
  AMZN: ["Mega-cap AI platform", "AWS Bedrock/Trainium; Anthropic backer."],
  AAPL: ["Mega-cap AI platform", "Apple Intelligence on-device AI."],
  TSLA: ["Mega-cap AI platform", "FSD/Dojo autonomy + humanoid robotics AI."],
  // AI / enterprise software
  ORCL: ["AI / enterprise software", "OCI GPU cloud build-out for AI training."],
  CRM: ["AI / enterprise software", "Agentforce / Einstein enterprise AI agents."],
  ADBE: ["AI / enterprise software", "Firefly generative-AI creative suite."],
  NOW: ["AI / enterprise software", "Now Assist generative-AI workflow automation."],
  SNOW: ["AI / enterprise software", "Cortex AI over enterprise data warehouses."],
  PLTR: ["AI / enterprise software", "AIP — operational LLM platform for gov/enterprise."],
  MDB: ["AI / enterprise software", "Vector search backing RAG/AI applications."],
  PANW: ["AI / enterprise software", "AI-driven security (Precision AI)."],
  // AI infrastructure / networking
  ANET: ["AI infrastructure / networking", "Ethernet switching fabric for AI clusters."],
  DELL: ["AI infrastructure / networking", "AI servers (GB200) + enterprise AI infra."],
};

const BONUS_ETF: Record<string, Cur> = {
  WTAI: ["AI thematic ETF (bonus)", "WisdomTree Artificial Intelligence & Innovation ETF."],
};

// Display ticker -> Dukascopy's listing ticker, when they differ.
const DUKASCOPY_TICKER_ALIAS: Record<string, string> = { META: "FB" };

interface RawInstr {
  title: string;
  description: string;
  historical_filename: string;
  history_start_tick: string;
}

function loadSnapshot(): Record<string, RawInstr> {
  const txt = readFileSync(SNAPSHOT, "utf8").trim();
  const body = txt.slice(txt.indexOf("(") + 1, txt.lastIndexOf(")"));
  return JSON.parse(body).instruments as Record<string, RawInstr>;
}

const msToDate = (ms: string | number): string =>
  new Date(Number(ms)).toISOString().slice(0, 10);

function build(): void {
  const inst = loadSnapshot();
  const byTicker = new Map<string, RawInstr>();
  for (const m of Object.values(inst)) {
    if (/^[A-Z0-9.-]+\.US\/USD$/.test(m.title)) byTicker.set(m.title.split(".")[0], m);
  }

  const records: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const [group, isBonus] of [[CURATED, false], [BONUS_ETF, true]] as const) {
    for (const [ticker, [category, thesis]] of Object.entries(group)) {
      const m = byTicker.get(DUKASCOPY_TICKER_ALIAS[ticker] ?? ticker);
      if (!m) { missing.push(ticker); continue; }
      records.push({
        ticker,
        instrument_id: m.historical_filename.toLowerCase(),
        dukascopy_title: m.title,
        description: m.description,
        category,
        ai_thesis: thesis,
        is_bonus_etf: isBonus,
        history_start_tick_ms: Number(m.history_start_tick),
        from_date: msToDate(m.history_start_tick),
      });
    }
  }
  if (missing.length) throw new Error(`FATAL: curated tickers not in Dukascopy US set: ${missing}`);

  records.sort((a, b) =>
    `${a.is_bonus_etf}${a.category}${a.ticker}`.localeCompare(`${b.is_bonus_etf}${b.category}${b.ticker}`));

  const payload = {
    source: "Dukascopy stock CFDs via dukascopy-node (Leo4815162342) v1.46.4",
    snapshot_file: "dukascopy_instruments_snapshot.jsonp",
    timeframe: "m5 (5-minute OHLCV)",
    price_sides: ["bid", "ask"],
    note: "CFD quotes, not exchange trades; volume is indicative; timestamps UTC.",
    count_single_stocks: records.filter((r) => !r.is_bonus_etf).length,
    count_bonus_etf: records.filter((r) => r.is_bonus_etf).length,
    instruments: records,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`wrote ${OUT} with ${records.length} instruments (${payload.count_single_stocks} stocks + ${payload.count_bonus_etf} ETF)`);
  for (const r of records) console.log(`  ${String(r.ticker).padEnd(6)} ${String(r.instrument_id).padEnd(12)} from ${r.from_date}  ${r.category}`);
}

build();
