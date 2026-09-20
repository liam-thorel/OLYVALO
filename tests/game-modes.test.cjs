const assert = require('node:assert/strict');
const { sessionMode, isRankedValorantSession, PHASE_MODES } = require('../discord-bot/game-modes.js');

// ─── La file d'une session, phase traversée ──────────────────────────────────
// Pendant la sélection d'agent, le script publie `mode: 'agent-select'` — une
// PHASE, pas une file — et range la vraie file dans `queueId`.
assert.equal(sessionMode({ mode: 'agent-select', queueId: 'competitive' }), 'competitive');
assert.equal(sessionMode({ mode: 'agent-select', queueId: 'unrated' }), 'unrated');
assert.equal(sessionMode({ mode: 'competitive', queueId: 'competitive' }), 'competitive');

// L'ordre est délibéré : `mode` d'abord. Les scripts d'avant la séparation y
// mettaient la vraie file SANS publier de `queueId` ; lire `queueId` en
// premier ferait de ces postes des sessions sans file, donc muettes.
assert.equal(sessionMode({ mode: 'competitive' }), 'competitive', 'un poste sans queueId reste lisible');
// Et si les deux se contredisent, c'est `mode` qui tranche — sauf s'il ne
// décrit qu'une phase. Inverser rendrait un poste pas à jour silencieux.
assert.equal(sessionMode({ mode: 'competitive', queueId: 'unrated' }), 'competitive',
  '`mode` prime quand il décrit une vraie file');
assert.equal(sessionMode({ mode: 'pregame', queueId: 'competitive' }), 'competitive',
  'une phase laisse la main à queueId');

assert.equal(sessionMode({}), '', 'rien de connu : rien à affirmer');
assert.equal(sessionMode(null), '');
assert.equal(sessionMode({ mode: '  COMPETITIVE  ' }), 'competitive', 'casse et espaces normalisés');

// ─── Le prédicat ─────────────────────────────────────────────────────────────
assert.equal(isRankedValorantSession({ mode: 'agent-select', queueId: 'competitive' }), true,
  'le pick d’une classée est une classée — c’est là que s’ouvre le pari d’avant-match');
assert.equal(isRankedValorantSession({ mode: 'agent-select', queueId: 'deathmatch' }), false);
assert.equal(isRankedValorantSession({ mode: 'agent-select' }), false,
  'sans file connue, on se tait plutôt que de faire passer un deathmatch pour une classée');
assert.equal(isRankedValorantSession({ mode: 'competitive' }), true);
assert.equal(isRankedValorantSession({}), false);

// Les phases sont une liste fermée : tout le reste est une file, et doit le
// rester. Ajouter 'competitive' ici ferait taire le bot en silence.
assert.ok(PHASE_MODES.has('agent-select'));
assert.ok(!PHASE_MODES.has('competitive'), 'une file n’est jamais une phase');

console.log('game-modes: la file survit à la phase, sans rendre muets les postes pas à jour');
