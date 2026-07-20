const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, validateManifest } = require('../live/updater.js');

assert.equal(compareVersions('4.10.0', '4.9.3'), 1);
assert.equal(compareVersions('v4.10.0', '4.10.0'), 0);
assert.equal(compareVersions('4.9.3', '4.10.0'), -1);
assert.deepEqual(validateManifest({
  version:'4.10.0', files:['index.js','package.json','updater.js','README.md','README.md'],
}, '4.10.0'), ['index.js','package.json','updater.js','README.md']);
assert.throws(() => validateManifest({
  version:'4.10.0', files:['index.js','package.json','updater.js','../secret'],
}, '4.10.0'), /non autorisé/);
assert.throws(() => validateManifest({
  version:'4.9.3', files:['index.js','package.json','updater.js'],
}, '4.10.0'), /invalide/);

const liveDir = path.join(__dirname, '..', 'live');
const manifest = JSON.parse(fs.readFileSync(path.join(liveDir, 'update-manifest.json'), 'utf8'));
const releaseFiles = validateManifest(manifest, '4.10.0');
assert.equal(JSON.parse(fs.readFileSync(path.join(liveDir, 'package.json'), 'utf8')).version, manifest.version);
releaseFiles.forEach(file => assert.equal(fs.existsSync(path.join(liveDir, file)), true, `${file} is missing`));

console.log('updater: version comparison and manifest validation validated');
