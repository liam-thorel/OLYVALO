/**
 * Moteur de cotes pour les paris.
 *
 * Limite volontaire : Riot masque l'identité (PUUID/rang) de l'équipe adverse
 * pendant toute la sélection de champion et la game — impossible de savoir
 * légitimement qui sont les 5 en face avant la fin de la partie. Les cotes ne
 * reposent donc que sur des signaux propres à l'équipe OLYCITY suivie :
 *   - rang actuel (converti en score numérique comparable entre les deux jeux)
 *   - winrate personnel récent (calculé depuis l'historique qu'on enregistre
 *     nous-mêmes au fil des games, live/history pour Valorant et
 *     live/lolHistory pour LoL — donc peu fiable au tout début, s'affine avec
 *     le temps)
 *   - winrate sur le champion/agent joué, même source
 *
 * Ce n'est pas une vraie cote de bookmaker (aucune vision de l'adversaire),
 * mais un signal raisonnable et transparent basé sur ce qu'on peut légitimement
 * observer.
 */
const { winrateFor } = require('./stats.js');

// Pas de marge de bookmaker : les cotes sont l'inverse exact de la probabilité
// estimée, pour une espérance de gain nulle en moyenne (pari « juste », ni
// favorable ni défavorable au parieur au-delà de la qualité de l'estimation).
const MIN_PROBABILITY = 0.15;
const MAX_PROBABILITY = 0.85;

const LOL_TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_DIVISION_SCORE = { IV: 0, III: 1, II: 2, I: 3 };
const LOL_BASELINE_SCORE = 3 * 400 + 2 * 100; // ~Or II, 0 LP — point de référence neutre
// Échelle numérique Riot pour le rang compétitif Valorant (0=non classé, 27=Radiant).
const VALORANT_BASELINE_TIER = 13; // ~Or, point de référence neutre
const RANK_SPREAD = 1200;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function lolRankScore(rank) {
  if (!rank?.tier) return LOL_BASELINE_SCORE;
  const tierIndex = LOL_TIER_ORDER.indexOf(rank.tier);
  if (tierIndex < 0) return LOL_BASELINE_SCORE;
  const divisionScore = LOL_DIVISION_SCORE[rank.division] ?? 0;
  return tierIndex * 400 + divisionScore * 100 + (rank.lp || 0);
}

function valorantRankScore(rank) {
  const tier = rank?.tier || VALORANT_BASELINE_TIER;
  return tier * 100;
}

function normalizedRankSignal(game, rank) {
  const score = game === 'lol' ? lolRankScore(rank) : valorantRankScore(rank);
  const baseline = game === 'lol' ? LOL_BASELINE_SCORE : VALORANT_BASELINE_TIER * 100;
  return clamp((score - baseline) / RANK_SPREAD, -1.5, 1.5);
}

/**
 * @param game 'lol' | 'valorant'
 * @param rosterPlayers [{ member: {name, riotIds}, rank, championOrAgentName }]
 * Retourne { probability, oddsWin, oddsLose, explanation }
 */
async function estimateOdds(game, rosterPlayers) {
  if (!rosterPlayers?.length) {
    return { probability: 0.5, oddsWin: 1.9, oddsLose: 1.9, explanation: 'Pas assez de données — cote neutre.' };
  }

  const signals = await Promise.all(rosterPlayers.map(async player => {
    const rankSignal = normalizedRankSignal(game, player.rank);
    const winrates = await winrateFor(game, player.member.riotIds, player.championOrAgentName);

    const winrateSignal = winrates.overall != null ? winrates.overall - 0.5 : 0;
    const championSignal = winrates.champion != null ? winrates.champion - 0.5 : 0;

    return {
      score: 0.35 * rankSignal + 1.2 * winrateSignal + 0.8 * championSignal,
      winrates,
    };
  }));

  const avgScore = signals.reduce((sum, s) => sum + s.score, 0) / signals.length;
  const probability = clamp(sigmoid(avgScore), MIN_PROBABILITY, MAX_PROBABILITY);

  const oddsWin = Math.max(1.05, Number((1 / probability).toFixed(2)));
  const oddsLose = Math.max(1.05, Number((1 / (1 - probability)).toFixed(2)));

  const totalSamples = signals.reduce((sum, s) => sum + s.winrates.sampleSize, 0);
  const explanation = totalSamples > 0
    ? `Basé sur le rang et l'historique perso (${totalSamples} game(s) connue(s)).`
    : 'Pas encore d\'historique — cote basée sur le rang uniquement.';

  return { probability, oddsWin, oddsLose, explanation };
}

module.exports = { estimateOdds };
