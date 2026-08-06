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

function buildRankSnapshot(mmr, updates, level = null) {
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
    ...(level == null ? {} : { level: Number(level) || 0 }),
  };
}

module.exports = { buildRankSnapshot, historicalPeakTier, rrDelta, tierNumber };
