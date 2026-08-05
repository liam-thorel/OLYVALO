const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const watcher = fs.readFileSync(path.join(__dirname, '..', 'live', 'lol-watcher.js'), 'utf8');

test('LoL watcher registers the connected identity outside matches', () => {
  assert.match(watcher, /live\/lolClients\/\$\{key\}/);
  assert.match(watcher, /puuid/);
  assert.match(watcher, /games:\s*\['lol'\]/);
  assert.match(watcher, /await publishIdentity\(summonerRes\.data, phase\)/);
  assert.match(watcher, /markClientOffline/);
});
