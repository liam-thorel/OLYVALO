import assert from 'node:assert/strict';
import { historyMode, historyPlayerName, isOpaquePlayerName } from '../js/history-utils.mjs';

assert.equal(historyMode({ mode: 'competitive' }), 'competitive');
assert.equal(historyMode({ mode: 'deathmatch' }), 'deathmatch');
assert.equal(historyMode({ mode: 'swiftplay' }), 'other');

assert.equal(isOpaquePlayerName('b2f303f9'), true);
assert.equal(isOpaquePlayerName('Nico#XOOO'), false);
assert.equal(historyPlayerName({}, { name: 'b2f303f9' }, 2), 'Joueur 3');
assert.equal(historyPlayerName({ player: 'Nico#XOOO' }, { name: 'Nico#XOOO' }), 'Nico');
assert.equal(historyPlayerName(
  { player: 'b2f303f9', playerPuuid: 'self-id' },
  { name: 'b2f303f9', puuid: 'self-id' },
), 'Vous');

console.log('history-utils: modes and player labels validated');
