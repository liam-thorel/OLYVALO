import assert from 'node:assert/strict';
import { serverVisual } from '../js/server-visuals.mjs';

for (const city of ['Paris', 'Francfort', 'Londres', 'Madrid', 'Stockholm', 'Varsovie', 'Istanbul', 'Dubaï']) {
  const visual = serverVisual(city);
  assert.match(visual.image, /^https:\/\/commons\.wikimedia\.org\//);
  assert.match(visual.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(visual.credit);
}

assert.equal(serverVisual('Europe'), null);

console.log('server-visuals: city artwork and credits validated');
