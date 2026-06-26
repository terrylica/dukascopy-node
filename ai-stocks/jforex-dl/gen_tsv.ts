/**
 * Emit instruments.tsv (ticker, instrument_id, dukascopy_title, from_date) from instruments.json
 * so the dependency-free Java SDK downloader can read its work-list. Keeps data-prep in Bun/TS;
 * Java touches only the proprietary Dukascopy DDS protocol.
 */
import { readFileSync, writeFileSync } from "node:fs";

const j = JSON.parse(readFileSync(new URL("../instruments.json", import.meta.url), "utf8")) as {
  instruments: Array<{ ticker: string; instrument_id: string; dukascopy_title: string; from_date: string }>;
};
const rows = j.instruments.map((i) => [i.ticker, i.instrument_id, i.dukascopy_title, i.from_date].join("\t"));
writeFileSync(new URL("./instruments.tsv", import.meta.url), `${rows.join("\n")}\n`);
console.log(`wrote instruments.tsv (${rows.length} instruments)`);
