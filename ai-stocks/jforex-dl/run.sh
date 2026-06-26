#!/usr/bin/env bash
# Headless JForex historical downloader (ITesterClient path — US stock CFDs allowed since a backtest
# client is not "automated trading"). Connects to the authenticated demo server (bypasses the
# datafeed CDN IP-block) and exports 5-min BID+ASK OHLCV CSV into ../raw/<TICKER>/.
# Usage:  JFOREX_USER=.. JFOREX_PASS=.. ./run.sh [TICKER]   (TICKER optional: single-stock test)
set -euo pipefail
cd "$(dirname "$0")"
eval "$(mise env)"
: "${JFOREX_USER:?set JFOREX_USER}"
: "${JFOREX_PASS:?set JFOREX_PASS}"
OUT="${OUT:-../raw}"
TICKER="${1:-}"
mvn -q -DskipTests compile 1>&2
mvn -q dependency:build-classpath -Dmdep.outputFile=/tmp/cp.txt 1>&2
CP="target/classes:$(cat /tmp/cp.txt)"
echo "[run] launching tester downloader (out=$OUT ticker=${TICKER:-ALL})" 1>&2
exec java -cp "$CP" dl.TesterMain instruments.tsv "$OUT" "$TICKER"
