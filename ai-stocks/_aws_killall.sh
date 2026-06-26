#!/usr/bin/env bash
# Definitively stop the backfill: kill dispatchers + fetch loops FIRST (so they stop respawning
# download retries), then the downloaders. Loop until nothing remains.
for i in 1 2 3 4 5 6; do
  pkill -9 -f _aws_orchestrate.sh 2>/dev/null
  pkill -9 -f run_parallel.sh 2>/dev/null
  pkill -9 -f fetch_stocks_m5.sh 2>/dev/null
  pkill -9 -f dukascopy-node 2>/dev/null
  pkill -9 -f '\.bun/bin/bunx' 2>/dev/null
  sleep 2
  n=$(pgrep -f 'run_parallel\.sh|fetch_stocks_m5\.sh|dukascopy-node' 2>/dev/null | wc -l)
  echo "pass $i: remaining=$n"
  [ "$n" -eq 0 ] && break
done
echo "FINAL: dispatchers=$(pgrep -f run_parallel|wc -l) loops=$(pgrep -f fetch_stocks_m5|wc -l) downloaders=$(pgrep -f dukascopy-node|wc -l)"
