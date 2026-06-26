# Gentle diagnostic: stop any fetch, read the last dukascopy-node log, one datafeed reachability test.
Get-Process bun,node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "=== last fetch log (was it a block/socket error, or just empty data?) ==="
Get-Content $env:TEMP\aistk_last.log -Tail 25 -ErrorAction SilentlyContinue
Write-Output "=== datafeed reachability (ONE gentle request) ==="
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-WebRequest -Uri 'https://datafeed.dukascopy.com/datafeed/NVDAUSUSD/metadata/HMaxCandles.bi5' -TimeoutSec 15 -UseBasicParsing
  $sw.Stop()
  Write-Output ("datafeed status=" + $r.StatusCode + " bytes=" + $r.RawContentLength + " t=" + [math]::Round($sw.Elapsed.TotalSeconds,2))
} catch {
  Write-Output ("datafeed result: " + $_.Exception.Message)
}
Write-Output "=== raw files present ==="
Get-ChildItem $env:USERPROFILE\aistk\raw -Recurse -Filter *.csv -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + " (" + $_.Length + " bytes)" }
