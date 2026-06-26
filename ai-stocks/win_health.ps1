# Minimal gentle health check of Jada's IP: ONE freeserv request + list any fetched files w/ row counts.
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-WebRequest -Uri 'https://freeserv.dukascopy.com/2.0/index.php?path=common%2Finstruments' -Headers @{referer='https://freeserv.dukascopy.com/'} -TimeoutSec 15 -UseBasicParsing
  $sw.Stop()
  Write-Output ("freeserv=" + $r.StatusCode + " bytes=" + $r.RawContentLength + " t=" + [math]::Round($sw.Elapsed.TotalSeconds,2) + "s")
} catch {
  Write-Output ("freeserv ERR: " + $_.Exception.Message)
}
$f = Get-ChildItem $env:USERPROFILE\aistk\raw -Recurse -Filter *.csv -ErrorAction SilentlyContinue
if (-not $f) { Write-Output "no raw files" }
foreach ($x in $f) {
  $rows = (Get-Content $x.FullName | Measure-Object -Line).Lines
  Write-Output ($x.Name + " rows=" + $rows + " bytes=" + $x.Length)
}
