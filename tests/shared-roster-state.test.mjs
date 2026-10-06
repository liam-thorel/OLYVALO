import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('all site consumers use one module URL for shared application state', () => {
  const directory = new URL('../js/', import.meta.url);
  const imports = [];
  for (const name of fs.readdirSync(directory).filter(name => /\.(mjs|js)$/.test(name))) {
    const source = fs.readFileSync(new URL(name, directory), 'utf8');
    for (const match of source.matchAll(/from\s*['"](\.\/state\.mjs(?:\?[^'"]*)?)['"]/g)) {
      imports.push({ name, url:match[1] });
    }
  }
  for (const name of ['main.js','render.js','interactions.js','lol-roster.mjs']) {
    assert.ok(imports.some(entry => entry.name === name), `${name} must read the shared state`);
  }
  assert.equal(new Set(imports.map(entry => entry.url)).size, 1,
    `Different module URLs create independent empty rosters:\n${JSON.stringify(imports)}`);
});

test('roster fix invalidates cached renderer and League modules through the entrypoint', () => {
  const main = fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
  const interactions = fs.readFileSync(new URL('../js/interactions.js',import.meta.url),'utf8');
  assert.match(main,/render\.js\?v=20261006-proprietaire/);
  assert.match(main,/interactions\.js\?v=20261006-puuid-lol/);
  assert.match(main,/lol-roster\.mjs\?v=20261006-puuid-lol/);
  assert.match(interactions,/lol-roster\.mjs\?v=20261006-puuid-lol/);
});
