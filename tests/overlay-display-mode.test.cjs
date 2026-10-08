const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lolWindowMode, displayHint, lolConfigPaths } = require('../overlay/lib/display-mode.js');

// L'overlay ne peut pas s'afficher par-dessus un jeu en plein écran exclusif :
// le raccourci semblait « ne rien faire » en LoL, sans explication.
test('mode d’affichage LoL lu dans game.cfg', () => {
  const cfg = mode => `[General]\nCfgVersion=14.20\nWindowMode=${mode}\nHeight=1080\n`;
  assert.equal(lolWindowMode(cfg(0)), 'fullscreen');
  assert.equal(lolWindowMode(cfg(1)), 'windowed');
  assert.equal(lolWindowMode(cfg(2)), 'borderless');
  assert.equal(lolWindowMode('[General]\nHeight=1080'), null, 'réglage absent : on ne devine pas');
  assert.equal(lolWindowMode(''), null);
  assert.ok(lolConfigPaths({}).some(entry => entry.endsWith(path.join('League of Legends', 'Config', 'game.cfg'))));
});

test('le rappel suit le jeu, et prévient si LoL est en plein écran', () => {
  assert.equal(displayHint({ lol: true }, 'fullscreen').warn, true);
  assert.match(displayHint({ lol: true }, 'fullscreen').text, /Sans bordure/);
  assert.equal(displayHint({ lol: true }, 'borderless').warn, false);
  assert.match(displayHint({ lol: true }, null).text, /LoL doit être en « Sans bordure »/);
  assert.match(displayHint({ valorant: true }).text, /Valorant/);
  assert.match(displayHint({}).text, /Valorant/, 'aucun jeu : le rappel d’origine');
});

test('câblage : lu au lancement et à la fermeture, affiché dans la barre', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'main.js'), 'utf8');
  assert.match(main, /ensureHotkeyAlive\(`lancement de \$\{games\}`\);\n\s*refreshDisplayHint\(running\);/);
  assert.match(main, /log\('\[jeu\] fermé'\);\n\s*refreshDisplayHint\(running\);/);
  const shell = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'ui', 'shell.html'), 'utf8');
  assert.match(shell, /window\.setHint = \(text, warn\) =>/);
  assert.match(shell, /\.hint:not\(\.warn\)/, 'l’avertissement reste visible même dans une fenêtre étroite');
});
