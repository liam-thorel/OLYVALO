const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, restartDecision, validateManifest } = require('../live/updater.js');

assert.equal(compareVersions('4.14.1', '4.14.0'), 1);
assert.equal(compareVersions('v4.14.1', '4.14.1'), 0);
assert.equal(compareVersions('4.14.0', '4.14.1'), -1);
assert.equal(restartDecision(true, '4.14.1'), 'defer');
assert.equal(restartDecision(false, '4.14.1'), 'restart');
assert.equal(restartDecision(false, ''), 'none');
assert.deepEqual(validateManifest({
  version:'4.14.1', files:['index.js','package.json','updater.js','README.md','README.md'],
}, '4.14.1'), ['index.js','package.json','updater.js','README.md']);
assert.throws(() => validateManifest({
  version:'4.14.1', files:['index.js','package.json','updater.js','../secret'],
}, '4.14.1'), /non autorisé/);
assert.throws(() => validateManifest({
  version:'4.11.0', files:['index.js','package.json','updater.js'],
}, '4.14.1'), /invalide/);

const liveDir = path.join(__dirname, '..', 'live');
const liveIndex = fs.readFileSync(path.join(liveDir, 'index.js'), 'utf8');
assert.doesNotMatch(liveIndex, /updateCheckRunning\s*\|\|\s*inGame/, 'an active game must not block the background download');
assert.match(liveIndex, /pendingUpdateVersion/, 'an update downloaded in game must wait for the automatic restart');
const manifest = JSON.parse(fs.readFileSync(path.join(liveDir, 'update-manifest.json'), 'utf8'));
const releaseFiles = validateManifest(manifest, '4.14.1');
assert.equal(JSON.parse(fs.readFileSync(path.join(liveDir, 'package.json'), 'utf8')).version, manifest.version);
releaseFiles.forEach(file => assert.equal(fs.existsSync(path.join(liveDir, file)), true, `${file} is missing`));

console.log('updater: version comparison and manifest validation validated');
