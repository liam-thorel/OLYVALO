const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nodeScript = fs.readFileSync(path.join(root, 'live', 'index.js'), 'utf8');
const legacyScript = fs.readFileSync(path.join(root, 'live', 'olycity_live.py'), 'utf8');
const livePage = fs.readFileSync(path.join(root, 'js', 'interactions.js'), 'utf8');

const competitiveMaps = {
  Ascent: 'Ascent',
  Bonsai: 'Split',
  Triad: 'Haven',
  Jam: 'Lotus',
  Juliett: 'Sunset',
  Infinity: 'Abyss',
  Plummet: 'Summit',
};

for (const [internalName, displayName] of Object.entries(competitiveMaps)) {
  const compactNode = `'${internalName}':'${displayName}'`;
  const compactPython = `"${internalName}":"${displayName}"`;
  assert.ok(nodeScript.includes(compactNode), `le script Node doit détecter ${displayName} (${internalName})`);
  assert.ok(livePage.includes(compactNode), `la page Live doit afficher ${displayName} (${internalName})`);
  assert.ok(legacyScript.includes(compactPython), `l'ancien script Python doit rester cohérent pour ${displayName}`);
}

console.log('map-detection: les 7 cartes compétitives du patch 13.04 sont reconnues partout');
