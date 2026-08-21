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

// ─── rankedOnly côté LoL : ARAM, normales et Co-op vs IA écartées ───────────
const lol = [
  { queueId: 420, win: true },   // Solo/Duo
  { queueId: 440, win: false },  // Flex
  { queueId: 450, win: true },   // ARAM
  { queueId: 400, win: false },  // normale draft
  { queueId: 830, win: true },   // Co-op vs IA
  { queueId: 0, win: false },    // Practice Tool
  { win: true },                 // entrée d'avant 4.17.5, sans queueId
];
const lolKept = rankedOnly('lol', lol);
assert.deepEqual(lolKept.map(e => e.queueId), [420, 440, undefined],
  'seules les files classées — et les vieilles entrées sans queueId — sont gardées');
assert.ok(!lolKept.some(e => e.queueId === 450), 'aucune ARAM dans un récap');

// Une entrée sans queueId ne doit pas être écartée : le script live n'écrit
// d'historique que pour le classé, donc la filtrer viderait rétroactivement
// les stats des joueurs restés sur une ancienne version.
assert.equal(rankedOnly('lol', [{ win: true }]).length, 1);

// Un jeu inconnu passe tel quel plutôt que de tout perdre silencieusement.
const unknown = [{ win: true }];
assert.deepEqual(rankedOnly('tft', unknown), unknown);

console.log('valorant-modes: deathmatch détecté, récaps strictement classés (Valorant + LoL)');
