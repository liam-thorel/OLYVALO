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

for (const contents of [installer, launcher, silent, uninstaller, reinstaller, verifier]) {
  assert.doesNotMatch(contents, /\bnpm(?:\.cmd)?\b/i);
  assert.doesNotMatch(contents, /taskkill\s+.*\/im\s+(?:node|wscript)/i);
}

assert.match(installer, /runtime\\node\.exe/i);
assert.match(installer, /node_modules\\ws\\index\.js/i);
assert.match(installer, /\/rl LIMITED/i);
assert.match(silent, /runtime\\node\.exe/i);
assert.match(launcher, /runtime\\node\.exe/i);
assert.match(verifier, /manage\.ps1" status/i);
assert.match(uninstaller, /manage\.ps1" stop/i);
assert.match(reinstaller, /INSTALLER\.bat/i);

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.version, '4.14.0');
assert.equal(packageJson.dependencies.ws, '8.21.1');

console.log('autonomous-package: launchers use only embedded runtime and scoped process management');
