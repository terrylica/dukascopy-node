#!/usr/bin/env bash
# Remote launcher for the Dukascopy backfill on aws-dev (clean, un-throttled IP).
# Uses the PUBLISHED dukascopy-node via bunx (no fork needed on the box).
cd "$HOME/dukascopy-fetch" || { echo "FATAL: workdir missing"; exit 1; }
export BASE_DIR="$HOME/dukascopy-fetch"
export DUKA_RUNNER="$HOME/.bun/bin/bunx dukascopy-node@1.46.4"
export PATH="$HOME/.bun/bin:$PATH"
export WORKERS="${WORKERS:-6}" BATCH_SIZE="${BATCH_SIZE:-10}" BATCH_PAUSE_MS="${BATCH_PAUSE_MS:-300}"
export ART_RETRIES="${ART_RETRIES:-6}" RETRY_PAUSE="${RETRY_PAUSE:-1200}" CHUNK_TIMEOUT="${CHUNK_TIMEOUT:-300}"
nohup bash ai-stocks/run_parallel.sh > ai-stocks/parallel.log 2>&1 &
echo "launched dispatcher PID $! on $(hostname) with WORKERS=$WORKERS"
