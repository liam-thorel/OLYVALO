const fs = require('fs');
const os = require('os');

const BOOT_TOLERANCE_MS = 2 * 60 * 1000;

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

function acquireInstanceLock(
  lockPath,
  pid = process.pid,
  isRunning = pidIsRunning,
  bootStartedAt = currentBootStartedAt(),
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify({ pid, bootStartedAt: Math.round(bootStartedAt) }), 'utf8');
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
      if (sameBoot && existing.pid && isRunning(existing.pid)) return false;
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

module.exports = { acquireInstanceLock, currentBootStartedAt, parseLock, pidIsRunning, releaseInstanceLock };
