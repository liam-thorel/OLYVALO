const assert = require('node:assert/strict');
const Module = require('node:module');

// Chaque script publie SON rapport de fin de game, et chaque rapport liste les
// dix joueurs de la partie. Un membre du roster se retrouve donc dans le
// rapport de ses coéquipiers autant que dans le sien : sans dédoublonnage, une
// game jouée en stack de cinq comptait cinq fois dans son historique.
//
// Le winrate et les moyennes n'en souffraient pas — les doublons sont
// identiques — ce qui a masqué le problème. Le nombre de games, la frise de
// résultats et la fenêtre des vingt dernières games, si.

const report = (matchId, reporterPuuid, extra = {}) => ({
  matchId,
  mode: 'competitive',
  map: 'Split',
  result: 'loss',
  ts: 1000,
  playerPuuid: reporterPuuid,
  // Le rang publié appartient au rapporteur, pas aux autres joueurs listés.
  rr: { tier: 21, after: 15, delta: -18 },
  players: [
    { name: 'Mathis#OLY', puuid: 'puuid-mathis', agent: 'Omen', stats: { kills: 24, deaths: 20, assists: 5, acs: 296, hsPercent: 26 } },
    { name: 'Rayhan#OLY', puuid: 'puuid-rayhan', agent: 'Jett', stats: { kills: 15, deaths: 23, assists: 12, acs: 178, hsPercent: 37 } },
    { name: 'Inconnu#EU', puuid: 'puuid-autre', agent: 'Sage', stats: { kills: 9, deaths: 14, assists: 8, acs: 140, hsPercent: 18 } },
  ],
  ...extra,
});

function load(historyRoot) {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { FIREBASE_URL: 'x' };
    if (request === './firebase.js') return { fbGet: async path => (path === 'live/history' ? historyRoot : null) };
    return original(request, parent, isMain);
  };
  delete require.cache[require.resolve('../discord-bot/stats.js')];
  const stats = require('../discord-bot/stats.js');
  Module._load = original;
  return stats;
}

(async () => {
  // ─── Stack de deux : une game, deux rapports ──────────────────────────────
  const stats = load({
    'MATCH-1': { reports: { r1: report('MATCH-1', 'puuid-mathis'), r2: report('MATCH-1', 'puuid-rayhan') } },
  });

  for (const [who, kills] of [['Mathis#OLY', 24], ['Rayhan#OLY', 15]]) {
    const entries = await stats.historyFor('valorant', [who]);
    assert.equal(entries.length, 1, `${who} : une game jouée = une entrée`);
    assert.equal(entries[0].kills, kills, 'les stats restent celles du bon joueur');
    // Le rapport conservé doit être celui écrit par le joueur lui-même, sinon
    // son rang est perdu et le récap n'affiche plus de palier.
    assert.equal(entries[0].isReporter, true, `${who} : on garde son propre rapport`);
    assert.equal(entries[0].tier, 21, `${who} : son rang survit au dédoublonnage`);
    assert.equal(entries[0].rr, 15);
  }

  // ─── Stack de cinq : le cas qui gonflait le plus ──────────────────────────
  const five = ['a', 'b', 'c', 'd', 'e'];
  const bigStack = load({
    'MATCH-2': {
      reports: Object.fromEntries(five.map(k => [k, report('MATCH-2', `puuid-${k}`)])),
    },
  });
  const solo = await bigStack.historyFor('valorant', ['Mathis#OLY']);
  assert.equal(solo.length, 1, 'cinq rapports pour une game = une seule entrée');

  // ─── Des games distinctes restent distinctes ──────────────────────────────
  const many = load({
    'MATCH-1': { reports: { r1: report('MATCH-1', 'puuid-mathis'), r2: report('MATCH-1', 'puuid-rayhan') } },
    'MATCH-2': { reports: { r1: report('MATCH-2', 'puuid-mathis', { ts: 2000 }) } },
    'MATCH-3': { reports: { r1: report('MATCH-3', 'puuid-rayhan', { ts: 3000 }) } },
  });
  const mathis = await many.historyFor('valorant', ['Mathis#OLY']);
  assert.equal(mathis.length, 3, 'trois matchId distincts = trois entrées');
  assert.deepEqual(mathis.map(e => e.matchId), ['MATCH-3', 'MATCH-2', 'MATCH-1'],
    'toujours triées de la plus récente à la plus ancienne');

  // Sur MATCH-3, Mathis n'est pas le rapporteur : son rang n'est pas connu, et
  // on ne doit surtout pas lui attribuer celui de Rayhan.
  const notReporter = mathis.find(e => e.matchId === 'MATCH-3');
  assert.equal(notReporter.isReporter, false);
  assert.equal(notReporter.tier, null, 'aucun rang emprunté à un coéquipier');

  // ─── Rapports anciens sans matchId ────────────────────────────────────────
  // Impossible de les regrouper de façon sûre : les fusionner sur une clé
  // approchée effacerait de vraies games. On les garde tels quels.
  const legacy = load({
    old1: { reports: { r1: { ...report('', 'puuid-mathis'), matchId: undefined, ts: 500 } } },
    old2: { reports: { r1: { ...report('', 'puuid-mathis'), matchId: undefined, ts: 600 } } },
  });
  assert.equal((await legacy.historyFor('valorant', ['Mathis#OLY'])).length, 2,
    'deux rapports sans matchId restent deux games');

  // ─── Un joueur hors roster ne doit rien ramener ───────────────────────────
  assert.deepEqual(await many.historyFor('valorant', ['Personne#XXX']), []);

  console.log('valorant-history-dedupe: une game jouée en stack ne compte plus qu’une fois');
})().catch(error => { console.error(error); process.exit(1); });
