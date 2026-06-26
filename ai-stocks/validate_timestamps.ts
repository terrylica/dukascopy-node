/**
 * Thorough timestamp / timezone integrity validation across EVERY instrument's raw 5-min CSVs.
 * PROCESS-STORM-OK: pure in-process file reads, no subprocess spawning.
 * Checks per file: format (YYYY-MM-DD HH:MM:SS), seconds==00, 5-min alignment, strict monotonic
 * increase, no duplicates. Aggregates the time-of-day window to confirm UTC labeling.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAW = join(new URL(".", import.meta.url).pathname, "raw");
const FIVE_MIN = 300_000;
const tickers = readdirSync(RAW).filter((d) => existsSync(join(RAW, d)) && !d.startsWith("_") && !d.startsWith("."));

interface Agg { rows: number; fmtBad: number; secBad: number; alignBad: number; nonMono: number; dupes: number; minTod: string; maxTod: string; minDate: string; maxDate: string }
const tsRe = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

let gRows = 0, gFmt = 0, gSec = 0, gAlign = 0, gMono = 0, gDup = 0, gFiles = 0;

for (const tk of tickers.toSorted()) {
  const dir = join(RAW, tk);
  const files = readdirSync(dir).filter((f) => f.endsWith(".csv"));
  const a: Agg = { rows: 0, fmtBad: 0, secBad: 0, alignBad: 0, nonMono: 0, dupes: 0, minTod: "99:99", maxTod: "00:00", minDate: "9999", maxDate: "0000" };
  for (const f of files) {
    gFiles++;
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    let prev = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const ts = line.slice(0, line.indexOf(","));
      const m = tsRe.exec(ts);
      a.rows++;
      if (!m) { a.fmtBad++; continue; }
      const [, Y, Mo, D, H, Mi, S] = m;
      if (S !== "00") a.secBad++;
      const epoch = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
      if (epoch % FIVE_MIN !== 0) a.alignBad++;
      if (prev >= 0) { if (epoch < prev) a.nonMono++; if (epoch === prev) a.dupes++; }
      prev = epoch;
      const tod = `${H}:${Mi}`;
      if (tod < a.minTod) a.minTod = tod;
      if (tod > a.maxTod) a.maxTod = tod;
      const date = `${Y}-${Mo}-${D}`;
      if (date < a.minDate) a.minDate = date;
      if (date > a.maxDate) a.maxDate = date;
    }
  }
  gRows += a.rows; gFmt += a.fmtBad; gSec += a.secBad; gAlign += a.alignBad; gMono += a.nonMono; gDup += a.dupes;
  const bad = a.fmtBad + a.secBad + a.alignBad + a.nonMono + a.dupes;
  console.log(`${tk.padEnd(6)} rows=${String(a.rows).padStart(7)} tod=${a.minTod}..${a.maxTod} dates=${a.minDate}..${a.maxDate} ${bad ? `BAD fmt=${a.fmtBad} sec=${a.secBad} align=${a.alignBad} mono=${a.nonMono} dup=${a.dupes}` : "OK"}`);
}

console.log(`\n=== GLOBAL ===`);
console.log(`tickers=${tickers.length} files=${gFiles} rows=${gRows.toLocaleString()}`);
console.log(`format_bad=${gFmt} seconds_bad=${gSec} align_bad=${gAlign} non_monotonic=${gMono} duplicates=${gDup}`);
console.log(gFmt + gSec + gAlign + gMono + gDup === 0 ? "ALL TIMESTAMP CHECKS PASSED" : "TIMESTAMP ISSUES FOUND");
