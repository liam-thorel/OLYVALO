/**
 * Points de participation, par mode de jeu.
 *
 * Jouer une classée reste le plus rentable, mais les autres modes rapportent
 * désormais quelque chose : une soirée ARAM ou Deathmatch ne laissait aucun
 * point, alors qu'elle occupe autant de temps.
 *
 * Attention : ce barème ne commande QUE les points. Les notifications Discord,
 * les paris, le suivi de rang et les récaps restent strictement réservés aux
 * files classées — c'est l'objet des gardes dans index.js, que ce module ne
 * touche pas.
 */

const { isRankedValorantMode, isRankedLolQueue } = require('./game-modes.js');

// Classé : seul mode où le résultat compte. Ailleurs le montant est fixe —
// beaucoup de ces modes n'ont pas de vainqueur clair, et un Deathmatch gagné
// ne vaut pas une classée gagnée.
const RANKED_WIN = 150;
const RANKED_LOSS = 50;
// Une égalité n'est pas une défaite. Elle valait pourtant 50 points, parce que
// l'issue transitait par un booléen `won` — et un booléen ne sait pas dire
// « ni l'un ni l'autre ».
const RANKED_DRAW = 100;

const VALORANT_UNRATED = 75;
const LOL_NORMAL = 100;
// Tout le reste : Deathmatch, Spike Rush, Escalade, ARAM, Arena, Co-op…
const FUN = 50;

// Files LoL « non classées » au sens strict : Draft, Aveugle, Partie rapide.
// ARAM, Arena et le reste tombent dans les modes fun.
const LOL_NORMAL_QUEUES = new Set([400, 430, 490]);

const VALORANT_UNRATED_MODE = 'unrated';

function normalize(mode) {
  return String(mode || '').trim().toLowerCase();
}

/** Barème classé selon l'issue. Une issue inconnue est traitée comme une défaite. */
function rankedAmount(outcome) {
  if (outcome === 'win') return RANKED_WIN;
  if (outcome === 'draw') return RANKED_DRAW;
  return RANKED_LOSS;
}

/**
 * Montant à créditer pour une partie terminée.
 *
 * `outcome` ('win' | 'loss' | 'draw') n'est lu qu'en classé. C'était un
 * booléen `won` : une égalité tombait donc du côté « perdu » sans que rien ne
 * le signale. Retourne 0 si on ne sait pas de quelle partie il s'agit — mieux
 * vaut ne rien créditer que de distribuer des points sur un rapport incomplet.
 */
function playReward({ game, mode, queueId, outcome } = {}) {
  if (game === 'lol') {
    if (isRankedLolQueue(queueId)) return rankedAmount(outcome);
    if (queueId === null || queueId === undefined || queueId === '') return 0;
    const numeric = Number(queueId);
    if (!Number.isFinite(numeric)) return 0; // file inconnue : on s'abstient
    return LOL_NORMAL_QUEUES.has(numeric) ? LOL_NORMAL : FUN;
  }

  if (game === 'valorant') {
    if (isRankedValorantMode(mode)) return rankedAmount(outcome);
    const normalized = normalize(mode);
    if (!normalized) return 0; // mode inconnu : on s'abstient
    return normalized === VALORANT_UNRATED_MODE ? VALORANT_UNRATED : FUN;
  }

  return 0;
}

/** Le résultat compte-t-il pour ce mode ? Sert au libellé du message. */
function rewardDependsOnOutcome({ game, mode, queueId } = {}) {
  return game === 'lol' ? isRankedLolQueue(queueId) : isRankedValorantMode(mode);
}

module.exports = {
  playReward, rewardDependsOnOutcome,
  RANKED_WIN, RANKED_LOSS, RANKED_DRAW, VALORANT_UNRATED, LOL_NORMAL, FUN, LOL_NORMAL_QUEUES,
};
