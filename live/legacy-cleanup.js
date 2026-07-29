const { execFileSync } = require('child_process');

function legacyCleanupScript() {
  return [
    "$legacy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
    "  ($_.Name -ieq 'olycity-live.exe') -or",
    "  ((@('python.exe','pythonw.exe') -contains $_.Name) -and $_.CommandLine -match '(?i)olycity[_-]live\\.py')",
    '})',
    'foreach ($process in $legacy) {',
    '  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue',
    '}',
    'Write-Output $legacy.Count',
  ].join('\n');
}

function stopLegacyLiveProcesses(run = execFileSync) {
  if (process.platform !== 'win32') return 0;
  try {
    const output = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', legacyCleanupScript()],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    return Number.parseInt(String(output).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

module.exports = { legacyCleanupScript, stopLegacyLiveProcesses };
