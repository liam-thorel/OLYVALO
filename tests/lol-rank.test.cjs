const assert = require('node:assert/strict');
const {
  formatLolRank, mostPlayedPosition, formatPosition, POSITION_LABELS,
} = require('../discord-bot/lol-rank.js');

// ─── Rang ────────────────────────────────────────────────────────────────────
assert.equal(formatLolRank({ tier: 'EMERALD', division: 'II', lp: 64 }), 'Émeraude 2 64 LP');
assert.equal(formatLolRank({ tier: 'CHALLENGER', division: 'I', lp: 1204 }), 'Challenger 1 1204 LP');
assert.equal(formatLolRank({ tier: 'GOLD', division: 'IV', lp: 0 }), 'Or 4 0 LP', '0 LP est une valeur, pas une absence');
assert.equal(formatLolRank({ tier: 'GOLD' }), 'Or');
assert.equal(formatLolRank({}), null);
assert.equal(formatLolRank(null), null);
assert.equal(formatLolRank({ tier: 'INCONNU', division: 'II' }), 'INCONNU 2', 'un tier inconnu passe tel quel');

// ─── Poste le plus joué ──────────────────────────────────────────────────────
const games = positions => positions.map(position => ({ position }));
assert.equal(mostPlayedPosition(games(['jungle', 'jungle', 'middle'])).label, 'Jungle');
assert.equal(mostPlayedPosition(games(['utility'])).label, 'Support');
assert.equal(mostPlayedPosition(games(['bottom', 'bottom'])).games, 2);
assert.equal(mostPlayedPosition(games(['TOP', 'top'])).label, 'Toplane', 'la casse du LCU ne doit pas compter');

// Départage déterministe : même série, ordre différent, même résultat.
assert.equal(
  mostPlayedPosition(games(['jungle', 'middle'])).code,
  mostPlayedPosition(games(['middle', 'jungle'])).code,
);

// ─── Données absentes ────────────────────────────────────────────────────────
assert.equal(mostPlayedPosition([]), null);
assert.equal(mostPlayedPosition(games(['', null, undefined])), null, 'position vide = pas de poste');
assert.equal(mostPlayedPosition([{}]), null);
assert.equal(mostPlayedPosition(games(['inconnu'])), null);
assert.equal(mostPlayedPosition(games(['jungle', 'inconnu'])).label, 'Jungle',
  'une position inconnue ne doit pas masquer les autres');

// ─── Mise en forme ───────────────────────────────────────────────────────────
assert.equal(formatPosition(mostPlayedPosition(games(['jungle']))), '🌲 Jungle');
assert.equal(formatPosition(null), null, 'aucun poste = ligne omise');

// ─── Les cinq postes du LCU sont couverts ────────────────────────────────────
assert.deepEqual(Object.keys(POSITION_LABELS).sort(), ['bottom', 'jungle', 'middle', 'top', 'utility']);

console.log('lol-rank: rangs, postes et départage déterministe validés');
