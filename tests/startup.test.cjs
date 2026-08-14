const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  STARTUP_FILENAME,
  ensureStartupLauncher,
  removeStartupLauncher,
  startupLauncherContents,
  startupLauncherPath,
} = require('../live/startup.js');
const { acquireInstanceLock, releaseInstanceLock } = require('../live/instance-lock.js');

const fakeAppData = path.join('C:', 'Users', 'Player', 'AppData', 'Roaming');
assert.equal(startupLauncherPath(fakeAppData), path.join(
  fakeAppData,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
  STARTUP_FILENAME,
));

const launcher = startupLauncherContents(path.join('C:', 'Games', 'OLYCITY Live'));
assert.match(launcher, /WScript\.Shell/);
assert.match(launcher, /wscript\.exe ""C:\\Games\\OLYCITY Live\\silent\.vbs""/i);
assert.match(launcher, /, 0, False/, 'the Startup launcher must remain invisible');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olycity-lock-'));
const lockPath = path.join(tempDir, '.instance.lock');
try {
  const testAppData = path.join(tempDir, 'AppData', 'Roaming');
  const registration = ensureStartupLauncher(path.join('C:', 'Games', 'OLYCITY Live'), testAppData);
  assert.equal(registration.installed, true);
  assert.equal(registration.changed, true);
  assert.equal(fs.existsSync(registration.path), true);
  assert.equal(ensureStartupLauncher(path.join('C:', 'Games', 'OLYCITY Live'), testAppData).changed, false);
  assert.equal(removeStartupLauncher(testAppData), true);
  assert.equal(fs.existsSync(registration.path), false);

  const thisBoot = 5_000_000;
  const firstStartedAt = 10_000_000;
  assert.equal(acquireInstanceLock(lockPath, 101, () => false, thisBoot, () => 0, firstStartedAt), true);
  assert.equal(
    acquireInstanceLock(lockPath, 202, pid => pid === 101, thisBoot, () => firstStartedAt, firstStartedAt + 1000),
    false,
    'a running owner blocks duplicates',
  );
  assert.equal(releaseInstanceLock(lockPath, 202), false, 'another process cannot release the lock');
  assert.equal(releaseInstanceLock(lockPath, 101), true);

  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 303,
    bootStartedAt: thisBoot,
    startedAt: firstStartedAt,
  }), 'utf8');
  assert.equal(
    acquireInstanceLock(lockPath, 404, pid => pid === 303, thisBoot, () => firstStartedAt + 3_600_000),
    true,
    'a recycled PID on the same Fast Startup boot must not block autostart',
  );
  assert.equal(releaseInstanceLock(lockPath, 404), true);

  fs.writeFileSync(lockPath, JSON.stringify({ pid: 303, bootStartedAt: thisBoot }), 'utf8');
  fs.utimesSync(lockPath, new Date(firstStartedAt), new Date(firstStartedAt));
  assert.equal(
    acquireInstanceLock(lockPath, 404, pid => pid === 303, thisBoot, () => firstStartedAt + 3_600_000),
    true,
    'a legacy lock also detects a recycled PID from its modification time',
  );
  assert.equal(releaseInstanceLock(lockPath, 404), true);

  fs.writeFileSync(lockPath, JSON.stringify({ pid: 303, bootStartedAt: thisBoot - 3_600_000 }), 'utf8');
  assert.equal(
    acquireInstanceLock(lockPath, 404, pid => pid === 303, thisBoot),
    true,
    'a PID reused after a Windows reboot must not block autostart',
  );
  assert.equal(releaseInstanceLock(lockPath, 404), true);

  fs.writeFileSync(lockPath, '303', 'utf8');
  fs.utimesSync(lockPath, new Date(thisBoot - 3_600_000), new Date(thisBoot - 3_600_000));
  assert.equal(acquireInstanceLock(lockPath, 404, () => true, thisBoot), true, 'a legacy lock from a previous boot is repaired');
  assert.equal(releaseInstanceLock(lockPath, 404), true);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('startup: invisible fallback launcher and single-instance lock validated');
