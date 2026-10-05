import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL(path,import.meta.url),'utf8');
test('game and site pickers preserve native disclosure and keyboard dismissal', () => {
  const html = read('../index.html');
  const mode = read('../js/game-mode.mjs');
  const sites = read('../js/site-switcher.mjs');
  assert.match(html, /<details class="game-switch">/);
  assert.equal((html.match(/data-game-choice=/g)||[]).length,2);
  assert.match(html, /data-game-short aria-hidden="true"/);
  for (const source of [mode,sites]) {
    assert.match(source, /event.key === 'Escape'/);
    assert.match(source, /focusout/);
    assert.match(source, /\.contains\(event.target\)/);
  }
  assert.match(mode, /querySelectorAll\('\.oly-site-switcher\[open\]'\)/);
  assert.match(sites, /querySelectorAll\('\.game-switch\[open\]'\)/);
});
