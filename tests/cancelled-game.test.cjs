const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelledGame, cancelledSession, cancelledTitle, rrPenaltyLine } = require('../discord-bot/cancelled-game.js');

test('seul un marqueur explicite fait une partie annulée', () => {
  assert.equal(cancelledSession({ result: { cancelled: true, kind: 'dodge' } }).kind, 'dodge');
  assert.equal(cancelledSession({ result: { result: 'remake' } }).kind, 'remake');
  assert.equal(cancelledSession({ result: { result: 'REMAKE' } }).kind, 'remake', 'la casse ne compte pas');

  // Une vraie partie n'est jamais annulée.
  assert.equal(cancelledSession({ result: { result: 'loss', kills: 3 } }), null);
  assert.equal(cancelledSession({ result: { result: 'draw' } }), null, 'une égalité a bien été jouée');

  // Le cas qu'il ne faut PAS confondre : le script a publié la fin de session
  // et le rapport de fin de partie n'est jamais arrivé. Les mises sont
  // remboursées (ailleurs), mais on n'annonce pas un remake qu'on n'a pas vu.
  assert.equal(cancelledSession({ matchId: 'm-1' }), null);
  assert.equal(cancelledSession(null), null);
});

test('un seul joueur marqué suffit, et c’est celui qui connaît le RR qui parle', () => {
  const dodger = { result: { cancelled: true, kind: 'dodge', rr: { delta: -3 }, map: 'Ascent' } };
  const teammate = { result: { cancelled: true, kind: 'dodge', rr: { delta: 0 } } };

  // Sur un stack, seul le fautif reçoit la pénalité : si on retenait la
  // première session venue, l'annonce dirait « 0 RR » une fois sur deux.
  assert.equal(cancelledGame([teammate, dodger]).rr.delta, -3);
  assert.equal(cancelledGame([teammate, dodger]).map, 'Ascent');
  assert.equal(cancelledGame([{ result: { result: 'loss' } }]), null);
  assert.equal(cancelledGame([]), null);
});

test('la pénalité est dite quand il y en a une, et seulement là', () => {
  assert.match(rrPenaltyLine({ delta: -3 }), /-3 RR/);
  assert.match(rrPenaltyLine({ delta: -3 }), /non comptés dans le récap/,
    'le joueur doit savoir que le bot ne la compte pas dans son bilan');
  assert.equal(rrPenaltyLine({ delta: 0 }), null, 'les coéquipiers n’ont rien perdu');
  assert.equal(rrPenaltyLine(null), null);
  assert.equal(rrPenaltyLine({}), null);
});

test('le titre distingue le dodge du remake', () => {
  assert.match(cancelledTitle('dodge'), /dodge/i);
  assert.match(cancelledTitle('remake'), /remake/i);
  assert.match(cancelledTitle('n’importe quoi'), /remake/i, 'repli sûr');
});
