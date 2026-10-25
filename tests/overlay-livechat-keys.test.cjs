const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const keys = require('../overlay/lib/livechat-keys.js');
const live = require('../live/livechat-utils.js');

// ─── Même format et mêmes noms que le Live ───────────────────────────────────
for (let vk = 1; vk < 255; vk += 1) {
  assert.equal(keys.vkName(vk), live.vkName(vk), `nom de la touche ${vk}`);
}
assert.deepEqual(keys.DEFAULT_SKIP_KEY, live.DEFAULT_SKIP_KEY);
assert.deepEqual(keys.DEFAULT_TOGGLE_KEY, live.DEFAULT_TOGGLE_KEY);
for (const raw of [null, undefined, { vk: 1 }, { vk: 17 }, { vk: 0x78, ctrl: true }, { vk: 300 }, { vk: 0x05, alt: true }]) {
  assert.deepEqual(keys.normalizeHotkey(raw, 'défaut'), live.normalizeHotkey(raw, 'défaut'), JSON.stringify(raw));
}

// ─── Touches capturées dans la fenêtre ───────────────────────────────────────
assert.deepEqual(keys.keyFromKeyboardEvent({ keyCode: 0x79, ctrlKey: true, shiftKey: true }),
  { key: { vk: 0x79, ctrl: true, shift: true, alt: false, win: false } });
assert.equal(keys.keyFromKeyboardEvent({ keyCode: 17, ctrlKey: true }), null, 'Ctrl seul : on attend la touche principale');
assert.deepEqual(keys.keyFromKeyboardEvent({ keyCode: 27 }), { cancel: true }, 'Échap annule');
assert.deepEqual(keys.keyFromKeyboardEvent({ keyCode: 27, ctrlKey: true }).key.vk, 27, 'Ctrl+Échap reste une touche');
assert.deepEqual(keys.keyFromMouseEvent({ button: 3 }).key.vk, 0x05, 'bouton précédent = Souris 4');
assert.deepEqual(keys.keyFromMouseEvent({ button: 4, shiftKey: true }).key, { vk: 0x06, ctrl: false, shift: true, alt: false, win: false });
assert.equal(keys.keyFromMouseEvent({ button: 0 }), null, 'jamais le clic gauche');
assert.equal(keys.keyFromMouseEvent({ button: 2 }), null, 'ni le clic droit');

// ─── Lecture et écriture des réglages du Live ────────────────────────────────
function fakeFs(files) {
  return {
    files,
    readFileSync: file => { if (!(file in files)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return files[file]; },
    writeFileSync: (file, content) => { files[file] = content; },
  };
}
const env = { LOCALAPPDATA: 'C:\\Users\\liam\\AppData\\Local' };
const pointer = keys.pointerPath(env);
assert.equal(pointer, path.join(env.LOCALAPPDATA, 'OLYCITY', 'livechat', 'settings-location.json'));
const config = 'D:\\OLYCITY Live\\olycity-livechat.json';

assert.deepEqual(keys.readLivechatKeys({ env, fsImpl: fakeFs({}) }), { found: false }, 'Live absent ou trop ancien');
const fsImpl = fakeFs({ [pointer]: JSON.stringify({ configPath: config }), [config]: JSON.stringify({ enabled: false, volume: 40 }) });
const state = keys.readLivechatKeys({ env, fsImpl });
assert.equal(state.found, true);
assert.equal(state.enabled, false);
assert.deepEqual(state.labels, { toggle: 'Ctrl+Maj+F10', skip: 'Ctrl+Maj+F9' });

assert.deepEqual(keys.writeLivechatKey('toggle', { vk: 0x05 }, { env, fsImpl }), { ok: true });
const written = JSON.parse(fsImpl.files[config]);
assert.equal(written.volume, 40, 'les autres réglages sont gardés');
assert.equal(written.toggleKey.vk, 0x05);
assert.equal(live.hotkeyLabel(live.parseLiveChatConfig(fsImpl.files[config]).toggleKey), 'Souris 4', 'le Live relit ce que l’overlay écrit');
assert.match(keys.writeLivechatKey('skip', { vk: 0x05 }, { env, fsImpl }).error, /autre action/);
assert.deepEqual(keys.writeLivechatKey('skip', null, { env, fsImpl }), { ok: true });
assert.equal(live.parseLiveChatConfig(fsImpl.files[config]).skipKey, null, 'touche retirée');
assert.match(keys.writeLivechatKey('skip', { vk: 1 }, { env, fsImpl }).error, /non utilisable/);
assert.match(keys.writeLivechatKey('autre', null, { env, fsImpl }).error, /inconnue/);
const evil = fakeFs({ [pointer]: JSON.stringify({ configPath: 'C:\\Windows\\system32\\drivers\\etc\\hosts' }) });
assert.equal(keys.findSettingsFile({ env, fsImpl: evil }), null, 'seul le fichier de réglages du livechat est modifiable');

// ─── Câblage ─────────────────────────────────────────────────────────────────
const main = readFileSync(path.join(__dirname, '..', 'overlay', 'main.js'), 'utf8');
assert.match(main, /\{ label: 'Touches du livechat…', click: openLivechatKeys \}/);
assert.match(main, /preload: path\.join\(__dirname, 'preload-livechat\.js'\), contextIsolation: true, nodeIntegration: false, sandbox: true/);
assert.match(main, /registerLivechatKeysIpc\(\);/);
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'overlay', 'package.json'), 'utf8'));
assert.ok(pkg.build.files.includes('preload-livechat.js'), 'le preload part dans l’installeur');
const liveSource = readFileSync(path.join(__dirname, '..', 'live', 'livechat.js'), 'utf8');
assert.match(liveSource, /publishSettingsLocation\(configPath, scriptVersion\);/, 'le Live publie où sont ses réglages');
assert.match(liveSource, /const SETTINGS_POINTER = 'settings-location\.json';/);

console.log('overlay-livechat-keys: touches du livechat réglables depuis l’overlay, au format du Live');
