# One clean NVDA-2025 chunk test (full year, sane-gentle settings). Confirms whether Jada's
# residential IP returns FULL data (~19k rows) or goes EMPTY (throttle -> stop).
$bun  = "$env:USERPROFILE\.bun\bin\bun.exe"
$root = "$env:USERPROFILE\aistk"
Remove-Item "$root\raw\NVDA\*" -Force -ErrorAction SilentlyContinue
Remove-Item "$root\t1" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$root\t1" | Out-Null
& $bun x dukascopy-node@1.46.4 -i nvdaususd -from 2025-01-01 -to 2025-12-31 -t m5 -p bid -v -f csv `
  -df "YYYY-MM-DD HH:mm:ss" -dir "$root\t1" --cache -chpath "$root\.cache" -bs 6 -bp 400 -r 3 -rp 2000 -re
$f = Get-ChildItem "$root\t1\*.csv" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($f -and $f.Length -gt 0) {
  $rows = (Get-Content $f.FullName | Measure-Object -Line).Lines
  Write-Output ("RESULT NVDA-2025-bid rows=" + $rows + " bytes=" + $f.Length)
} else {
  Write-Output "RESULT EMPTY"
}
