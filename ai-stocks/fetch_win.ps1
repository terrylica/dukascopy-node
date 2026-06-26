# Ultra-gentle Dukascopy m5 fetch for Jada's residential Windows box.
# Single stream, tiny batches, long pauses, resumable. CIRCUIT BREAKER: aborts on N consecutive
# empty responses (early sign of a block) to protect her residential IP. Be kind to her machine.
param(
  [string[]]$Tickers,            # optional subset
  [string]$FromOverride,         # e.g. 2024-01-01 to clamp history
  [int]$BatchSize = 6,           # single stream, modest concurrency (normal-user territory)
  [int]$BatchPause = 400,        # 0.4s between batches
  [int]$SleepBetween = 12,       # 12s pause between every chunk (gentle, not glacial)
  [int]$AbortAfterEmpty = 3      # stop if this many chunks in a row come back empty
)
$ErrorActionPreference = 'Continue'
$bun  = "$env:USERPROFILE\.bun\bin\bun.exe"
$root = "$env:USERPROFILE\aistk"
$rawd = "$root\raw"
$cache = "$root\.cache"
$instr = Get-Content "$root\instruments.json" -Raw | ConvertFrom-Json
$today = (Get-Date).ToString('yyyy-MM-dd')
$endY  = [int]$today.Substring(0,4)
$consecEmpty = 0
$okCount = 0
Write-Output "fetch start $(Get-Date -Format o)  bs=$BatchSize bp=$BatchPause sleep=${SleepBetween}s abortAfter=$AbortAfterEmpty"

foreach ($row in $instr.instruments) {
  if ($Tickers -and ($Tickers -notcontains $row.ticker)) { continue }
  $t = $row.ticker; $iid = $row.instrument_id; $from = $row.from_date
  if ($FromOverride -and ($FromOverride -gt $from)) { $from = $FromOverride }
  $sy = [int]$from.Substring(0,4)
  New-Item -ItemType Directory -Force -Path "$rawd\$t" | Out-Null
  foreach ($side in 'bid','ask') {
    for ($y = $sy; $y -le $endY; $y++) {
      $final = "$rawd\$t\$iid-m5-$side-$y.csv"
      if (Test-Path $final) { Write-Output "skip $t $side $y"; continue }
      $yf = if ($y -eq $sy)   { $from }  else { "$y-01-01" }
      $yt = if ($y -eq $endY) { $today } else { "$y-12-31" }
      $tmp = "$env:TEMP\aistk_t"
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Force -Path $tmp | Out-Null
      & $bun x dukascopy-node@1.46.4 -i $iid -from $yf -to $yt -t m5 -p $side -v -f csv `
        -df "YYYY-MM-DD HH:mm:ss" -dir $tmp --cache -chpath $cache `
        -bs $BatchSize -bp $BatchPause -r 3 -rp 2000 -re *> "$env:TEMP\aistk_last.log" 2>&1
      $f = Get-ChildItem "$tmp\*.csv" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($f -and $f.Length -gt 0) {
        Move-Item $f.FullName $final -Force
        $rows = (Get-Content $final | Measure-Object -Line).Lines
        Write-Output "ok $t $side $y rows=$rows"
        $consecEmpty = 0; $okCount++
      } else {
        Write-Output "EMPTY $t $side $y"
        $consecEmpty++
        if ($consecEmpty -ge $AbortAfterEmpty) {
          Write-Output "ABORT: $consecEmpty consecutive empties — backing off to protect the residential IP. okCount=$okCount"
          exit 2
        }
      }
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
      Start-Sleep -Seconds $SleepBetween
    }
  }
}
Write-Output "DONE okCount=$okCount $(Get-Date -Format o)"
