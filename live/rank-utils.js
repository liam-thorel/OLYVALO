'use strict';

function tierNumber(value) {
  const tier = Number.parseInt(value, 10);
  return Number.isFinite(tier) && tier > 0 ? tier : 0;
}

function rrDelta(match) {
  if (!match) return null;
  if (match.RankedRatingEarned !== undefined && match.RankedRatingEarned !== null) {
    const earned = Number(match.RankedRatingEarned);
    if (Number.isFinite(earned)) return earned;
  }

  const after = Number(match.RankedRatingAfterUpdate);
  const before = Number(match.RankedRatingBeforeUpdate);
  return Number.isFinite(after) && Number.isFinite(before) ? after - before : null;
}

function historicalPeakTier(mmr) {
  const seasons = mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID;
  if (!seasons || typeof seasons !== 'object') return 0;

  let peak = 0;
  for (const season of Object.values(seasons)) {
    peak = Math.max(peak, tierNumber(season?.CompetitiveTier));

    // WinsByTier proves that the player played and won at this tier during
    // the act, even when the act's final CompetitiveTier is lower.
    for (const [tier, wins] of Object.entries(season?.WinsByTier || {})) {
      if (Number(wins) > 0) peak = Math.max(peak, tierNumber(tier));
    }
  }
  return peak;
}

// Winrate/games de l'acte compétitif en cours. Riot n'indique nulle part sur
// SeasonalInfoBySeasonID lui-même quel acte est "en cours" — mais chaque
// match de `updates.Matches` (l'historique récent, déjà récupéré) porte un
// SeasonID : celui du match le plus récent identifie l'acte en cours de
// façon certaine, sans supposer un ordre particulier des clés du dict (une
// première version faisait cette hypothèse — jamais vérifiable sans données
// réelles à l'époque — et donnait de mauvais chiffres pour certains comptes).
/** Acte de la partie classée la plus récente d'un joueur, s'il y en a une. */
function seasonIdOf(updates) {
  const matches = Array.isArray(updates?.Matches) ? updates.Matches : [];
  return matches[0]?.SeasonID || null;
}

/**
 * Statistiques de l'acte EN COURS — et d'aucun autre.
 *
 * Une version précédente retombait sur `entries[entries.length - 1]` quand
 * l'acte ne pouvait pas être identifié : le dernier du dictionnaire, dont les
 * clés sont des UUID sans ordre garanti. L'écran affichait donc les parties et
 * le winrate d'un acte pris au hasard, sous le libellé « Acte compétitif en
 * cours ». Un chiffre faux présenté comme juste : personne ne va le vérifier.
 *
 * `referenceSeasonId` est l'acte réellement en cours, connu du joueur local qui
 * est en train d'y jouer. Sans lui on se rabat sur le dernier acte classé du
 * joueur examiné — correct pour quelqu'un qui joue, approximatif sinon.
 *
 * Aucune entrée pour cet acte signifie « pas de classée cet acte-ci » : on ne
 * renvoie RIEN, plutôt que les chiffres d'un acte précédent.
 */
function currentSeasonStats(mmr, updates, referenceSeasonId = null) {
  const seasons = mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID;
  if (!seasons || typeof seasons !== 'object') return null;
  if (!Object.keys(seasons).length) return null;

  const seasonId = referenceSeasonId || seasonIdOf(updates);
  if (!seasonId) return null;
  const current = seasons[seasonId];
  if (!current) return null;

  const games = Number(current?.NumberOfGames);
  const wins = Number(current?.NumberOfWins);
  if (!Number.isFinite(games) || games <= 0) return null;

  return {
    games,
    wins: Number.isFinite(wins) ? wins : null,
    winRatePct: Number.isFinite(wins) ? Math.round((wins / games) * 100) : null,
  };
}

function buildRankSnapshot(mmr, updates, level = null, referenceSeasonId = null) {
  const matches = Array.isArray(updates?.Matches) ? updates.Matches : [];
  const latest = matches[0] || mmr?.LatestCompetitiveUpdate || null;
  const currentTier = tierNumber(latest?.TierAfterUpdate);
  const recentPeak = matches.reduce(
    (peak, match) => Math.max(peak, tierNumber(match?.TierAfterUpdate)),
    currentTier,
  );
  const historyPeak = historicalPeakTier(mmr);
  const peakTier = Math.max(historyPeak, recentPeak, currentTier);
  const historyAvailable = historyPeak > 0;

  if (!latest && !peakTier && level == null) return null;

  const rrHistory = matches
    .slice(0, 5)
    .map(rrDelta)
    .filter(value => value !== null && value !== 0);

  return {
    tier: currentTier,
    rr: Number(latest?.RankedRatingAfterUpdate) || 0,
    rrEarned: rrDelta(latest),
    rrHistory,
    peakTier,
    peakHistorical: historyAvailable,
    peakSource: historyAvailable ? 'season-history' : (recentPeak > 0 ? 'recent-matches' : 'unavailable'),
    season: currentSeasonStats(mmr, updates, referenceSeasonId),
    ...(level == null ? {} : { level: Number(level) || 0 }),
  };
}

module.exports = { buildRankSnapshot, historicalPeakTier, currentSeasonStats,
  seasonIdOf, rrDelta, tierNumber };
