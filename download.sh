#!/usr/bin/env bash
set -euo pipefail

INSTRUMENT="$1"
FROM_DATE="$2"
PRICE_TYPE="$3"

cd ~/fork-tools/dukascopy-node

~/.bun/bin/bunx tsx src/cli/index.ts \
  -i "$INSTRUMENT" \
  -from "$FROM_DATE" \
  -to 2026-02-09 \
  -t h1 \
  -p "$PRICE_TYPE" \
  -v \
  -f csv \
  -df "YYYY-MM-DD HH:mm:ss" \
  -dir data \
  -bs 30 \
  -bp 500
