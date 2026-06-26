#!/usr/bin/env bash
# Rebuild + re-upload + redeploy the page from LOCAL raw/ (used by the home-IP drip).
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node/ai-stocks" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
FINAL="${1:-}"   # pass "final" to drop the partial banner

bun run build_outputs.ts >/tmp/aistk-build.log 2>&1 || { echo "build failed"; tail -3 /tmp/aistk-build.log; exit 1; }
built=$(grep -c '^  OK' /tmp/aistk-build.log || true)
AWS_PROFILE=el-dev AWS_REGION=us-west-2 bun run upload_s3.ts >/tmp/aistk-upload.log 2>&1 || { echo "upload failed"; tail -3 /tmp/aistk-upload.log; exit 1; }

if [[ "$FINAL" == "final" ]]; then
  bun run render_page.ts >/tmp/aistk-render.log 2>&1
else
  PARTIAL_NOTE="Live build — ${built}/28 stocks ready; the rest is trickling in slowly to respect Dukascopy's rate limit." \
    bun run render_page.ts >/tmp/aistk-render.log 2>&1
fi
scp -q site/index.html bigblack:/tmp/ai-stocks-index.html
ssh bigblack 'sudo cp /tmp/ai-stocks-index.html /var/www/eon-25u-com-openclaw-guide/ai-stocks/index.html'
echo "republished ${built} stocks $(date -u +%FT%TZ)"
