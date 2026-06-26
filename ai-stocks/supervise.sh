#!/usr/bin/env bash
# Self-sustaining supervisor for the AI-stocks gentle pull. Keeps the resumable year-chunked
# fetcher alive (restarts it if it dies, e.g. after a transient push-back), and republishes the
# public page incrementally (~every 20 min) as data lands — until the fetcher finishes a full pass
# (sentinel .fetch-complete), then does one final publish (partial banner dropped) and exits.
# Launch once under nohup; survives this REPL. Respects Dukascopy's rate limit (gentle bs/bp).
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node" || exit 1
LOG=/tmp/ai_stocks_supervise.log
SENTINEL=ai-stocks/.fetch-complete
export PRIORITY="NVDA AMD AVGO MSFT AAPL AMZN META GOOGL GOOG TSLA PLTR"
export BATCH_SIZE=6 BATCH_PAUSE_MS=800 RETRIES=4 ART_RETRIES=6 RETRY_PAUSE=1500
log(){ echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }

log "supervisor start (pid $$)"
last_pub=0
while :; do
  if [[ -f "$SENTINEL" ]]; then
    log "sentinel present — final republish + exit"
    if bash ai-stocks/_republish_local.sh final >>"$LOG" 2>&1; then log "FINAL republish ok"; else log "final republish FAILED"; fi
    rm -f "$SENTINEL"
    log "supervisor done"
    exit 0
  fi
  if ! pgrep -f "fetch_stocks_m5.sh" >/dev/null 2>&1; then
    log "fetcher not running — (re)launching wrapped with completion sentinel"
    nohup bash -c 'bash ai-stocks/fetch_stocks_m5.sh && touch ai-stocks/.fetch-complete' >>/tmp/fetch_all.log 2>&1 &
    sleep 25
  fi
  now=$(date +%s)
  if (( now - last_pub > 1200 )); then
    log "incremental republish"
    if bash ai-stocks/_republish_local.sh >>"$LOG" 2>&1; then log "republish ok"; else log "republish FAILED (will retry)"; fi
    last_pub=$now
  fi
  sleep 120
done
