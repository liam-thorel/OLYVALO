const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, restartDecision, validateManifest } = require('../live/updater.js');

assert.equal(compareVersions('4.14.4', '4.14.3'), 1);
assert.equal(compareVersions('v4.14.4', '4.14.4'), 0);
assert.equal(compareVersions('4.14.3', '4.14.4'), -1);
assert.equal(restartDecision(true, '4.14.4'), 'defer');
assert.equal(restartDecision(false, '4.14.4'), 'restart');
assert.equal(restartDecision(false, ''), 'none');
assert.deepEqual(validateManifest({
  version:'4.14.4', files:['index.js','package.json','updater.js','README.md','README.md'],
}, '4.14.4'), ['index.js','package.json','updater.js','README.md']);
assert.throws(() => validateManifest({
  version:'4.14.4', files:['index.js','package.json','updater.js','../secret'],
}, '4.14.4'), /non autorisé/);
assert.throws(() => validateManifest({
  version:'4.11.0', files:['index.js','package.json','updater.js'],
}, '4.14.4'), /invalide/);

const liveDir = path.join(__dirname, '..', 'live');
const liveIndex = fs.readFileSync(path.join(liveDir, 'index.js'), 'utf8');
assert.doesNotMatch(liveIndex, /updateCheckRunning\s*\|\|\s*inGame/, 'an active game must not block the background download');
assert.match(liveIndex, /pendingUpdateVersion/, 'an update downloaded in game must wait for the automatic restart');
const manifest = JSON.parse(fs.readFileSync(path.join(liveDir, 'update-manifest.json'), 'utf8'));
const packageVersion = JSON.parse(fs.readFileSync(path.join(liveDir, 'package.json'), 'utf8')).version;

// La version vit à trois endroits qu'il faut bumper ensemble ; on vérifie leur
// cohérence plutôt qu'un numéro figé, pour ne pas rougir à chaque release.
assert.equal(manifest.version, packageVersion, 'update-manifest.json et package.json doivent être alignés');
assert.match(
  fs.readFileSync(path.join(liveDir, 'index.js'), 'utf8'),
  new RegExp(`SCRIPT_VERSION = '${packageVersion.replace(/\./g, '\\.')}'`),
  'SCRIPT_VERSION dans index.js doit suivre package.json',
);

const releaseFiles = validateManifest(manifest, packageVersion);
releaseFiles.forEach(file => assert.equal(fs.existsSync(path.join(liveDir, file)), true, `${file} is missing`));

// L'identité choisie par le joueur ne doit JAMAIS être livrée par l'updater :
// elle serait écrasée à chaque mise à jour et il faudrait tout re-répondre.
const { IDENTITY_FILENAME } = require('../live/identity.js');
assert.equal(releaseFiles.includes(IDENTITY_FILENAME), false, `${IDENTITY_FILENAME} doit survivre aux mises à jour`);
['identity.js', 'ask-identity.js', 'account-binding.js', 'maintenance.js', 'presence-schema.js', 'riot-identity.js', 'history-index.js'].forEach(file =>
  assert.equal(releaseFiles.includes(file), true, `${file} doit être livré aux joueurs`));

console.log('updater: version comparison and manifest validation validated');
