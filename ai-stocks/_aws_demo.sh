#!/usr/bin/env bash
# Fast SHALLOW demo pass on aws-dev: marquee AI stocks, recent history only, BOTH sides,
# single sequential process. Gets a publishable partial page in ~15 min. The later deep
# full-history pass resume-fills the earlier years (these recent chunks are skipped).
cd "$HOME/dukascopy-fetch" || { echo "FATAL: workdir missing"; exit 1; }
export BASE_DIR="$HOME/dukascopy-fetch"
export DUKA_RUNNER="$HOME/.bun/bin/bunx dukascopy-node@1.46.4"
export PATH="$HOME/.bun/bin:$PATH"
export ONLY="${ONLY:-NVDA AMD AVGO MSFT AAPL AMZN META GOOGL TSLA PLTR}"
export FROM_OVERRIDE="${FROM_OVERRIDE:-2024-01-01}"
export BATCH_SIZE=20 BATCH_PAUSE_MS=120 ART_RETRIES=4 RETRY_PAUSE=600 CHUNK_TIMEOUT=300
export CACHE_PATH=.dukascopy-cache-demo
nohup bash ai-stocks/fetch_stocks_m5.sh > ai-stocks/demo.log 2>&1 &
echo "demo pass PID $! on $(hostname) — marquee from $FROM_OVERRIDE"
