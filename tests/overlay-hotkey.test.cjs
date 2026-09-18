const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { HOTKEY_CHOICES, hotkeyLabel, hotkeyOptions, hotkeyStatusLabel } = require('../overlay/lib/hotkey.js');
const { isValidHotkey, DEFAULTS } = require('../overlay/lib/settings.js');

// ─── Les combinaisons proposées doivent être enregistrables ──────────────────
// Une entrée invalide serait refusée par Electron et laisserait l'utilisateur
// sans raccourci du tout — exactement la panne qu'on cherche à réparer.
HOTKEY_CHOICES.forEach(choice => {
  assert.ok(isValidHotkey(choice), `${choice} doit passer la validation des réglages`);
});
assert.ok(HOTKEY_CHOICES.includes(DEFAULTS.hotkey), 'le défaut figure parmi les choix');
assert.equal(new Set(HOTKEY_CHOICES).size, HOTKEY_CHOICES.length, 'pas de doublon dans le menu');
assert.ok(HOTKEY_CHOICES.length >= 3, 'une seule solution de repli ne suffit pas');

// LoL utilise F11 et F12 : les proposer reviendrait à voler une touche du jeu.
HOTKEY_CHOICES.forEach(choice => {
  assert.doesNotMatch(choice, /\bF1[12]\b/, `${choice} empiète sur les touches du jeu`);
});

// ─── Libellés ────────────────────────────────────────────────────────────────
assert.equal(hotkeyLabel('Control+Shift+F8'), 'Ctrl+Maj+F8');
assert.equal(hotkeyLabel('Alt+Shift+O'), 'Alt+Maj+O');
assert.equal(hotkeyLabel('CommandOrControl+Shift+O'), 'Ctrl+Maj+O');
assert.equal(hotkeyLabel(''), '');
assert.equal(hotkeyLabel(null), '');

// ─── Le réglage actif est toujours dans la liste ─────────────────────────────
// settings.json est éditable à la main : une combinaison inconnue du menu ne
// doit pas disparaître de l'affichage, sinon le menu ment sur l'état réel.
assert.deepEqual(hotkeyOptions('Control+Shift+F8'), HOTKEY_CHOICES, 'un choix connu n’est pas dupliqué');
assert.equal(hotkeyOptions('control+shift+f8').length, HOTKEY_CHOICES.length, 'comparaison insensible à la casse');
const perso = hotkeyOptions('Control+Alt+K');
assert.equal(perso[0], 'Control+Alt+K', 'le réglage maison passe en tête');
assert.equal(perso.length, HOTKEY_CHOICES.length + 1);
assert.deepEqual(hotkeyOptions(''), HOTKEY_CHOICES);
assert.deepEqual(hotkeyOptions(null), HOTKEY_CHOICES);

// ─── État affiché ────────────────────────────────────────────────────────────
// Une combinaison prise par une autre application doit se voir : c'est la
// panne la plus probable, et elle était jusqu'ici parfaitement silencieuse.
assert.equal(hotkeyStatusLabel('Control+Shift+F8', true), 'Raccourci : Ctrl+Maj+F8');
assert.match(hotkeyStatusLabel('Control+Shift+F8', false), /pris par une autre application/);

// ─── Câblage dans main.js ────────────────────────────────────────────────────
const main = readFileSync(path.join(__dirname, '..', 'overlay', 'main.js'), 'utf8');

// Le raccourci doit être modifiable depuis le menu : c'était une étiquette
// morte, et sans elle la seule issue était d'éditer settings.json à la main.
assert.match(main, /submenu: hotkeyOptions\(settings\.hotkey\)/, 'le menu propose les combinaisons');
assert.match(main, /click: \(\) => setHotkey\(choice\)/);
assert.doesNotMatch(main, /`Raccourci : \$\{settings\.hotkey\}`, enabled: false/, 'plus d’étiquette morte');

// RegisterHotKey est premier arrivé premier servi : une autre application peut
// prendre la combinaison APRÈS notre démarrage, sans rien nous dire.
assert.match(main, /globalShortcut\.isRegistered\(settings\.hotkey\)/);
assert.match(main, /ensureHotkeyAlive\(`lancement de \$\{games\}`\)/, 'revérifié au lancement d’une partie');

// Sans trace à la réception, « la touche ne passe pas » et « la fenêtre ne se
// voit pas » sont deux pannes indiscernables dans le journal.
assert.match(main, /log\('\[raccourci\]', hotkeyLabel\(settings\.hotkey\), 'reçu'\)/);

console.log('overlay-hotkey: raccourci modifiable, revérifié au lancement du jeu, et tracé à la réception');
