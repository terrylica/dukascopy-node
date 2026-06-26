#!/usr/bin/env bash
# One monitor cycle: pull latest Dukascopy data from aws-dev, rebuild, re-upload to S3, and
# redeploy https://eon.25u.com/ai-stocks/. Prints FETCH_COMPLETE when the backfill is fully done.
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node/ai-stocks" || exit 1
export PATH="/opt/homebrew/bin:$PATH"

rsync -az aws-dev:'~/dukascopy-fetch/ai-stocks/raw/' raw/ 2>/dev/null || echo "warn: rsync failed"
DONE=$(ssh -o ConnectTimeout=10 aws-dev 'cat ~/dukascopy-fetch/ai-stocks/FETCH_DONE.txt 2>/dev/null' 2>/dev/null || true)

bun run build_outputs.ts >/tmp/aistk-build.log 2>&1 || { echo "build failed"; tail -3 /tmp/aistk-build.log; exit 1; }
built=$(grep -c '^  OK' /tmp/aistk-build.log || true)

AWS_PROFILE=el-dev AWS_REGION=us-west-2 bun run upload_s3.ts >/tmp/aistk-upload.log 2>&1 || { echo "upload failed"; tail -3 /tmp/aistk-upload.log; exit 1; }

if [[ -n "$DONE" ]]; then
  bun run render_page.ts >/tmp/aistk-render.log 2>&1
else
  PARTIAL_NOTE="Live build — ${built} stocks ready; full 28-stock multi-year history still downloading." \
    bun run render_page.ts >/tmp/aistk-render.log 2>&1
fi

scp -q site/index.html bigblack:/tmp/ai-stocks-index.html
ssh bigblack 'sudo cp /tmp/ai-stocks-index.html /var/www/eon-25u-com-openclaw-guide/ai-stocks/index.html'

echo "republished ${built} stocks at $(date -u +%FT%TZ)"
[[ -n "$DONE" ]] && echo "FETCH_COMPLETE — $DONE"
exit 0
