#!/usr/bin/env bash
# Fetch 5-minute OHLCV (bid AND ask) for the AI US-stock universe in instruments.json,
# using our dukascopy-node fork CLI.
#
# ROBUSTNESS: fetch is CHUNKED PER YEAR (the proven mql5 fetch_dukascopy_coverage.sh pattern).
# A single 9-year m5 request truncates the whole side if any date chunk errors; per-year
# chunks isolate failures, are retriable, and make the run resumable (completed years are skipped).
#
# Dukascopy stock CFDs expose quotes only (no trades) -> we pull bid AND ask; mid is computed
# downstream. Timestamps are UTC. Candle schema: timestamp,open,high,low,close,volume.
#
# Output: raw/<ticker>/<id>-m5-<side>-<year>.csv   (deterministic per-year names)
#
# Env overrides:
#   TO_DATE=YYYY-MM-DD   end date for the final (current) year (default: today)
#   BATCH_SIZE=20        dukascopy-node -bs (m5 is light; faster than the tick default of 10)
#   BATCH_PAUSE_MS=400   dukascopy-node -bp
#   RETRIES=3            per-chunk retry attempts
#   ONLY="NVDA AMD"      restrict to a subset of tickers (default: all)
set -uo pipefail

# BASE_DIR = working dir (default: the fork). On a cloud box set BASE_DIR to a work dir holding ai-stocks/.
cd "${BASE_DIR:-$HOME/fork-tools/dukascopy-node}" || { echo "FATAL: base dir missing"; exit 2; }
ROOT="ai-stocks"
INSTR="$ROOT/instruments.json"
TODAY="${TO_DATE:-$(date +%F)}"
END_YEAR="${TODAY:0:4}"
BS="${BATCH_SIZE:-20}"
BP="${BATCH_PAUSE_MS:-400}"
RETRIES="${RETRIES:-3}"
ONLY="${ONLY:-}"
CACHE_PATH="${CACHE_PATH:-.dukascopy-cache}"  # isolate per parallel worker to avoid contention
# ROBUST RETRIES — without these, dukascopy-node SILENTLY drops throttled/empty sub-artifacts
# and exits 0, producing truncated chunks (verified: ask-2018 1405 rows -> 19385 with retries).
# -re retries empty responses; -r/-rp retry failed artifacts. This makes throttling harmless.
ART_RETRIES="${ART_RETRIES:-6}"
RETRY_PAUSE="${RETRY_PAUSE:-1500}"
# RUNNER: default to the fork CLI; override via DUKA_RUNNER for the published package on a cloud box,
# e.g. DUKA_RUNNER="bunx dukascopy-node@1.46.4"
if [[ -n "${DUKA_RUNNER:-}" ]]; then read -ra RUNNER <<<"$DUKA_RUNNER"; else RUNNER=(bunx tsx src/cli/index.ts); fi

[[ -f "$INSTR" ]] || { echo "FATAL: $INSTR missing (run gen_instruments.ts first)"; exit 2; }
mapfile -t ROWS < <(jq -r '.instruments[] | "\(.ticker) \(.instrument_id) \(.from_date)"' "$INSTR")

# PRIORITY (space-separated tickers) fetches those first, in the given order, then the rest.
if [[ -n "${PRIORITY:-}" ]]; then
  declare -a _ORD=()
  for _pt in $PRIORITY; do
    for _row in "${ROWS[@]}"; do [[ "${_row%% *}" == "$_pt" ]] && _ORD+=("$_row"); done
  done
  for _row in "${ROWS[@]}"; do
    _t="${_row%% *}"
    [[ " $PRIORITY " == *" $_t "* ]] || _ORD+=("$_row")
  done
  ROWS=("${_ORD[@]}")
fi

# Minimum expected rows for a chunk's [yfrom,yto] span — a completeness floor that catches
# gross truncation. ~8 rows/calendar-day is ~10% of the theoretical m5 RTH density (78/day),
# low enough to avoid false positives but high enough to catch the 1405-vs-19385 truncation.
min_rows_for() {
  local a b days
  a=$(date -j -f "%Y-%m-%d" "$1" +%s 2>/dev/null) || { echo 0; return; }
  b=$(date -j -f "%Y-%m-%d" "$2" +%s 2>/dev/null) || { echo 0; return; }
  days=$(( (b - a) / 86400 )); (( days < 1 )) && days=1
  echo $(( days * 8 ))
}

# Fetch one (instrument, side, year) chunk. Robust artifact retries (-r/-rp/-re) defeat silent
# truncation. The completeness floor is a TARGET, not a gate: we keep the BEST (max-rows) result
# across attempts, stop early once the floor is met, and ACCEPT the best-effort result for
# genuinely-sparse years (never discard real data). Only a totally-empty result is a failure.
fetch_chunk() {
  local iid="$1" side="$2" year="$3" yfrom="$4" yto="$5" outdir="$6"
  local final="$outdir/${iid}-m5-${side}-${year}.csv"
  local min; min=$(min_rows_for "$yfrom" "$yto")
  local best=0
  if [[ -s "$final" ]]; then
    best=$(wc -l <"$final")
    (( best >= min )) && { echo "      skip $year (have $best rows)"; return 0; }
    echo "      improve $year (have $best < floor $min)"
  fi
  local tmp="$outdir/.tmp-${side}-${year}"
  for attempt in $(seq 1 "$RETRIES"); do
    rm -rf "$tmp"; mkdir -p "$tmp"
    if timeout --kill-after=10 "${CHUNK_TIMEOUT:-420}" "${RUNNER[@]}" \
         -i "$iid" -from "$yfrom" -to "$yto" -t m5 -p "$side" -v -f csv \
         -df "YYYY-MM-DD HH:mm:ss" -dir "$tmp" --cache -chpath "$CACHE_PATH" \
         -bs "$BS" -bp "$BP" -r "$ART_RETRIES" -rp "$RETRY_PAUSE" -re >/dev/null 2>&1; then
      local produced; produced=$(find "$tmp" -maxdepth 1 -name '*.csv' | head -1)
      if [[ -s "$produced" ]]; then
        local rows; rows=$(wc -l <"$produced")
        if (( rows > best )); then mv -f "$produced" "$final"; best=$rows; fi
        if (( best >= min )); then rm -rf "$tmp"; echo "      ok   $year $best rows"; return 0; fi
        echo "      short $year (best $best < floor $min, attempt $attempt/$RETRIES)"
      fi
    else
      echo "      retry $year (attempt $attempt/$RETRIES)"
    fi
    rm -rf "$tmp"; sleep 3
  done
  if (( best > 0 )); then echo "      accept $year $best rows (sparse/best-effort, floor $min)"; return 0; fi
  echo "      WARN $year NO DATA after $RETRIES attempts"; return 1
}

total=${#ROWS[@]}; i=0; chunks_ok=0; chunks_fail=0
echo "AI-stock m5 backfill (year-chunked): $total instruments x {bid,ask}  ..$TODAY  (bs=$BS bp=$BP)"
for row in "${ROWS[@]}"; do
  read -r ticker iid from <<<"$row"
  if [[ -n "$ONLY" && ! " $ONLY " == *" $ticker "* ]]; then continue; fi
  # FROM_OVERRIDE clamps the start later (e.g. a quick recent-history demo pass). Lexicographic
  # compare works for YYYY-MM-DD. A later full pass with no override resume-fills the earlier years.
  if [[ -n "${FROM_OVERRIDE:-}" && "$FROM_OVERRIDE" > "$from" ]]; then from="$FROM_OVERRIDE"; fi
  i=$((i+1))
  start_year="${from:0:4}"
  outdir="$ROOT/raw/$ticker"; mkdir -p "$outdir"
  echo "[$i/$total] $ticker ($iid)  years $start_year..$END_YEAR"
  for side in bid ask; do
    echo "    $side:"
    for ((year=start_year; year<=END_YEAR; year++)); do
      if [[ "$year" -eq "$start_year" ]]; then yfrom="$from"; else yfrom="$year-01-01"; fi
      if [[ "$year" -eq "$END_YEAR" ]]; then yto="$TODAY"; else yto="$year-12-31"; fi
      if fetch_chunk "$iid" "$side" "$year" "$yfrom" "$yto" "$outdir"; then
        chunks_ok=$((chunks_ok+1)); else chunks_fail=$((chunks_fail+1)); fi
    done
  done
done
echo "DONE: chunks ok=$chunks_ok fail=$chunks_fail"
[[ $chunks_fail -eq 0 ]] || exit 3
