const assert = require('node:assert/strict');
const { loadBot } = require('./bot-harness.cjs');

// Une partie annulée — dodge en sélection d'agents, joueur qui ne se connecte
// pas — n'a ni mode ni résultat quand le script est antérieur à 4.21.0 : il
// publie la fin de session AVANT d'aller chercher le rapport de fin de partie,
// et pour ces parties-là ce rapport n'arrive jamais.
//
// C'est pourtant ce chemin qui doit annuler le pari, rembourser les mises et
// réactualiser le message. Le garde « file classée » sortait avant, parce
// qu'un mode absent se lisait comme un mode non classé.

// Parties sur lesquelles un pari a réellement été ouvert (donc des classées
// qui ont démarré) avant d'être annulées.
const { api, calls } = loadBot({ openRounds: ['match-dodge', 'lol-annule'] });
const { notifyValorantGameEnd, notifyLolGameEnd } = api;
const { cancelled, resolved, edited } = calls;

(async () => {
  // ─── Le cas signalé : dodge ─────────────────────────────────────────────────
  // La session telle que le script la publie vraiment à l'annulation : ni mode,
  // ni résultat, juste le matchId de la sélection d'agents.
  cancelled.length = 0; resolved.length = 0; edited.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Joueur1#OLY',
    memberId: 'joueur1', member: 'Joueur1', matchId: 'match-dodge',
  }]);

  assert.deepEqual(cancelled, ['valorant:match-dodge'],
    'le pari doit être annulé et les mises remboursées');
  assert.deepEqual(resolved, [], 'sans vainqueur, on annule au lieu de résoudre');
  assert.equal(edited.length, 1, 'le message de pari doit être réactualisé');

  // ─── Le garde reste efficace sur un mode RÉELLEMENT identifié ──────────────
  cancelled.length = 0; edited.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Joueur2#OLY',
    memberId: 'joueur2', member: 'Joueur2', matchId: 'match-dm',
    mode: 'deathmatch',
    result: { result: 'completed', mode: 'deathmatch', kills: 30, deaths: 20, assists: 0 },
  }]);
  assert.deepEqual(cancelled, [], 'aucun pari n’existe sur un deathmatch, rien à annuler');

  // ─── LoL : une file inconnue ne doit pas non plus bloquer le nettoyage ─────
  cancelled.length = 0; edited.length = 0;
  await notifyLolGameEnd([{
    active: false, ts: Date.now(), playerName: 'Invoc1#EUW',
    memberId: 'invoc1', member: 'Invoc1', matchId: 'lol-annule',
  }]);
  assert.deepEqual(cancelled, ['lol:lol-annule'],
    'une partie LoL annulée doit aussi rembourser');

  console.log('dodge-cleanup: une partie annulée annule le pari et réactualise le message');
})().catch(error => { console.error(error); process.exit(1); });
