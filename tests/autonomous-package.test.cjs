const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const liveDir = path.join(__dirname, '..', 'live');
const read = file => fs.readFileSync(path.join(liveDir, file), 'utf8');
const installer = read('INSTALLER.bat');
const launcher = read('OLYCITY-LIVE.bat');
const silent = read('silent.vbs');
const uninstaller = read('DESINSTALLER.bat');
const reinstaller = read('REINSTALLER.bat');
const verifier = read('VERIFIER.bat');
const liveIndex = read('index.js');
const startup = read('startup.js');
const instanceLock = read('instance-lock.js');
const legacyCleanup = read('legacy-cleanup.js');

for (const contents of [installer, launcher, silent, uninstaller, reinstaller, verifier, startup, instanceLock, legacyCleanup]) {
  assert.doesNotMatch(contents, /\bnpm(?:\.cmd)?\b/i);
  assert.doesNotMatch(contents, /taskkill\s+.*\/im\s+(?:node|wscript)/i);
}

assert.match(installer, /runtime\\node\.exe/i);
assert.match(installer, /node_modules\\ws\\index\.js/i);
assert.match(installer, /\/rl LIMITED/i);
assert.match(installer, /startup\.js" install/i);
assert.match(silent, /runtime\\node\.exe/i);
assert.match(launcher, /runtime\\node\.exe/i);
assert.match(verifier, /manage\.ps1" status/i);
assert.match(uninstaller, /manage\.ps1" stop/i);
assert.match(uninstaller, /startup\.js" remove/i);
assert.match(reinstaller, /INSTALLER\.bat/i);
assert.doesNotMatch(liveIndex, /\bexecSync\s*\(/, 'the live poll must not invoke commands through a visible cmd shell');
assert.match(liveIndex, /execFileSync\('netstat\.exe'/, 'netstat must be launched directly');
assert.match(liveIndex, /execFileSync\('tasklist\.exe'/, 'tasklist must be launched directly');
assert.match(liveIndex, /windowsHide:\s*true/, 'Windows helper processes must remain hidden');
assert.match(liveIndex, /ensureStartupLauncher/, 'every successful start must repair Windows autostart');
assert.match(liveIndex, /acquireInstanceLock/, 'duplicate startup triggers must keep one process only');
assert.match(liveIndex, /stopLegacyLiveProcesses/, 'obsolete Python builds must be stopped at startup');
assert.match(liveIndex, /refreshSelfIdentity/, 'Riot account switches must refresh the observed PUUID');
assert.match(
  liveIndex,
  /live\/clients\/\$\{previousKey\}/,
  'an account switch must retire the previous client signal',
);
assert.match(liveIndex, /lastKnownRoster/, 'the script must retain the last valid in-game roster');
assert.match(
  liveIndex,
  /currentMatchId === lastKnownRosterMatchId/,
  'a missing roster may only be restored inside the same match',
);

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.version, '4.15.10');
assert.equal(packageJson.dependencies.ws, '8.21.1');
assert.match(liveIndex, /timeout:\s*5000/, 'Firebase writes must have a bounded timeout');
assert.match(liveIndex, /split\('\/'\)\.map\(encodeURIComponent\)/, 'Firebase path segments must support Riot IDs containing spaces');
assert.match(liveIndex, /lolPollRunning/, 'League polling must be single-flight');
assert.match(liveIndex, /MAX_LOG_BYTES/, 'the persistent log must be capped');
assert.doesNotMatch(read('lol-watcher.js'), /\[lol-eog-raw\]/, 'raw end-of-game payloads must not flood the log');

console.log('autonomous-package: launchers use only embedded runtime and scoped process management');
