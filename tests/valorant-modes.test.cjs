const assert = require('node:assert/strict');
const Module = require('node:module');

// stats.js -> firebase.js -> eventsource : non installé dans l'env de test.
const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './firebase.js') return { fbGet: async () => null };
  if (request === './config.js') return { FIREBASE_URL: 'x' };
  return original(request, parent, isMain);
};
const { isRankedValorantMode, isValorantDeathmatch, rankedOnly } = require('../discord-bot/stats.js');
Module._load = original;

// ─── Deathmatch : aucune notif ───────────────────────────────────────────────
['deathmatch', 'Deathmatch', 'DEATHMATCH', ' deathmatch '].forEach(mode =>
  assert.equal(isValorantDeathmatch(mode), true, `${JSON.stringify(mode)} doit être un deathmatch`));
['competitive', 'unrated', 'swiftplay', 'spikerush', 'hurm', '', null, undefined].forEach(mode =>
  assert.equal(isValorantDeathmatch(mode), false, `${JSON.stringify(mode)} n'est pas un deathmatch`));

// ─── Ranked : seul 'competitive' compte, quelle que soit la casse ────────────
['competitive', 'Competitive', 'COMPETITIVE', ' competitive '].forEach(mode =>
  assert.equal(isRankedValorantMode(mode), true));
['unrated', 'deathmatch', 'swiftplay', 'spikerush', 'hurm', 'ggteam', '', null].forEach(mode =>
  assert.equal(isRankedValorantMode(mode), false, `${JSON.stringify(mode)} ne doit pas compter comme classé`));

// ─── rankedOnly : les récaps ne gardent QUE le compétitif ────────────────────
const history = [
  { mode: 'competitive', kills: 20, win: true },
  { mode: 'Competitive', kills: 18, win: false }, // casse différente : doit rester
  { mode: 'deathmatch', kills: 41, win: null },
  { mode: 'unrated', kills: 15, win: true },
  { mode: 'swiftplay', kills: 12, win: false },
  { mode: '', kills: 9, win: true },
];
const kept = rankedOnly('valorant', history);
assert.equal(kept.length, 2, 'seules les deux games compétitives sont gardées');
assert.ok(kept.every(entry => entry.mode.toLowerCase() === 'competitive'));
assert.ok(!kept.some(entry => entry.mode === 'deathmatch'), 'aucun deathmatch dans un récap');
assert.ok(!kept.some(entry => entry.mode === 'unrated'), 'aucun non-classé dans un récap');

// LoL n'est pas filtré ici (il l'est par queueId en amont).
const lol = [{ mode: 'CLASSIC', win: true }];
assert.deepEqual(rankedOnly('lol', lol), lol);

console.log('valorant-modes: deathmatch détecté, récaps strictement compétitifs');
