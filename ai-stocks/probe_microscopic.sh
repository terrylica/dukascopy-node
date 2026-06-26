#!/usr/bin/env bash
# Microscopic rate-limit probe: fetch ONE trading day of NVDA m5 at a time (the smallest useful
# request), back-to-back, and log rows + cumulative + timing + the exact moment datafeed cuts us off.
# No retry-on-empty / minimal retries so failures are VISIBLE, not masked. Maps the burst ceiling.
#
# Env: IID (default nvdaususd), GAP (sleep secs between requests, default 5), DAYS (space-separated)
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node" || exit 1
IID="${IID:-nvdaususd}"
GAP="${GAP:-5}"
CACHE="/tmp/probe-cache"; rm -rf "$CACHE"
# ~15 consecutive recent trading days (skip weekends)
DAYS="${DAYS:-2025-05-01 2025-05-02 2025-05-05 2025-05-06 2025-05-07 2025-05-08 2025-05-09 2025-05-12 2025-05-13 2025-05-14 2025-05-15 2025-05-16 2025-05-19 2025-05-20 2025-05-21}"

cum=0; i=0; firstfail=""
echo "microscopic probe: $IID, 1 day/request, gap=${GAP}s"
echo "idx date        rows  cum    secs  status"
for d in $DAYS; do
  i=$((i+1))
  rm -rf /tmp/pd; mkdir -p /tmp/pd
  t0=$(date +%s)
  timeout 60 bunx tsx src/cli/index.ts -i "$IID" -from "$d" -to "$d" -t m5 -p bid -v -f csv \
    -df "YYYY-MM-DD HH:mm:ss" -dir /tmp/pd -chpath "$CACHE" -bs 2 -bp 800 -r 1 -rp 1000 \
    >/tmp/pdout 2>&1
  rc=$?; t1=$(date +%s)
  f=$(find /tmp/pd -name '*.csv' 2>/dev/null | head -1)
  rows=$(wc -l < "$f" 2>/dev/null | tr -d ' '); rows=${rows:-0}
  status="ok"
  if grep -qiE 'socket|closed unexpectedly|ECONNRESET|ETIMEDOUT|terminated' /tmp/pdout; then status="SOCKET-CLOSED"; fi
  [[ "$rows" -eq 0 && "$status" == "ok" ]] && status="EMPTY"
  [[ "$rc" -eq 124 ]] && status="TIMEOUT"
  cum=$((cum+rows))
  printf "%-3s %s  %-5s %-6s %-4s %s\n" "$i" "$d" "$rows" "$cum" "$((t1-t0))" "$status"
  # SAFETY: stop at the first push-back so we don't keep hammering a just-recovered IP.
  if [[ "$status" != "ok" ]]; then
    firstfail="$i ($d) after $((i-1)) clean requests / cum=$((cum-rows)) rows"
    echo "STOP: push-back detected — halting probe to protect the IP."
    break
  fi
  sleep "$GAP"
done
echo "---"
[[ -n "$firstfail" ]] && echo "FIRST FAILURE at request #$firstfail" || echo "ALL $i requests succeeded (cum=$cum rows) — no ceiling hit at this rate"
