const assert = require('node:assert/strict');
const {
  createAccountBinder, bindingKey, bindingPayload, mergeGames, splitRiotId,
} = require('../live/account-binding.js');

// ─── Découpage du Riot ID ───────────────────────────────────────────────────
assert.deepEqual(splitRiotId('Wong Chi Ming#2046'), { name: 'Wong Chi Ming', tag: '2046' });
assert.deepEqual(splitRiotId('a#b#c'), { name: 'a#b', tag: 'c' }, 'seul le dernier # sépare le tag');
assert.deepEqual(splitRiotId('SansTag'), { name: 'SansTag', tag: '' });

// ─── Clé stable ─────────────────────────────────────────────────────────────
assert.equal(bindingKey({ puuid: 'abc-123', playerName: 'X#1' }), 'abc-123', 'le PUUID prime');
assert.equal(bindingKey({ playerName: 'X#1' }), 'X_1', 'repli sur un Riot ID assaini');
assert.equal(bindingKey({}), '', 'rien d’exploitable');

// ─── Fusion des jeux ────────────────────────────────────────────────────────
assert.deepEqual(mergeGames(['lol'], 'valorant'), ['lol', 'valorant'], 'un compte peut servir aux deux');
assert.deepEqual(mergeGames(['valorant'], 'valorant'), ['valorant']);
assert.deepEqual(mergeGames(null, 'lol'), ['lol']);
assert.deepEqual(mergeGames(['bidon'], 'aussi-bidon'), ['valorant'], 'valeurs inconnues ignorées');

// ─── Le réglage de monitoring de #admin n'est pas écrasé ────────────────────
const preserved = bindingPayload({
  playerName: 'A#B', puuid: 'p1', memberName: 'Nico', games: 'lol',
  existing: { games: ['valorant'], monitoring: true },
});
assert.equal(preserved.monitoring, true, 'le suivi central choisi dans #admin est conservé');
assert.deepEqual(preserved.games, ['valorant', 'lol']);

// ─── Le scénario qui cassait tout : le renommage ────────────────────────────
async function scenarioRenommage() {
  const writes = [];
  const binder = createAccountBinder({
    putFB: async (path, data) => { writes.push({ path, data }); return true; },
    getFB: async () => null,
  });

  const member = { memberId: 'nico', memberName: 'Nico' };
  const first = await binder.bind({ ...member, playerName: 'AncienPseudo#EUW', puuid: 'puuid-nico', game: 'valorant' });
  assert.equal(first.written, true);
  assert.equal(writes[0].path, 'rosterOverlay/accounts/nico/puuid-nico');
  assert.equal(writes[0].data.name, 'AncienPseudo');

  // Même compte, rien n'a bougé : aucune réécriture (un PUT par poll serait absurde).
  const repeat = await binder.bind({ ...member, playerName: 'AncienPseudo#EUW', puuid: 'puuid-nico', game: 'valorant' });
  assert.equal(repeat.written, false);
  assert.equal(repeat.reason, 'unchanged');
  assert.equal(writes.length, 1);

  // Nico se renomme → même clé PUUID, name/tag rafraîchis : le bot le retrouve.
  const renamed = await binder.bind({ ...member, playerName: 'NouveauPseudo#OLY', puuid: 'puuid-nico', game: 'valorant' });
  assert.equal(renamed.written, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].path, 'rosterOverlay/accounts/nico/puuid-nico', 'la clé ne bouge pas malgré le renommage');
  assert.equal(writes[1].data.name, 'NouveauPseudo');
  assert.equal(writes[1].data.tag, 'OLY');

  // Le même compte lance LoL : les jeux se cumulent au lieu de s'écraser.
  const lol = await binder.bind({ ...member, playerName: 'NouveauPseudo#OLY', puuid: 'puuid-nico', game: 'lol' });
  assert.equal(lol.written, true);
  assert.deepEqual(writes[2].data.games, ['valorant', 'lol']);
}

// ─── Robustesse ─────────────────────────────────────────────────────────────
async function scenarioRobustesse() {
  const binder = createAccountBinder({ putFB: async () => true });
  assert.equal((await binder.bind({ memberId: '', playerName: 'A#B' })).written, false, 'sans membre, on ne touche à rien');
  assert.equal((await binder.bind({ memberId: 'nico', playerName: '' })).written, false);

  let attempts = 0;
  const flaky = createAccountBinder({
    putFB: async () => { attempts += 1; return attempts > 1; },
    getFB: async () => null,
  });
  const failed = await flaky.bind({ memberId: 'nico', memberName: 'Nico', playerName: 'A#B', puuid: 'p', game: 'valorant' });
  assert.equal(failed.written, false);
  assert.equal(failed.reason, 'firebase-refused');
  const retried = await flaky.bind({ memberId: 'nico', memberName: 'Nico', playerName: 'A#B', puuid: 'p', game: 'valorant' });
  assert.equal(retried.written, true, 'un refus Firebase doit être retenté, pas mis en cache comme un succès');
}

Promise.all([scenarioRenommage(), scenarioRobustesse()])
  .then(() => console.log('account-binding: rattachement stable au PUUID et survie au renommage validés'))
  .catch(error => { console.error(error); process.exit(1); });
