#!/usr/bin/env bash
# Full 28-stock freeserv pull + publish. freeserv json3 is server-side (bypasses the datafeed
# IP-block), free, bid+ask, 5-min, full history. Writes raw/<TICKER>/, then builds → S3 → page →
# deploys. Leaves a DONE marker in the log for the progress cron.
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node/ai-stocks" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
LOG=/tmp/freeserv_all.log
echo "$(date -u +%FT%TZ) freeserv full pull START" >"$LOG"
if bun run freeserv_fetch.ts >>"$LOG" 2>&1; then
  echo "$(date -u +%FT%TZ) fetch OK — final publish" >>"$LOG"
  if bash _republish_local.sh final >>"$LOG" 2>&1; then
    echo "$(date -u +%FT%TZ) DONE" >>"$LOG"
  else
    echo "$(date -u +%FT%TZ) PUBLISH-FAILED" >>"$LOG"
  fi
else
  echo "$(date -u +%FT%TZ) FETCH-FAILED" >>"$LOG"
fi
