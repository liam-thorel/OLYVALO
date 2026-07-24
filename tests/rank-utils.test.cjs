const assert = require('node:assert/strict');
const {
  buildRankSnapshot,
  historicalPeakTier,
  rrDelta,
} = require('../live/rank-utils.js');

const mmr = {
  QueueSkills: {
    competitive: {
      SeasonalInfoBySeasonID: {
        oldAct: {
          CompetitiveTier: 18,
          WinsByTier: { 18: 4, 19: 2, 20: 0 },
        },
        currentAct: {
          CompetitiveTier: 15,
          WinsByTier: { 15: 7 },
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
  level: 231,
});

const anonymousFallback = buildRankSnapshot(null, {
  Matches: [
    { TierAfterUpdate: 12, RankedRatingAfterUpdate: 80, RankedRatingEarned: 19 },
    { TierAfterUpdate: 14, RankedRatingAfterUpdate: 12, RankedRatingEarned: -18 },
  ],
});
assert.equal(anonymousFallback.peakTier, 14);
assert.equal(anonymousFallback.peakHistorical, false);
assert.equal(anonymousFallback.peakSource, 'recent-matches');

assert.equal(buildRankSnapshot(null, null), null);

console.log('rank-utils: historical peak and anonymous fallback validated');
