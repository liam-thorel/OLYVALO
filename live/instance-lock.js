const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const BOOT_TOLERANCE_MS = 2 * 60 * 1000;
const PROCESS_START_TOLERANCE_MS = 2 * 60 * 1000;

function currentBootStartedAt() {
  return Date.now() - (os.uptime() * 1000);
}

function parseLock(contents) {
  const raw = String(contents || '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isInteger(parsed.pid)) return parsed;
  } catch {}
  const pid = Number.parseInt(raw, 10) || 0;
  return { pid, bootStartedAt: 0 };
}

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function processStartedAt(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return 0;
  try {
    const command = [
      `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue`,
      "if ($process) { $process.CreationDate.ToUniversalTime().ToString('o') }",
    ].join('; ');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }).trim();
    const timestamp = Date.parse(output);
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

function acquireInstanceLock(
  lockPath,
  pid = process.pid,
  isRunning = pidIsRunning,
  bootStartedAt = currentBootStartedAt(),
  startedAtLookup = processStartedAt,
  startedAt = Date.now(),
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify({
        pid,
        bootStartedAt: Math.round(bootStartedAt),
        startedAt: Math.round(startedAt),
      }), 'utf8');
      fs.closeSync(descriptor);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing = { pid: 0, bootStartedAt: 0 };
      let modifiedAt = 0;
      try {
        existing = parseLock(fs.readFileSync(lockPath, 'utf8'));
        modifiedAt = fs.statSync(lockPath).mtimeMs;
      } catch {}
      const sameBoot = existing.bootStartedAt
        ? Math.abs(existing.bootStartedAt - bootStartedAt) <= BOOT_TOLERANCE_MS
        : modifiedAt >= bootStartedAt - BOOT_TOLERANCE_MS;
      const expectedStartedAt = Number(existing.startedAt || modifiedAt || 0);
      const actualStartedAt = sameBoot && existing.pid && isRunning(existing.pid)
        ? Number(startedAtLookup(existing.pid) || 0)
        : 0;
      const sameProcess = actualStartedAt <= 0 || expectedStartedAt <= 0
        || Math.abs(actualStartedAt - expectedStartedAt) <= PROCESS_START_TOLERANCE_MS;
      if (sameBoot && existing.pid && isRunning(existing.pid) && sameProcess) return false;
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
  return false;
}

function releaseInstanceLock(lockPath, pid = process.pid) {
  try {
    const ownerPid = parseLock(fs.readFileSync(lockPath, 'utf8')).pid;
    if (ownerPid !== pid) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  acquireInstanceLock,
  currentBootStartedAt,
  parseLock,
  pidIsRunning,
  processStartedAt,
  releaseInstanceLock,
};
