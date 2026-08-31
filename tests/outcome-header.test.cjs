const assert = require('node:assert/strict');
const { outcomeHeader, joinNames, normalizeOutcome } = require('../discord-bot/outcome-header.js');

// L'ancienne bannière annonçait « 2 joueurs dans la même game ! » sans jamais
// dire ce que la game avait donné. L'en-tête porte maintenant le résultat.

// ─── Une seule issue : un joueur ou tout le stack ─────────────────────────────
assert.equal(outcomeHeader([{ name: 'Rayhan', outcome: 'win' }]),
  '🏆 **Victoire** pour **Rayhan**');
assert.equal(outcomeHeader([{ name: 'Mathis', outcome: 'loss' }, { name: 'Rayhan', outcome: 'loss' }]),
  '💀 **Défaite** pour **Mathis et Rayhan**');
assert.equal(outcomeHeader([{ name: 'Mathis', outcome: 'draw' }, { name: 'Rayhan', outcome: 'draw' }]),
  '🤝 **Égalité** pour **Mathis et Rayhan**');

// ─── League publie un booléen, Valorant une chaîne ───────────────────────────
assert.equal(outcomeHeader([{ name: 'Mathis', outcome: true }]), '🏆 **Victoire** pour **Mathis**');
assert.equal(outcomeHeader([{ name: 'Mathis', outcome: false }]), '💀 **Défaite** pour **Mathis**');
assert.equal(normalizeOutcome(true), 'win');
assert.equal(normalizeOutcome(false), 'loss');
assert.equal(normalizeOutcome('draw'), 'draw');

// ─── Deux joueurs du roster dans des équipes opposées ────────────────────────
// Le cas que l'ancienne bannière ne pouvait pas exprimer : elle affirmait un
// regroupement, jamais un résultat, donc la question ne se posait pas.
assert.equal(
  outcomeHeader([{ name: 'Mathis', outcome: 'win' }, { name: 'Rayhan', outcome: 'loss' }]),
  '🏆 **Victoire** pour **Mathis**\n💀 **Défaite** pour **Rayhan**',
);

// L'ordre d'affichage suit celui des joueurs, pas un ordre d'issue arbitraire.
assert.match(
  outcomeHeader([{ name: 'Rayhan', outcome: 'loss' }, { name: 'Mathis', outcome: 'win' }]),
  /^💀 \*\*Défaite\*\* pour \*\*Rayhan\*\*\n/,
);

// ─── Résultat inconnu : rapport de fin de game incomplet ─────────────────────
// Mieux vaut « Game terminée » qu'une victoire inventée.
for (const unknown of ['completed', null, undefined, 'surrender', '']) {
  assert.equal(
    outcomeHeader([{ name: 'Mathis', outcome: unknown }]),
    '🎮 **Game terminée** pour **Mathis**',
    `issue inconnue : ${JSON.stringify(unknown)}`,
  );
}

// ─── Énumération des noms ────────────────────────────────────────────────────
assert.equal(joinNames(['Mathis']), 'Mathis');
assert.equal(joinNames(['Mathis', 'Rayhan']), 'Mathis et Rayhan');
assert.equal(joinNames(['Mathis', 'Rayhan', 'Liam']), 'Mathis, Rayhan et Liam');
assert.equal(joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C, D et E');
assert.equal(joinNames([]), '');

// ─── Rien à annoncer = pas d'en-tête ────────────────────────────────────────
// Discord refuse un message dont le contenu est une chaîne vide : l'appelant
// attend null pour n'envoyer que les embeds.
assert.equal(outcomeHeader([]), null);
assert.equal(outcomeHeader(), null);
assert.equal(outcomeHeader([{ outcome: 'win' }]), null, 'un joueur sans nom ne compte pas');
assert.equal(outcomeHeader([null, undefined]), null);

// Un joueur nommé parmi des entrées vides reste annoncé.
assert.equal(outcomeHeader([null, { name: 'Mathis', outcome: 'win' }]),
  '🏆 **Victoire** pour **Mathis**');

// ─── Plus de trace de l'ancienne bannière ───────────────────────────────────
assert.doesNotMatch(
  outcomeHeader([{ name: 'Mathis', outcome: 'loss' }, { name: 'Rayhan', outcome: 'loss' }]),
  /STACK OLYCITY|dans la même game/,
);

console.log('outcome-header: le résultat remplace la bannière de stack, équipes opposées comprises');
