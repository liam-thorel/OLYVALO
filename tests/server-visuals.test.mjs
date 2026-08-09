import assert from 'node:assert/strict';
import { serverVisual } from '../js/server-visuals.mjs';

assert.equal(serverVisual('Paris').image, './assets/servers/paris.jpg');
assert.equal(serverVisual('Paris · EU').image, './assets/servers/paris.jpg');
assert.ok(serverVisual('gamepod-frankfurt-1'));

for (const city of ['Francfort', 'Londres', 'Madrid', 'Stockholm', 'Varsovie', 'Istanbul', 'Dubaï']) {
  const visual = serverVisual(city);
  assert.match(visual.image, /^\.\/assets\/servers\//);
  assert.match(visual.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(visual.credit);
}

assert.equal(serverVisual('Europe'), null);

console.log('server-visuals: city artwork and credits validated');
