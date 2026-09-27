/**
 * Parties annulées : dodge en sélection d'agents, remake au premier round.
 *
 * Le script local les marque explicitement (`result.cancelled`) parce que lui
 * seul peut faire la différence entre « cette partie n'a pas eu lieu » et
 * « le rapport de fin de partie n'est jamais arrivé ». Les deux ressemblent à
 * une fin de session sans résultat, mais la première doit être ANNONCÉE — un
 * joueur qui perd du RR sur un dodge ne comprend pas le silence du bot — et
 * la seconde non.
 *
 * Ce qu'une partie annulée ne doit surtout pas produire : une carte de
 * victoire/défaite, des points de participation, un award, et une ligne de RR
 * dans le récap. Riot a bien pris le RR, mais le compter dans le bilan du jour
 * revient à imputer au joueur une défaite qu'il n'a pas jouée.
 */

const { normalizeMode } = require('./game-modes.js');

const CANCELLED_RESULTS = new Set(['remake', 'cancelled', 'dodge']);

/** Cette session porte-t-elle le marqueur de partie annulée ? */
function cancelledSession(session) {
  const result = session?.result;
  if (!result) return null;
  const explicit = result.cancelled === true || CANCELLED_RESULTS.has(normalizeMode(result.result));
  if (!explicit) return null;
  return {
    kind: normalizeMode(result.kind) === 'dodge' ? 'dodge' : 'remake',
    rr: result.rr || null,
    map: result.map || session.map || '',
    mode: normalizeMode(result.mode) || normalizeMode(session.mode),
  };
}

/**
 * Une seule session marquée suffit : sur un stack, le joueur qui dodge est le
 * seul à recevoir la pénalité, mais la partie est annulée pour tout le monde.
 * On retient en priorité la session qui connaît le RR perdu, c'est elle qui a
 * quelque chose à raconter.
 */
function cancelledGame(sessions) {
  const marked = (sessions || []).map(cancelledSession).filter(Boolean);
  if (marked.length === 0) return null;
  // Un delta NON NUL : les coéquipiers du fautif ont bien une entrée de RR,
  // à zéro. La retenir ferait annoncer « 0 RR » alors qu'un joueur du stack a
  // bien été pénalisé.
  return marked.find(entry => Number(entry.rr?.delta)) || marked[0];
}

const TITLES = {
  dodge: '🚫 Partie annulée — dodge en sélection d\'agents',
  remake: '🚫 Partie annulée — remake',
};

const EXPLANATIONS = {
  dodge: 'Personne n\'a joué : la partie ne s\'est jamais lancée.',
  remake: 'Un joueur ne s\'est pas connecté : la partie a été remake au premier round.',
};

function cancelledTitle(kind) {
  return TITLES[kind] || TITLES.remake;
}

function cancelledExplanation(kind) {
  return EXPLANATIONS[kind] || EXPLANATIONS.remake;
}

/**
 * La pénalité de RR, dite mais pas comptée.
 *
 * Riot inscrit le dodge dans competitiveupdates comme n'importe quelle partie
 * classée : c'est de là que vient le delta. Un delta nul (le cas de ceux qui
 * n'ont pas dodgé) n'a rien à annoncer.
 */
function rrPenaltyLine(rr) {
  const delta = Number(rr?.delta);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return `📉 ${signed} RR de pénalité — non comptés dans le récap`;
}

module.exports = { cancelledGame, cancelledSession, cancelledTitle, cancelledExplanation, rrPenaltyLine };
