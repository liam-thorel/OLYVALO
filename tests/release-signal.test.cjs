const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

// Le flux Firebase est remplacé par un faux, piloté par le test.
let feed = null;
const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './firebase-stream.js') {
    return { openFirebaseStream: ({ path: nodePath, onEvent }) => { feed = { nodePath, onEvent }; return { stop() {} }; } };
  }
  return original.call(this, request, parent, isMain);
};
const { RELEASE_SIGNAL_PATH, applySignalEvent, releaseToInstall, watchReleaseSignal } = require('../live/release-signal.js');
Module._load = original;

test('seule une version plus récente déclenche une mise à jour', () => {
  assert.equal(releaseToInstall({ version: '4.23.4' }, '4.23.3'), '4.23.4');
  assert.equal(releaseToInstall({ version: '4.24.0' }, '4.23.10'), '4.24.0');
  assert.equal(releaseToInstall({ version: '4.23.3' }, '4.23.3'), null, 'déjà à jour');
  assert.equal(releaseToInstall({ version: '4.22.0' }, '4.23.3'), null, 'repackaging d’une vieille version');
  assert.equal(releaseToInstall({ version: 'v4.24.0' }, '4.23.3'), null, 'format inattendu ignoré');
  assert.equal(releaseToInstall(null, '4.23.3'), null);
});

test('le nœud est reconstitué, entier ou champ par champ', () => {
  let signal = applySignalEvent(null, 'put', { path: '/', data: { version: '4.23.4', tag: 'v4.23.4' } });
  assert.deepEqual(signal, { version: '4.23.4', tag: 'v4.23.4' });
  signal = applySignalEvent(signal, 'put', { path: '/version', data: '4.23.5' });
  assert.equal(signal.version, '4.23.5');
  signal = applySignalEvent(signal, 'patch', { path: '/', data: { version: '4.24.0' } });
  assert.deepEqual(signal, { version: '4.24.0', tag: 'v4.23.4' });
  assert.equal(applySignalEvent(signal, 'put', { path: '/', data: null }), null);
});

test('une publication lance une seule mise à jour, une fois le délai écoulé', async () => {
  const lancees = [];
  watchReleaseSignal({ firebaseHost: 'fb.test', currentVersion: '4.23.3', onRelease: v => lancees.push(v), random: () => 0 });
  assert.equal(feed.nodePath, RELEASE_SIGNAL_PATH);

  feed.onEvent('put', { path: '/', data: { version: '4.23.3' } });
  feed.onEvent('put', { path: '/', data: { version: '4.23.4' } });
  feed.onEvent('put', { path: '/publishedAt', data: 123 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(lancees, ['4.23.4'], 'ni la version installée, ni un doublon pour le même signal');

  feed.onEvent('put', { path: '/version', data: '4.23.5' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(lancees, ['4.23.4', '4.23.5']);
});

test('le workflow de release prévient les postes après publication', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-live.yml'), 'utf8').replace(/\r\n/g, '\n');
  const upload = yaml.indexOf('gh release upload');
  const signal = yaml.indexOf('- name: Prévenir les postes');
  assert.ok(upload > 0 && signal > upload, 'le signal part après la publication, jamais avant');
  assert.match(yaml.slice(signal), /liveControl\/release\.json/);
  assert.match(yaml.slice(signal), /steps\.version\.outputs\.version/);
});
