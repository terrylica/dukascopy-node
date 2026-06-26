/**
 * Ranking inputs for the four tier methods shown on the page.
 *
 * IMPORTANT — these describe the UNDERLYING US-market stock, NOT Dukascopy CFD volume
 * (Dukascopy CFD volume is only indicative). Figures are ANALYST-CURATED APPROXIMATIONS
 * for *relative ordering only*, as-of the date below. Bucketed to avoid false precision;
 * do not cite as exact financials.
 *
 *   mcapUsdB    ~ market capitalization, USD billions (size)
 *   advUsdB     ~ average daily DOLLAR volume, USD billions (liquidity / "most active")
 *   aiPurity    0-100 — how central AI is to the business (pure-play chip/AI-software = high)
 *   retailBuzz  0-100 — options + retail/social trading interest (momentum/attention)
 */
export interface Rank {
  mcapUsdB: number;
  advUsdB: number;
  aiPurity: number;
  retailBuzz: number;
}

export const RANK_META = {
  asOf: "2026-06",
  basis: "Underlying US listing (NYSE/Nasdaq). Approximate, bucketed, for relative ranking only.",
  disclaimer: "Not investment advice. Figures are illustrative orderings, not exact financials.",
} as const;

export const RANKINGS: Record<string, Rank> = {
  // AI compute / semiconductors
  NVDA: { mcapUsdB: 3800, advUsdB: 40, aiPurity: 100, retailBuzz: 98 },
  AMD: { mcapUsdB: 260, advUsdB: 9, aiPurity: 92, retailBuzz: 85 },
  AVGO: { mcapUsdB: 1200, advUsdB: 8, aiPurity: 90, retailBuzz: 60 },
  TSM: { mcapUsdB: 1050, advUsdB: 6, aiPurity: 85, retailBuzz: 50 },
  MU: { mcapUsdB: 150, advUsdB: 4, aiPurity: 80, retailBuzz: 60 },
  MRVL: { mcapUsdB: 80, advUsdB: 3, aiPurity: 85, retailBuzz: 55 },
  QCOM: { mcapUsdB: 190, advUsdB: 3, aiPurity: 60, retailBuzz: 45 },
  INTC: { mcapUsdB: 110, advUsdB: 5, aiPurity: 55, retailBuzz: 70 },
  TXN: { mcapUsdB: 180, advUsdB: 2, aiPurity: 40, retailBuzz: 35 },
  AMAT: { mcapUsdB: 175, advUsdB: 2, aiPurity: 70, retailBuzz: 40 },
  LRCX: { mcapUsdB: 120, advUsdB: 2, aiPurity: 70, retailBuzz: 40 },
  // Mega-cap AI platforms
  MSFT: { mcapUsdB: 3500, advUsdB: 12, aiPurity: 80, retailBuzz: 60 },
  AAPL: { mcapUsdB: 3300, advUsdB: 11, aiPurity: 55, retailBuzz: 80 },
  GOOGL: { mcapUsdB: 2300, advUsdB: 8, aiPurity: 85, retailBuzz: 58 },
  GOOG: { mcapUsdB: 2300, advUsdB: 5, aiPurity: 85, retailBuzz: 52 },
  AMZN: { mcapUsdB: 2300, advUsdB: 11, aiPurity: 75, retailBuzz: 70 },
  META: { mcapUsdB: 1500, advUsdB: 10, aiPurity: 80, retailBuzz: 65 },
  TSLA: { mcapUsdB: 1100, advUsdB: 28, aiPurity: 70, retailBuzz: 100 },
  // AI / enterprise software
  ORCL: { mcapUsdB: 600, advUsdB: 5, aiPurity: 65, retailBuzz: 55 },
  PLTR: { mcapUsdB: 300, advUsdB: 6, aiPurity: 95, retailBuzz: 95 },
  CRM: { mcapUsdB: 300, advUsdB: 4, aiPurity: 70, retailBuzz: 50 },
  ADBE: { mcapUsdB: 240, advUsdB: 3, aiPurity: 65, retailBuzz: 48 },
  NOW: { mcapUsdB: 200, advUsdB: 2, aiPurity: 70, retailBuzz: 45 },
  SNOW: { mcapUsdB: 70, advUsdB: 2, aiPurity: 70, retailBuzz: 55 },
  MDB: { mcapUsdB: 30, advUsdB: 1, aiPurity: 60, retailBuzz: 50 },
  PANW: { mcapUsdB: 130, advUsdB: 2, aiPurity: 60, retailBuzz: 45 },
  // AI infrastructure / networking
  ANET: { mcapUsdB: 130, advUsdB: 2, aiPurity: 80, retailBuzz: 50 },
  DELL: { mcapUsdB: 90, advUsdB: 2, aiPurity: 65, retailBuzz: 55 },
  // Bonus AI thematic ETF
  WTAI: { mcapUsdB: 0, advUsdB: 0, aiPurity: 100, retailBuzz: 20 },
};
