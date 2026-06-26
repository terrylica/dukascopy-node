#!/usr/bin/env bash
# Self-healing gentle drip from the home IP. Fetches every (ticker,side,year) chunk SLOWLY,
# marquee-first, resumable. On any push-back (socket-close / empty / timeout) it BACKS OFF for a
# long cooldown and retries — so it rides under Dukascopy's rate limit over days until complete.
# Republishes the page after each ticker. Designed to be launched once (background) on recovery.
#
# Env: BS=2 BP=1200 SLEEP=45 (between chunks) BACKOFF=2400 (40m on push-back) MAXBACKOFFS=40
set -uo pipefail
cd "$HOME/fork-tools/dukascopy-node" || exit 1
ROOT=ai-stocks; INSTR=$ROOT/instruments.json; RAW=$ROOT/raw
CACHE=/tmp/drip-cache
TODAY=$(date +%F); ENDY=${TODAY:0:4}
BS="${BS:-2}"; BP="${BP:-1200}"; SLEEP="${SLEEP:-45}"; BACKOFF="${BACKOFF:-2400}"; MAXBACKOFFS="${MAXBACKOFFS:-40}"
PRIORITY="NVDA AMD AVGO MSFT AAPL AMZN META GOOGL TSLA PLTR"
RUNNER=(bunx tsx src/cli/index.ts)
log(){ echo "$(date -u +%FT%TZ) $*"; }

mapfile -t ALL < <(jq -r '.instruments[] | "\(.ticker) \(.instrument_id) \(.from_date)"' "$INSTR")
# marquee-first ordering
ROWS=()
for pt in $PRIORITY; do for r in "${ALL[@]}"; do [[ "${r%% *}" == "$pt" ]] && ROWS+=("$r"); done; done
for r in "${ALL[@]}"; do t="${r%% *}"; [[ " $PRIORITY " == *" $t "* ]] || ROWS+=("$r"); done

# Fetch one chunk, self-healing: retry through push-backs with long cooldowns.
fetch_one(){
  local iid=$1 side=$2 yf=$3 yt=$4 out=$5 backoffs=0
  while :; do
    rm -rf /tmp/dt; mkdir -p /tmp/dt
    timeout 200 "${RUNNER[@]}" -i "$iid" -from "$yf" -to "$yt" -t m5 -p "$side" -v -f csv \
      -df "YYYY-MM-DD HH:mm:ss" -dir /tmp/dt -chpath "$CACHE" -bs "$BS" -bp "$BP" -r 2 -rp 2500 -re \
      >/tmp/dterr 2>&1
    local f rows=0; f=$(find /tmp/dt -name '*.csv' | head -1)
    [[ -s "$f" ]] && rows=$(wc -l <"$f")
    if [[ "$rows" -gt 50 ]]; then mv "$f" "$out"; rm -rf /tmp/dt; log "ok  $(basename "$out") rows=$rows"; return 0; fi
    if grep -qiE 'socket|closed unexpectedly|ETIMEDOUT|ECONNRESET|terminated' /tmp/dterr || [[ "$rows" -eq 0 ]]; then
      backoffs=$((backoffs+1))
      if (( backoffs > MAXBACKOFFS )); then log "GIVE UP $(basename "$out") after $backoffs backoffs"; rm -rf /tmp/dt; return 1; fi
      log "push-back $(basename "$out") (rows=$rows) — cooldown ${BACKOFF}s [$backoffs/$MAXBACKOFFS]"
      rm -rf /tmp/dt; sleep "$BACKOFF"; continue
    fi
    # non-empty but small = genuinely sparse year -> accept
    mv "$f" "$out"; rm -rf /tmp/dt; log "accept $(basename "$out") rows=$rows (sparse)"; return 0
  done
}

log "DRIP START  bs=$BS bp=$BP sleep=${SLEEP}s backoff=${BACKOFF}s"
for row in "${ROWS[@]}"; do
  read -r t iid from <<<"$row"
  sy=${from:0:4}; outdir=$RAW/$t; mkdir -p "$outdir"; newdata=0
  for side in bid ask; do
    for ((y=sy; y<=ENDY; y++)); do
      out=$outdir/${iid}-m5-${side}-${y}.csv
      [[ -s "$out" ]] && continue
      if [[ "$y" -eq "$sy" ]]; then yf="$from"; else yf="$y-01-01"; fi
      if [[ "$y" -eq "$ENDY" ]]; then yt="$TODAY"; else yt="$y-12-31"; fi
      fetch_one "$iid" "$side" "$yf" "$yt" "$out" && newdata=1
      sleep "$SLEEP"
    done
  done
  if [[ "$newdata" -eq 1 ]]; then
    log "republish after $t"; bash "$ROOT/_republish_local.sh" >/tmp/drip-republish.log 2>&1 || log "republish warn"
  fi
done
bash "$ROOT/_republish_local.sh" final >/tmp/drip-republish.log 2>&1 || true
log "DRIP COMPLETE"
