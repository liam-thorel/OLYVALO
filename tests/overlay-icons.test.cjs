const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');

// Icônes de l'overlay : la grande roue d'OLYCITY (voir overlay/README.md).
const overlay = path.join(__dirname, '..', 'overlay');
const pkg = JSON.parse(readFileSync(path.join(overlay, 'package.json'), 'utf8'));
assert.equal(pkg.build.win.icon, 'build/icon.ico', 'exécutable, raccourcis et installateur');

const ico = readFileSync(path.join(overlay, 'build', 'icon.ico'));
assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'un vrai fichier .ico');
const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size), `taille ${size} px`);

const pngSize = file => {
  const png = readFileSync(path.join(overlay, 'ui', file));
  assert.equal(png.toString('latin1', 1, 4), 'PNG', file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};
// Electron choisit seul la variante adaptée à l'échelle de l'écran.
assert.deepEqual(pngSize('tray.png'), [16, 16]);
assert.deepEqual(pngSize('tray@1.5x.png'), [24, 24]);
assert.deepEqual(pngSize('tray@2x.png'), [32, 32]);
assert.match(readFileSync(path.join(overlay, 'main.js'), 'utf8'), /new Tray\(path\.join\(__dirname, 'ui', 'tray\.png'\)\)/);

console.log('overlay-icons: grande roue OLYCITY pour l’application et la zone de notification');
