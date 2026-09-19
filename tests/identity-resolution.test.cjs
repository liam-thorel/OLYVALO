const assert = require('node:assert/strict');
const Module = require('node:module');

// L'historique doit se résoudre par l'identité STABLE du joueur et non par son
// nom : un renommage rendait invisible tout un historique, et c'est ce qui a
// fait disparaître des joueurs entiers des courbes et des récaps.
function loadStats(data) {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { FIREBASE_URL: 'x' };
    if (request === './firebase.js') return { fbGet: async path => data[path] ?? null };
    return original(request, parent, isMain);
  };
  delete require.cache[require.resolve('../discord-bot/stats.js')];
  const stats = require('../discord-bot/stats.js');
  Module._load = original;
  return stats;
}

(async () => {
  // ─── Valorant : le puuid prime sur le nom ──────────────────────────────────
  const rapport = (ts, nom, puuid) => ({
    matchId: `m${ts}`, ts, mode: 'competitive', result: 'win',
    playerPuuid: puuid, player: nom,
    players: [{ name: nom, puuid, agent: 'Omen', stats: { kills: 10, deaths: 5, assists: 3 } }],
  });

  const valorant = loadStats({
    'live/history': {
      m1: { reports: { r: rapport(1, 'Ancien Nom#0000', 'puuid-liam') } },
      m2: { reports: { r: rapport(2, 'Nouveau Nom#2046', 'puuid-liam') } },
    },
  });

  // Le roster ne connaît QUE l'ancien nom, mais il connaît le puuid.
  const liam = { id: 'liam', riotIds: ['Ancien Nom#0000'], puuids: ['puuid-liam'] };
  const entries = await valorant.historyFor('valorant', liam);
  assert.equal(entries.length, 2, 'les deux parties sont retrouvées, renommage compris');

  // Sans le puuid, seule la partie portant l'ancien nom serait visible : c'est
  // exactement l'historique qui disparaissait.
  const sansPuuid = await valorant.historyFor('valorant', { id: 'liam', riotIds: ['Ancien Nom#0000'], puuids: [] });
  assert.equal(sansPuuid.length, 1, 'le repli par nom reste possible, mais incomplet');

  // Un puuid étranger ne doit rien ramener.
  assert.equal((await valorant.historyFor('valorant', { id: 'x', riotIds: [], puuids: ['autre'] })).length, 0);

  // ─── LoL : le memberId prime sur le nom ────────────────────────────────────
  // Les entrées LoL ne portent pas de puuid, mais elles portent memberId —
  // écrit à l'installation du script, insensible aux renommages.
  const lol = loadStats({
    'live/lolHistory': {
      a: { playerName: 'Ancien#EUW', memberId: 'liam', ts: 1, win: true, queueId: 420 },
      b: { playerName: 'Nouveau#EUW', memberId: 'liam', ts: 2, win: false, queueId: 420 },
      c: { playerName: 'Quelquun#EUW', memberId: 'autre', ts: 3, win: true, queueId: 420 },
    },
  });
  const sien = await lol.historyFor('lol', { id: 'liam', riotIds: ['Ancien#EUW'], puuids: [] });
  assert.equal(sien.length, 2, 'les deux parties du membre, quel que soit le nom');
  assert.equal(sien.some(e => e.memberId === 'autre'), false, 'et aucune de quelqu’un d’autre');

  // Le puuid prime sur tout : il est publié par le script depuis la v4.18 et
  // survit aussi bien à un renommage qu'à un changement de memberId.
  const avecPuuid = loadStats({
    'live/lolHistory': {
      a: { playerName: 'Ancien#EUW', puuid: 'puuid-liam', memberId: 'autre-id', ts: 1, win: true, queueId: 420 },
      b: { playerName: 'Inconnu#EUW', puuid: 'puuid-liam', ts: 2, win: false, queueId: 420 },
      c: { playerName: 'X#EUW', puuid: 'puuid-nico', ts: 3, win: true, queueId: 420 },
    },
  });
  const parPuuid = await avecPuuid.historyFor('lol', { id: 'liam', riotIds: [], puuids: ['puuid-liam'] });
  assert.equal(parPuuid.length, 2, 'retrouvé par puuid, sans nom ni memberId concordants');
  assert.equal(parPuuid.some(e => e.puuid === 'puuid-nico'), false);

  // Un compte SANS puuid enregistré reste suivi : tout le monde n'en a pas.
  const lolSansPuuid = await avecPuuid.historyFor('lol', { id: '', riotIds: ['Ancien#EUW'], puuids: [] });
  assert.equal(lolSansPuuid.length, 1, 'le repli par nom reste en place');

  // Entrée ancienne sans memberId : le nom reste le seul recours.
  const legacy = loadStats({
    'live/lolHistory': { a: { playerName: 'Ancien#EUW', ts: 1, win: true, queueId: 420 } },
  });
  assert.equal((await legacy.historyFor('lol', { id: 'liam', riotIds: ['Ancien#EUW'], puuids: [] })).length, 1);

  // ─── Compatibilité d'appel ─────────────────────────────────────────────────
  // Un appelant oublié qui passerait encore un simple tableau ne doit pas
  // renvoyer un historique vide en silence.
  assert.equal((await valorant.historyFor('valorant', ['Ancien Nom#0000'])).length, 1);

  console.log('identity-resolution: historique résolu par puuid (Valorant) et memberId (LoL)');
})().catch(error => { console.error(error); process.exit(1); });
