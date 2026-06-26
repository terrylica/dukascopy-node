#!/usr/bin/env bash
# Parallel dispatcher for the m5 backfill: round-robin the tickers across N workers,
# each with an ISOLATED dukascopy cache (-chpath) so they never contend. Cuts wall-clock ~Nx.
# Each worker runs the resumable fetch_stocks_m5.sh, so completed chunks are skipped on rerun.
#
# Env: WORKERS (default 4), BATCH_SIZE (20), BATCH_PAUSE_MS (400), CHUNK_TIMEOUT (150)
set -uo pipefail
cd "${BASE_DIR:-$HOME/fork-tools/dukascopy-node}" || { echo "FATAL: base dir missing"; exit 2; }

WORKERS="${WORKERS:-4}"
ALL=$(jq -r '.instruments[].ticker' ai-stocks/instruments.json)
mapfile -t TICKERS <<<"$ALL"

# round-robin partition into WORKERS groups
declare -a GROUP
for idx in "${!TICKERS[@]}"; do
  w=$(( idx % WORKERS ))
  GROUP[w]="${GROUP[w]:-} ${TICKERS[idx]}"
done

echo "launching $WORKERS workers over ${#TICKERS[@]} tickers"
pids=()
for ((w=0; w<WORKERS; w++)); do
  grp="$(echo "${GROUP[$w]}" | xargs)"
  [[ -z "$grp" ]] && continue
  log="ai-stocks/fetch.w$w.log"
  echo "  worker $w: $grp  -> $log"
  ONLY="$grp" CACHE_PATH=".dukascopy-cache-w$w" \
    BATCH_SIZE="${BATCH_SIZE:-20}" BATCH_PAUSE_MS="${BATCH_PAUSE_MS:-400}" \
    CHUNK_TIMEOUT="${CHUNK_TIMEOUT:-150}" \
    nohup bash ai-stocks/fetch_stocks_m5.sh >"$log" 2>&1 &
  pids+=("$!")
done
echo "worker PIDs: ${pids[*]}"
echo "monitor: tail -f ai-stocks/fetch.w*.log"
wait
echo "ALL WORKERS DONE"
