import test from 'node:test';
import assert from 'node:assert/strict';
import { liveScoreView, liveScoreKey } from '../js/live-score.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { presenceScore, blueRedScore } = require('../live/live-score.js');

const base = { active: true, mode: 'competitive', modeFamily: 'standard', scriptVersion: '4.21.0' };

test('le score est montré du point de vue du joueur suivi', () => {
  const rouge = liveScoreView({ ...base, selfTeam: 'CHAOS', score: { blue: 5, red: 7 } });
  assert.deepEqual([rouge.mine, rouge.theirs, rouge.state], [7, 5, 'ahead'],
    'côté Rouge, 5-7 Bleu/Rouge veut dire qu’on mène 7-5');
  assert.deepEqual(rouge.labels, ['Nous', 'Eux']);

  const bleu = liveScoreView({ ...base, selfTeam: 'ORDER', score: { blue: 5, red: 7 } });
  assert.deepEqual([bleu.mine, bleu.theirs, bleu.state], [5, 7, 'behind']);

  assert.equal(liveScoreView({ ...base, selfTeam: 'ORDER', score: { blue: 6, red: 6 } }).state, 'level');
  assert.deepEqual(liveScoreView({ ...base, selfTeam: 'ORDER', score: { blue: 0, red: 0 } }).mine, 0,
    'un 0-0 de début de partie est un vrai score');
});

test('les scripts sans selfTeam retrouvent le camp dans la liste des joueurs', () => {
  const view = liveScoreView({
    ...base, puuid: 'moi', score: { blue: 3, red: 8 },
    players: [{ puuid: 'autre', team: 'ORDER' }, { puuid: 'moi', team: 'CHAOS' }],
  });
  assert.deepEqual([view.mine, view.theirs, view.perspective], [8, 3, true]);
});

test('camp inconnu : score brut, sans prétendre savoir qui mène', () => {
  const view = liveScoreView({ ...base, score: { blue: 9, red: 2 } });
  assert.equal(view.perspective, false);
  assert.deepEqual(view.labels, ['Bleu', 'Rouge']);
  assert.equal(view.state, 'level', 'pas de couleur victoire/défaite sans camp');
});

test('rien à afficher quand le score n’a pas de sens', () => {
  assert.equal(liveScoreView({ ...base, mode: 'agent-select', phase: 'pregame', score: { blue: 0, red: 0 } }), null,
    'pendant le pick');
  assert.equal(liveScoreView({ ...base, modeFamily: 'free-for-all', score: { blue: 0, red: 0 } }), null,
    'en Deathmatch');
  assert.equal(liveScoreView({ ...base, active: false, score: { blue: 13, red: 4 } }), null, 'partie terminée');
  assert.equal(liveScoreView({ ...base, score: {} }), null, 'score encore inconnu');
  assert.equal(liveScoreView({ ...base, score: { blue: -1, red: 3 } }), null, 'valeur aberrante');
});

test('un script d’avant 4.21.0 publie un faux 0-0 : on ne l’affiche pas', () => {
  // L'ancien script lisait le score dans une réponse qui n'en contient pas.
  assert.equal(liveScoreView({ ...base, scriptVersion: '4.20.1', selfTeam: 'ORDER', score: { blue: 0, red: 0 } }), null);
  assert.equal(liveScoreView({ ...base, scriptVersion: '', selfTeam: 'ORDER', score: { blue: 0, red: 0 } }), null);
  assert.ok(liveScoreView({ ...base, scriptVersion: '4.21.3', selfTeam: 'ORDER', score: { blue: 0, red: 0 } }));
});

test('la clé de rendu change à chaque manche', () => {
  const avant = liveScoreKey({ ...base, selfTeam: 'ORDER', score: { blue: 4, red: 4 } });
  const apres = liveScoreKey({ ...base, selfTeam: 'ORDER', score: { blue: 5, red: 4 } });
  assert.notEqual(avant, apres, 'sans ça, la page ne se redessine pas quand seul le score bouge');
  assert.equal(liveScoreKey(null), '');
});

test('script : le score vient de la présence Riot, ancien et nouveau format', () => {
  // Format 2024+ : sous partyPresenceData.
  assert.deepEqual(presenceScore({ partyPresenceData: { partyOwnerMatchScoreAllyTeam: 7, partyOwnerMatchScoreEnemyTeam: 5 } }),
    { ally: 7, enemy: 5 });
  // Format précédent : à la racine.
  assert.deepEqual(presenceScore({ partyOwnerMatchScoreAllyTeam: 2, partyOwnerMatchScoreEnemyTeam: 11 }),
    { ally: 2, enemy: 11 });
  assert.equal(presenceScore({ partyPresenceData: {} }), null, 'pas de score, pas de 0-0 inventé');
  assert.equal(presenceScore({ partyOwnerMatchScoreAllyTeam: '', partyOwnerMatchScoreEnemyTeam: '' }), null);
  assert.equal(presenceScore(null), null);
});

test('script : allié/ennemi devient Bleu/Rouge selon le camp, jamais deviné', () => {
  assert.deepEqual(blueRedScore({ ally: 7, enemy: 5 }, 'ORDER'), { blue: 7, red: 5 });
  assert.deepEqual(blueRedScore({ ally: 7, enemy: 5 }, 'CHAOS'), { blue: 5, red: 7 });
  assert.equal(blueRedScore({ ally: 7, enemy: 5 }, null), null, 'un score inversé annoncerait l’inverse');
  assert.equal(blueRedScore(null, 'ORDER'), null);
});

test('script : plus de remise à 0-0 à chaque poll, et le camp est publié', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../live/index.js', import.meta.url), 'utf8');
  // La cause du score figé : core-game n'a pas d'équipes, `?.Score || 0` y
  // valait toujours 0 et écrasait le vrai score.
  assert.doesNotMatch(script, /teams\.find\(t => t\.TeamID === 'Blue'\)\?\.Score \|\| 0/);
  assert.match(script, /ownPresenceScore = presenceScore\(d\) \|\| ownPresenceScore;/);
  assert.match(script, /const liveScore = blueRedScore\(ownPresenceScore, liveSelfTeam\);\s*\n\s*if \(liveScore\)/,
    'un score absent de la présence garde le dernier connu');
  assert.match(script, /selfTeam:\s+players\.find\(/, 'le camp part avec la session');
});
