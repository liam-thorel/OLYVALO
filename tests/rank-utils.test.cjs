const assert = require('node:assert/strict');
const {
  buildRankSnapshot,
  historicalPeakTier,
  currentSeasonStats,
  rrDelta,
} = require('../live/rank-utils.js');

const mmr = {
  QueueSkills: {
    competitive: {
      SeasonalInfoBySeasonID: {
        oldAct: {
          CompetitiveTier: 18,
          WinsByTier: { 18: 4, 19: 2, 20: 0 },
          NumberOfGames: 40,
          NumberOfWins: 22,
        },
        currentAct: {
          CompetitiveTier: 15,
          WinsByTier: { 15: 7 },
          NumberOfGames: 30,
          NumberOfWins: 18,
        },
      },
    },
  },
  LatestCompetitiveUpdate: {
    TierAfterUpdate: 15,
    RankedRatingAfterUpdate: 42,
    RankedRatingBeforeUpdate: 25,
  },
};

const updates = {
  Matches: [
    {
      TierAfterUpdate: 15,
      RankedRatingAfterUpdate: 42,
      RankedRatingBeforeUpdate: 25,
      RankedRatingEarned: 17,
    },
    {
      TierAfterUpdate: 14,
      RankedRatingAfterUpdate: 25,
      RankedRatingBeforeUpdate: 41,
    },
  ],
};

assert.equal(historicalPeakTier(mmr), 19);
assert.equal(rrDelta(updates.Matches[0]), 17);
assert.equal(rrDelta(updates.Matches[1]), -16);
assert.equal(rrDelta({
  RankedRatingEarned: null,
  RankedRatingAfterUpdate: 31,
  RankedRatingBeforeUpdate: 44,
}), -13);
assert.deepEqual(buildRankSnapshot(mmr, updates, 231), {
  tier: 15,
  rr: 42,
  rrEarned: 17,
  rrHistory: [17, -16],
  peakTier: 19,
  peakHistorical: true,
  peakSource: 'season-history',
  season: { games: 30, wins: 18, winRatePct: 60 },
  level: 231,
});

// currentSeasonStats prend le DERNIER acte du dict (le plus récent) — ici
// currentAct (30 games, 18 wins), pas oldAct malgré son nom trompeur.
assert.deepEqual(currentSeasonStats(mmr), { games: 30, wins: 18, winRatePct: 60 });
assert.equal(currentSeasonStats(null), null);
assert.equal(currentSeasonStats({ QueueSkills: { competitive: { SeasonalInfoBySeasonID: {} } } }), null);
assert.equal(currentSeasonStats({
  QueueSkills: { competitive: { SeasonalInfoBySeasonID: { act: { CompetitiveTier: 10 } } } },
}), null); // pas de NumberOfGames dans cet acte → pas de stats exploitables

const anonymousFallback = buildRankSnapshot(null, {
  Matches: [
    { TierAfterUpdate: 12, RankedRatingAfterUpdate: 80, RankedRatingEarned: 19 },
    { TierAfterUpdate: 14, RankedRatingAfterUpdate: 12, RankedRatingEarned: -18 },
  ],
});
assert.equal(anonymousFallback.peakTier, 14);
assert.equal(anonymousFallback.peakHistorical, false);
assert.equal(anonymousFallback.peakSource, 'recent-matches');
assert.equal(anonymousFallback.season, null);

assert.equal(buildRankSnapshot(null, null), null);

console.log('rank-utils: historical peak, season stats and anonymous fallback validated');
