# Gentle probe of Jada's Windows box: identity, ONE Dukascopy reachability request, tool inventory.
Write-Output ("HOST=" + $env:COMPUTERNAME + " USER=" + $env:USERNAME)
$url = 'https://freeserv.dukascopy.com/2.0/index.php?path=common%2Finstruments'
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $resp = Invoke-WebRequest -Uri $url -Headers @{referer='https://freeserv.dukascopy.com/'} -TimeoutSec 15 -UseBasicParsing
  $sw.Stop()
  Write-Output ("freeserv OK status=" + $resp.StatusCode + " bytes=" + $resp.RawContentLength + " t=" + [math]::Round($sw.Elapsed.TotalSeconds,2) + "s")
} catch {
  Write-Output ("freeserv FAILED: " + $_.Exception.Message)
}
foreach ($t in 'bun','node','npx','wsl','git','tar') {
  $c = Get-Command $t -ErrorAction SilentlyContinue
  if ($c) { Write-Output ($t + " => " + $c.Source) } else { Write-Output ($t + " => NONE") }
}
$mem = Get-CimInstance Win32_OperatingSystem
Write-Output ("RAM free MB=" + [math]::Round($mem.FreePhysicalMemory/1024) + " / total MB=" + [math]::Round($mem.TotalVisibleMemorySize/1024))
