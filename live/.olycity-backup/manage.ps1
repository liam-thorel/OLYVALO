param(
  [ValidateSet('status', 'stop')]
  [string]$Action = 'status'
)

$targetScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'index.js'))
$escapedTarget = [regex]::Escape($targetScript)
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedTarget })

if ($Action -eq 'stop') {
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

if ($processes.Count -gt 0) {
  Write-Output "RUNNING"
  exit 0
}

Write-Output "STOPPED"
exit 1
