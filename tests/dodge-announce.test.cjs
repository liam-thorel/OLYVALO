const assert = require('node:assert/strict');
const { loadBot, sentText } = require('./bot-harness.cjs');

/**
 * Le dodge signalé en prod : Liam perd du RR, et le bot ne dit rien.
 *
 * Ce qui se passait : la notification de départ partait à la sélection
 * d'agents, les paris s'ouvraient, quelqu'un dodgeait… et ensuite plus rien.
 * Le remboursement avait bien lieu, mais silencieusement (aucun embed, la
 * partie n'ayant ni mode ni résultat), et surtout la fenêtre anti-doublon de
 * 20 minutes restait fermée sur le groupe : la partie relancée dans la minute
 * — vraie partie, nouveau matchId — n'était plus annoncée du tout.
 */

const { api, calls } = loadBot({ openRounds: ['match-A'] });
const { notifyValorantGameStart, notifyValorantGameEnd } = api;

const RANKED = { mode: 'agent-select', queueId: 'competitive', map: 'Ascent', mapClean: 'Ascent' };

function agentSelect(matchId) {
  return { active: true, ts: Date.now(), playerName: 'Liam#OLY', memberId: 'liam', member: 'Liam', matchId, ...RANKED };
}

function dodged(matchId, rr) {
  return {
    active: false, ts: Date.now(), playerName: 'Liam#OLY', memberId: 'liam', member: 'Liam',
    matchId, mode: 'competitive', queueId: 'competitive', map: 'Ascent', mapClean: 'Ascent',
    result: {
      result: 'remake', cancelled: true, kind: 'dodge',
      matchId, mode: 'competitive', map: 'Ascent', rr,
    },
  };
}

(async () => {
  // ─── La partie dodgée est bien annoncée ────────────────────────────────────
  const first = agentSelect('match-A');
  await notifyValorantGameStart(first, { liam: first });
  assert.equal(calls.sends.length, 1, 'la notification de départ part à la sélection d’agents');

  calls.sends.length = 0;
  await notifyValorantGameEnd([dodged('match-A', { delta: -3, before: 33, after: 30 })]);

  const announce = sentText(calls.sends);
  assert.match(announce, /annulée/i, 'l’annulation doit être annoncée, pas passée sous silence');
  assert.match(announce, /dodge/i, 'le message doit dire que c’est un dodge en sélection d’agents');
  assert.match(announce, /-3 RR/, 'le RR perdu doit être annoncé — c’est ce que le joueur voit dans son client');
  assert.doesNotMatch(announce, /Défaite/i, 'une partie annulée n’est pas une défaite');

  assert.deepEqual(calls.cancelled, ['valorant:match-A'], 'les mises sont remboursées');
  assert.deepEqual(calls.rankGains, [],
    'la pénalité de dodge ne doit PAS être comptée dans le suivi de RR — c’est le « refund »');
  assert.deepEqual(calls.playRewards, [], 'aucun point de participation pour une partie non jouée');
  assert.deepEqual(calls.awards, [], 'aucun award sur une partie non jouée');

  // ─── Et la game d'après est notifiée, tout de suite ────────────────────────
  calls.sends.length = 0;
  const second = agentSelect('match-B');
  await notifyValorantGameStart(second, { liam: second });
  assert.equal(calls.sends.length, 1,
    'la partie relancée après le dodge doit être annoncée sans attendre 20 minutes');

  // ─── Le garde-fou anti-doublon reste en place ─────────────────────────────
  // Sans dodge entre les deux, un même grobe revu dans la fenêtre reste un
  // doublon : c'est ce qui protège des reconnexions du flux Firebase.
  calls.sends.length = 0;
  const again = agentSelect('match-C');
  await notifyValorantGameStart(again, { liam: again });
  assert.equal(calls.sends.length, 0,
    'sans annulation, la fenêtre anti-doublon doit toujours bloquer un doublon');

  // ─── Remake : la partie a démarré, mais elle ne compte pas ────────────────
  calls.sends.length = 0; calls.rankGains.length = 0; calls.playRewards.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Liam#OLY', memberId: 'liam', member: 'Liam',
    matchId: 'match-D', mode: 'competitive',
    result: {
      result: 'remake', cancelled: true, kind: 'remake', matchId: 'match-D',
      mode: 'competitive', map: 'Bind', rr: { delta: 0 }, kills: 0, deaths: 1, assists: 0,
    },
  }]);
  const remakeText = sentText(calls.sends);
  assert.match(remakeText, /remake/i, 'un remake doit être annoncé comme tel');
  assert.doesNotMatch(remakeText, /Défaite/i, 'un remake n’est pas une défaite');
  assert.doesNotMatch(remakeText, /RR de pénalité/, 'sans RR perdu, pas de ligne de pénalité');
  assert.deepEqual(calls.rankGains, [], 'un remake ne bouge pas le récap RR');
  assert.deepEqual(calls.playRewards, [], 'un remake ne crédite pas de points de participation');

  // ─── Une normale dodgée ne fait pas de bruit ──────────────────────────────
  // Son départ n'avait jamais été annoncé : annoncer son annulation serait un
  // message sorti de nulle part.
  calls.sends.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Liam#OLY', memberId: 'liam', member: 'Liam',
    matchId: 'match-E', mode: 'unrated',
    result: { result: 'remake', cancelled: true, kind: 'dodge', matchId: 'match-E', mode: 'unrated', rr: null },
  }]);
  assert.equal(calls.sends.length, 0, 'hors classée, rien à annoncer');

  console.log('dodge-announce: dodge et remake annoncés, RR non compté, game suivante notifiée');
})().catch(error => { console.error(error); process.exit(1); });
