const assert = require('node:assert/strict');
const { oddsFromScore, isHalfTime, ownScore, raceProbability, TARGET_ROUNDS } = require('../discord-bot/live-odds.js');

// Le moteur d'avant-match ne peut s'appuyer que sur le rang et le winrate :
// Riot masque l'adversaire jusqu'à la fin de la partie. Le score, lui, est un
// signal direct — et bien plus fort.

// ─── La probabilité est exacte, pas approchée ────────────────────────────────
// Course de Bernoulli : arriver à `need` succès avant `theirNeed`, chaque
// manche supposée équilibrée. Ces valeurs se vérifient à la main.
assert.equal(raceProbability(1, 1), 0.5, 'une manche partout : pile ou face');
assert.equal(raceProbability(1, 2), 0.75, 'il me faut 1 manche, 2 à l’adversaire');
assert.equal(raceProbability(2, 1), 0.25);
assert.equal(raceProbability(1, 3), 0.875);
assert.equal(raceProbability(0, 5), 1, 'plus rien à gagner = déjà gagné');
assert.equal(raceProbability(5, 0), 0);

// Les deux camps doivent toujours sommer à 1 : sans ça, les cotes seraient
// incohérentes entre elles.
for (const [a, b] of [[1, 1], [3, 7], [7, 7], [13, 13], [2, 11], [10, 4]]) {
  const somme = raceProbability(a, b) + raceProbability(b, a);
  assert.ok(Math.abs(somme - 1) < 1e-9, `${a} vs ${b} : somme = ${somme}`);
}

// ─── Du score aux cotes ──────────────────────────────────────────────────────
assert.equal(oddsFromScore(6, 6).probability, 0.5, 'à égalité, 50 %');
assert.equal(oddsFromScore(6, 6).oddsWin, 2);
assert.equal(oddsFromScore(6, 6).oddsLose, 2);

// 12–11 : il me faut 1 manche, 2 à l'adversaire.
assert.equal(oddsFromScore(12, 11).probability, 0.75);
assert.equal(oddsFromScore(12, 11).oddsWin, 1.33);

// Mené, la cote de victoire monte ; menant, elle descend. C'est tout l'intérêt.
assert.ok(oddsFromScore(3, 9).oddsWin > oddsFromScore(6, 6).oddsWin);
assert.ok(oddsFromScore(9, 3).oddsWin < oddsFromScore(6, 6).oddsWin);

// Bornes : on n'affiche jamais une cote qui laisserait croire à une certitude.
assert.ok(oddsFromScore(12, 0).probability <= 0.95);
assert.ok(oddsFromScore(0, 12).probability >= 0.05);

// Partie déjà pliée ou score inexploitable : on n'ouvre pas de pari plutôt que
// d'en ouvrir un sur une cote inventée.
for (const [a, b] of [[13, 5], [5, 13], [14, 2], [-1, 3], [3, -1]]) {
  assert.equal(oddsFromScore(a, b), null, `score ${a}-${b} refusé`);
}
assert.equal(oddsFromScore(null, 3), null);
assert.equal(oddsFromScore('abc', 3), null);
assert.equal(oddsFromScore(undefined, undefined), null);

assert.match(oddsFromScore(9, 3).explanation, /9–3/);
assert.match(oddsFromScore(9, 3).explanation, /95%/);

// ─── Détection de la mi-temps ────────────────────────────────────────────────
// Le score est republié à chaque manche : exiger l'égalité exacte évite de
// rouvrir un pari à chacune des manches suivantes.
assert.equal(isHalfTime({ blue: 6, red: 6 }), true);
assert.equal(isHalfTime({ blue: 9, red: 3 }), true, '12 manches jouées, quel que soit l’écart');
assert.equal(isHalfTime({ blue: 12, red: 0 }), true);
assert.equal(isHalfTime({ blue: 7, red: 6 }), false, '13 manches : la mi-temps est passée');
assert.equal(isHalfTime({ blue: 6, red: 5 }), false);
assert.equal(isHalfTime({ blue: 0, red: 0 }), false);
assert.equal(isHalfTime({}), false);
assert.equal(isHalfTime(null), false);
assert.equal(isHalfTime({ blue: 'six', red: 6 }), false);

// ─── Quel camp est le nôtre ──────────────────────────────────────────────────
// Se tromper inverserait la cote : le favori deviendrait l'outsider.
assert.deepEqual(ownScore({ blue: 9, red: 3 }, 'ORDER'), { mine: 9, theirs: 3 });
assert.deepEqual(ownScore({ blue: 9, red: 3 }, 'CHAOS'), { mine: 3, theirs: 9 });
// Camp inconnu : on ne devine pas.
assert.equal(ownScore({ blue: 9, red: 3 }, 'NEUTRAL'), null);
assert.equal(ownScore({ blue: 9, red: 3 }, null), null);
assert.equal(ownScore(null, 'ORDER'), null);

// ─── Cohérence d'ensemble ────────────────────────────────────────────────────
// Toute la grille des scores possibles doit produire des cotes exploitables.
for (let mine = 0; mine < TARGET_ROUNDS; mine++) {
  for (let theirs = 0; theirs < TARGET_ROUNDS; theirs++) {
    const cote = oddsFromScore(mine, theirs);
    assert.ok(cote, `${mine}-${theirs} doit produire une cote`);
    assert.ok(cote.oddsWin >= 1, `cote de victoire sous 1 à ${mine}-${theirs}`);
    assert.ok(cote.oddsLose >= 1, `cote de défaite sous 1 à ${mine}-${theirs}`);
    if (mine === theirs) assert.equal(cote.probability, 0.5, `${mine}-${theirs} doit rester à 50 %`);
  }
}

console.log('live-odds: probabilité exacte, bornes et détection de mi-temps validées');
