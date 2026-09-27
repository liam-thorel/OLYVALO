const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isRemakeMatch, cancelledResult, MAX_REMAKE_ROUNDS } = require('../live/remake.js');

test('un remake se reconnaît au nombre de manches, pas au vainqueur', () => {
  // Le cas réel : un joueur ne se connecte pas, l'équipe remake au round 1.
  // Riot renvoie un rapport complet où PERSONNE n'a `won: true` — d'où une
  // défaite publiée pour tout le monde.
  assert.equal(isRemakeMatch({ rounds: 1, score: { blue: 0, red: 1 }, modeFamily: 'standard' }), true);
  assert.equal(isRemakeMatch({ rounds: 2, score: { blue: 1, red: 1 }, modeFamily: 'standard' }), true);

  // Une vraie partie : la reddition la plus précoce possible reste bien au-delà.
  assert.equal(isRemakeMatch({ rounds: 13, score: { blue: 13, red: 0 }, modeFamily: 'standard' }), false);
  assert.equal(isRemakeMatch({ rounds: 24, score: { blue: 13, red: 11 }, modeFamily: 'standard' }), false);
  assert.equal(isRemakeMatch({ rounds: MAX_REMAKE_ROUNDS + 1, score: { blue: 2, red: 1 } }), false);

  // Un deathmatch n'a pas de manches comparables : deux "rounds" y sont normaux.
  assert.equal(isRemakeMatch({ rounds: 1, score: null, modeFamily: 'free-for-all' }), false);

  // Rapport de fin de partie absent : on ne devine pas. `rounds` n'est écrit
  // que par buildDetailedHistory, donc uniquement quand les détails ont été
  // récupérés — un échec réseau ne doit pas transformer une défaite en remake.
  assert.equal(isRemakeMatch({ score: { blue: 4, red: 13 }, modeFamily: 'standard' }), false);
  assert.equal(isRemakeMatch({ rounds: null }), false);
  assert.equal(isRemakeMatch(null), false);

  // Incohérence (compteur de rounds cassé mais score de vraie partie) : on
  // croit le score, qui ne peut pas mentir sur 13 manches gagnées.
  assert.equal(isRemakeMatch({ rounds: 1, score: { blue: 13, red: 3 }, modeFamily: 'standard' }), false);
});

test('le résumé d’une partie annulée dit explicitement qu’elle est annulée', () => {
  const dodge = cancelledResult({ kind: 'dodge', matchId: 'm-1', mode: 'competitive', map: 'Ascent', rr: { delta: -3 } });
  assert.equal(dodge.cancelled, true);
  assert.equal(dodge.kind, 'dodge');
  // Ni 'win' ni 'loss' : le bot doit pouvoir le lire sans rien deviner.
  assert.equal(dodge.result, 'remake');
  assert.deepEqual(dodge.rr, { delta: -3 });

  const remake = cancelledResult({ matchId: 'm-2' });
  assert.equal(remake.kind, 'remake', 'sans précision, c’est un remake');
  assert.equal(remake.rr, null, 'un RR inconnu vaut null, jamais undefined (Firebase supprimerait la clé)');
});

const script = fs.readFileSync(path.join(__dirname, '..', 'live', 'index.js'), 'utf8');

test('le script publie le dodge avec sa file réelle et la pénalité de RR', () => {
  const dodge = script.slice(
    script.indexOf("if (transition.action === 'clear-pregame')"),
    script.indexOf('🚫 Dodge détecté'),
  );
  assert.ok(dodge.length > 0, 'la branche de dodge existe toujours');

  // Sans la vraie file, le bot lit 'agent-select', n'y voit pas une classée et
  // se tait — exactement la panne de la v4.17.
  assert.match(dodge, /mode: pregameState\.mode \|\| 'competitive'/);
  assert.match(dodge, /queueId: pregameState\.mode \|\| 'competitive'/);

  // La pénalité n'est lisible QUE sous l'ID de la sélection d'agents.
  assert.match(dodge, /fetchPostMatchRR\(authTokens, pregameState\.matchId\)\.catch\(\(\) => null\)/,
    'la lecture du RR ne doit jamais faire sauter la publication de la fin de session');
  assert.match(dodge, /result: cancelledResult\(\{/);
  assert.match(dodge, /kind: 'dodge'/);
  assert.match(dodge, /rr: dodgeRR/);
  assert.ok(dodge.indexOf('const dodgeRR') < dodge.indexOf('putFB('),
    'le RR est lu avant la publication, sinon il n’y figure pas');
});

test('un remake écrase le résultat publié pour le bot', () => {
  const ending = script.slice(script.indexOf('const remake = isRemakeMatch(lastGameInfo)'));
  assert.ok(ending.length > 0, 'la détection de remake est branchée sur la fin de partie');
  assert.ok(ending.indexOf('const remake = isRemakeMatch') < ending.indexOf('resultPayload'),
    'le verdict est connu avant de construire le résumé');
  assert.match(ending, /if \(remake\) Object\.assign\(resultPayload, cancelledResult\(\{/,
    'le résumé lu par le bot doit dire « annulée » et non « défaite »');
  // L'historique du site garde le résultat calculé, mais porte le drapeau :
  // filtrer les remakes des stats se fera là, sans nouvelle release du script.
  assert.match(script, /if \(remake\) lastGameInfo\.remake = true;/);
});
