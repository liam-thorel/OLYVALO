/**
 * Cote recalculée en cours de partie, à partir du score.
 *
 * Le moteur d'avant-match (odds.js) ne peut s'appuyer que sur le rang et le
 * winrate de l'équipe suivie : Riot masque l'adversaire jusqu'à la fin de la
 * partie. Une fois le score connu, on dispose enfin d'un signal DIRECT sur le
 * rapport de force — et bien plus fort que tout le reste.
 *
 * Le modèle est volontairement explicite : on suppose chaque manche restante
 * équilibrée, et on calcule la probabilité EXACTE d'arriver au score cible en
 * premier. Ce n'est pas une prédiction sophistiquée, mais elle est honnête :
 * la seule chose qu'on sache vraiment, c'est le score.
 */

// Valorant classé : premier à 13 manches.
const TARGET_ROUNDS = 13;
// Mi-temps : le changement de camp intervient après 12 manches jouées.
const HALF_TIME_ROUNDS = 12;

// Mêmes bornes qu'en avant-match : on n'affiche jamais une cote qui laisserait
// croire à une certitude.
const MIN_PROBABILITY = 0.05;
const MAX_PROBABILITY = 0.95;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Number(null) vaut 0, Number('') aussi : une absence se lirait comme un score
 * de zéro et produirait une cote sur une partie qu'on n'observe pas.
 */
function roundsWon(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

/**
 * Probabilité d'obtenir `need` succès avant que l'adversaire n'en obtienne
 * `theirNeed`, chaque manche étant supposée équilibrée.
 *
 * C'est une course de Bernoulli : on somme, sur le nombre de manches que
 * l'adversaire peut encore gagner sans conclure, la probabilité d'un scénario
 * où l'on atteint la cible en premier. Le résultat est exact, pas approché.
 */
function raceProbability(need, theirNeed) {
  if (need <= 0) return 1;
  if (theirNeed <= 0) return 0;

  let probability = 0;
  let coefficient = 1; // C(need - 1 + k, k), construit de proche en proche
  for (let k = 0; k < theirNeed; k++) {
    if (k > 0) coefficient = (coefficient * (need - 1 + k)) / k;
    probability += coefficient * Math.pow(0.5, need + k);
  }
  return probability;
}

/**
 * Score → cotes. `mine` et `theirs` sont les manches déjà gagnées.
 * Retourne null si le score est inexploitable : mieux vaut ne pas ouvrir de
 * pari que d'en ouvrir un sur une cote inventée.
 */
function oddsFromScore(mine, theirs, { target = TARGET_ROUNDS } = {}) {
  const won = roundsWon(mine);
  const lost = roundsWon(theirs);
  if (won === null || lost === null) return null;
  if (won >= target || lost >= target) return null; // partie déjà pliée

  const probability = clamp(raceProbability(target - won, target - lost), MIN_PROBABILITY, MAX_PROBABILITY);
  return {
    probability,
    // Pas de marge : la cote est l'inverse exact de la probabilité, comme en
    // avant-match.
    oddsWin: Number((1 / probability).toFixed(2)),
    oddsLose: Number((1 / (1 - probability)).toFixed(2)),
    explanation: `${won}–${lost} · ${Math.round(probability * 100)}% de victoire estimée`,
  };
}

/**
 * Le score marque-t-il la mi-temps ? On exige l'égalité exacte : le score est
 * republié à chaque manche, et un simple « au moins 12 » rouvrirait un pari à
 * chaque manche suivante.
 */
function isHalfTime(score, { halfAt = HALF_TIME_ROUNDS } = {}) {
  const blue = roundsWon(score?.blue);
  const red = roundsWon(score?.red);
  if (blue === null || red === null) return false;
  return blue + red === halfAt;
}

/** Manches gagnées par l'équipe suivie, selon son camp. */
function ownScore(score, selfTeam) {
  const blue = roundsWon(score?.blue);
  const red = roundsWon(score?.red);
  if (blue === null || red === null) return null;
  if (selfTeam === 'ORDER') return { mine: blue, theirs: red };
  if (selfTeam === 'CHAOS') return { mine: red, theirs: blue };
  return null; // camp inconnu : on ne devine pas
}

module.exports = {
  oddsFromScore, isHalfTime, ownScore, raceProbability,
  TARGET_ROUNDS, HALF_TIME_ROUNDS,
};
