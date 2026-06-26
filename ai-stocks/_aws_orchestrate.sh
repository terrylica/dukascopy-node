#!/usr/bin/env bash
# Self-driving orchestrator on aws-dev: wait for the demo pass to finish, then run the DEEP
# full-history backfill (all instruments, all years, sequential, marquee-first), then stamp
# ai-stocks/FETCH_DONE.txt. Launched once via nohup; survives ssh disconnect.
cd "$HOME/dukascopy-fetch" || exit 1
export BASE_DIR="$HOME/dukascopy-fetch"
export DUKA_RUNNER="$HOME/.bun/bin/bunx dukascopy-node@1.46.4"
export PATH="$HOME/.bun/bin:$PATH"
LOG=ai-stocks/orchestrate.log
echo "orchestrator start $(date -u +%FT%TZ)" > "$LOG"

# 1) wait for the demo fetch (a fetch_stocks_m5.sh) to finish
while pgrep -f fetch_stocks_m5.sh >/dev/null; do sleep 20; done
echo "demo finished $(date -u +%FT%TZ)" >> "$LOG"

# 2) deep full backfill — all tickers, all years, single sequential stream, marquee-first
rm -f ai-stocks/FETCH_DONE.txt
export PRIORITY="NVDA AMD AVGO MSFT AAPL AMZN META GOOGL TSLA PLTR"
export BATCH_SIZE=20 BATCH_PAUSE_MS=80 ART_RETRIES=5 RETRY_PAUSE=800 CHUNK_TIMEOUT=400
export CACHE_PATH=.dukascopy-cache-deep
bash ai-stocks/fetch_stocks_m5.sh >> "$LOG" 2>&1

# 3) stamp completion
{ echo "DEEP_DONE $(date -u +%FT%TZ)"
  echo "chunks=$(find ai-stocks/raw -name '*.csv' | wc -l)"
  echo "tickers=$(find ai-stocks/raw -mindepth 1 -maxdepth 1 -type d | wc -l)"; } > ai-stocks/FETCH_DONE.txt
echo "orchestrator done $(date -u +%FT%TZ)" >> "$LOG"
