const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { acceleratorKeys, createKeyPoller, createDebounce } = require('../overlay/lib/key-poll.js');
const { centeredBounds } = require('../overlay/lib/placement.js');
const { HOTKEY_CHOICES } = require('../overlay/lib/hotkey.js');

// ─── Combinaison → codes de touches virtuelles ───────────────────────────────
assert.deepEqual(acceleratorKeys('Control+Shift+F8'), [[0x11], [0x10], [0x77]]);
assert.deepEqual(acceleratorKeys('Alt+Shift+O'), [[0x12], [0x10], [0x4F]]);
assert.deepEqual(acceleratorKeys('CommandOrControl+Shift+o'), [[0x11], [0x10], [0x4F]]);
assert.deepEqual(acceleratorKeys('Control+Alt+7'), [[0x11], [0x12], [0x37]]);
assert.deepEqual(acceleratorKeys('Super+F1'), [[0x5B, 0x5C], [0x70]], 'Win gauche ou droite');
assert.deepEqual(acceleratorKeys('Control+F24'), [[0x11], [0x87]]);
assert.equal(acceleratorKeys('Control+F25'), null);
assert.equal(acceleratorKeys('Control+Shift'), null, 'des modificateurs seuls se déclencheraient en tapant');
assert.equal(acceleratorKeys('Control+Shift+F8+F7'), null);
assert.equal(acceleratorKeys('Control+Plus'), null, 'touche inconnue : on ne sonde pas');
assert.equal(acceleratorKeys(''), null);
assert.equal(acceleratorKeys(null), null);

// Toutes les combinaisons proposées dans le menu doivent marcher dans LoL.
HOTKEY_CHOICES.forEach(choice => {
  assert.ok(acceleratorKeys(choice), `${choice} doit être lisible directement`);
});

// ─── Sonde : un appel par appui ──────────────────────────────────────────────
function fakeKeyboard() {
  const down = new Set();
  return { down, isDown: vk => down.has(vk) };
}

{
  const keyboard = fakeKeyboard();
  let presses = 0;
  let scheduled = null;
  const poller = createKeyPoller({
    isDown: keyboard.isDown,
    keys: acceleratorKeys('Control+Shift+F8'),
    onPress: () => { presses += 1; },
    setInterval_: (fn, ms) => { scheduled = { fn, ms }; return 1; },
    clearInterval_: () => { scheduled = null; },
  });

  assert.equal(poller.start(), true);
  assert.equal(poller.start(), false, 'pas de seconde minuterie');
  assert.ok(scheduled.ms <= 60, 'assez rapide pour qu’un appui bref ne passe pas entre deux lectures');
  assert.equal(poller.running(), true);

  poller.tick();
  keyboard.down.add(0x11); keyboard.down.add(0x10);
  poller.tick();
  assert.equal(presses, 0, 'Ctrl+Maj sans F8 : rien');

  keyboard.down.add(0x77);
  poller.tick();
  assert.equal(presses, 1);
  poller.tick(); poller.tick();
  assert.equal(presses, 1, 'garder les touches enfoncées ne répète pas');

  keyboard.down.delete(0x77);
  poller.tick();
  keyboard.down.add(0x77);
  poller.tick();
  assert.equal(presses, 2, 'relâcher F8 puis rappuyer compte');

  poller.stop();
  assert.equal(poller.running(), false);
  assert.equal(scheduled, null);
}

{
  // Une combinaison déjà tenue au démarrage de la sonde (on vient d'appuyer
  // pour ouvrir la fenêtre au moment où LoL se lance) ne doit pas la refermer.
  const keyboard = fakeKeyboard();
  [0x11, 0x10, 0x77].forEach(vk => keyboard.down.add(vk));
  let presses = 0;
  const poller = createKeyPoller({
    isDown: keyboard.isDown, keys: acceleratorKeys('Control+Shift+F8'),
    onPress: () => { presses += 1; },
    setInterval_: () => 1, clearInterval_: () => {},
  });
  poller.start();
  poller.tick();
  assert.equal(presses, 0);
}

{
  // Une lecture qui plante arrête la sonde au lieu de remplir le journal.
  let errors = 0;
  const poller = createKeyPoller({
    isDown: () => { throw new Error('user32 absent'); },
    keys: acceleratorKeys('Control+Shift+F8'),
    onPress: () => assert.fail('pas d’appui sur erreur'),
    onError: () => { errors += 1; },
    setInterval_: () => 1, clearInterval_: () => {},
  });
  poller.start();
  poller.tick();
  assert.equal(errors, 1);
  assert.equal(poller.running(), false);
}

// ─── Anti-doublon entre RegisterHotKey et la sonde ───────────────────────────
{
  let now = 1000;
  const accept = createDebounce(400, () => now);
  assert.equal(accept(), true);
  now += 40;
  assert.equal(accept(), false, 'le même appui reçu par les deux chemins');
  now += 400;
  assert.equal(accept(), true, 'un vrai second appui passe');
}

// ─── Ramener la fenêtre ──────────────────────────────────────────────────────
assert.deepEqual(
  centeredBounds({ x: 2090, y: 280, width: 460, height: 680 }, { x: 0, y: 0, width: 1920, height: 1040 }),
  { x: 730, y: 180, width: 460, height: 680 });
assert.deepEqual(
  centeredBounds({ x: 0, y: 0, width: 1100, height: 900 }, { x: -1366, y: 0, width: 1366, height: 728 }),
  { x: -1233, y: 0, width: 1100, height: 728 }, 'rétrécie pour tenir dans un petit écran');

// ─── Câblage dans main.js ────────────────────────────────────────────────────
const main = readFileSync(path.join(__dirname, '..', 'overlay', 'main.js'), 'utf8');
const body = name => {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} existe`);
  return main.slice(start, main.indexOf('\n}\n', start));
};

assert.match(body('registerHotkey'), /globalShortcut\.register\(settings\.hotkey, \(\) => onHotkey\(/,
  'RegisterHotKey passe par le même gestionnaire que la sonde');
assert.match(body('onHotkey'), /if \(!acceptHotkeyPress\(\)\) return;/, 'anti-doublon avant tout effet');
assert.ok(body('onHotkey').indexOf('acceptHotkeyPress') < body('onHotkey').indexOf("reduce(state, 'hotkey')"));
assert.match(body('syncKeyPoller'), /if \(!running\.lol\)/, 'la sonde ne tourne que pendant LoL');
assert.match(body('pollGames'), /syncKeyPoller\(running\)/);
assert.match(body('setHotkey'), /keyPoller\?\.stop\(\);[\s\S]*syncKeyPoller\(lastRunning\)/,
  'changer de combinaison relance la sonde sur les nouvelles touches');
assert.match(body('asyncKeyReader'), /GetAsyncKeyState/);
assert.match(body('asyncKeyReader'), /try \{[\s\S]*require\('koffi'\)/, 'sans module natif, l’overlay tourne quand même');
assert.doesNotMatch(main, /SetWindowsHookEx/, 'jamais de hook clavier');
assert.match(main, /label: 'Ramener la fenêtre sur cet écran', click: bringWindowHere/);

// ─── Empaquetage ─────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'overlay', 'package.json'), 'utf8'));
assert.match(pkg.dependencies.koffi, /^\d+\.\d+\.\d+$/, 'version exacte');
assert.ok(pkg.build.asarUnpack.some(glob => glob.startsWith('node_modules/koffi')),
  'un module natif ne se charge pas depuis l’archive asar');
assert.ok(pkg.build.asarUnpack.some(glob => glob.startsWith('node_modules/@koromix')),
  'koffi 3 range son binaire Windows dans @koromix/koffi-win32-x64');
const lock = JSON.parse(readFileSync(path.join(__dirname, '..', 'overlay', 'package-lock.json'), 'utf8'));
assert.ok(lock.packages['node_modules/@koromix/koffi-win32-x64'], 'le binaire Windows est dans le lockfile');

// ─── Site rechargé quand le réseau n'était pas prêt ──────────────────────────
assert.match(main, /siteView\.webContents\.on\('did-fail-load'[\s\S]*?if \(!isMainFrame \|\| code === -3\) return;/,
  'seule la page principale compte, et une navigation remplacée n’est pas une panne');
assert.match(main, /Math\.min\(60_000, 5_000 \* failedLoads\)/, 'nouvel essai espacé');
assert.match(main, /loadURL\(siteUrl\(\)\)\.catch\(\(\) => \{\}\)/, 'pas d’exception non interceptée au démarrage hors ligne');
assert.match(main, /label: 'Recharger la page', click: \(\) => siteView\?\.webContents\.reloadIgnoringCache\(\)/);
