const fs = require('fs');

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireInstanceLock(lockPath, pid = process.pid, isRunning = pidIsRunning) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, String(pid), 'utf8');
      fs.closeSync(descriptor);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existingPid = 0;
      try {
        existingPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10) || 0;
      } catch {}
      if (existingPid && isRunning(existingPid)) return false;
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
  return false;
}

function releaseInstanceLock(lockPath, pid = process.pid) {
  try {
    const ownerPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10) || 0;
    if (ownerPid !== pid) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { acquireInstanceLock, pidIsRunning, releaseInstanceLock };
