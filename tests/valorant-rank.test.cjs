const assert = require('node:assert/strict');
const {
  formatValorantTier, formatValorantRank, buildRankProgressLine,
} = require('../discord-bot/valorant-rank.js');

// ─── Libellés de tier ───────────────────────────────────────────────────────
assert.equal(formatValorantTier(22), 'Ascendant 2');
assert.equal(formatValorantTier(27), 'Radiant');
assert.equal(formatValorantTier(0), 'Non classé');
assert.equal(formatValorantTier(null), null);
assert.equal(formatValorantTier(99), null, 'un tier hors échelle ne doit rien inventer');

// ─── Tier + RR ──────────────────────────────────────────────────────────────
assert.equal(formatValorantRank(22, 33), 'Ascendant 2 33 RR');
assert.equal(formatValorantRank(22, 0), 'Ascendant 2 0 RR', '0 RR est une valeur réelle, pas une absence');
assert.equal(formatValorantRank(22, null), 'Ascendant 2', 'sans RR connu, le tier seul');
assert.equal(formatValorantRank(22, 'nan'), 'Ascendant 2', 'une valeur non numérique est ignorée');
assert.equal(formatValorantRank(25, 412), 'Immortel 2 412 RR', 'au-dessus d’Immortel le RR dépasse 100');
assert.equal(formatValorantRank(null, 33), null);

// ─── Le cas demandé : progression dans le même palier ───────────────────────
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: 22, before: 33, after: 59 }),
  '📊 Ascendant 2 33 RR → **Ascendant 2 59 RR**',
);

// ─── Montée / descente de palier ────────────────────────────────────────────
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: 23, before: 90, after: 12 }),
  '📊 Ascendant 2 90 RR → **Ascendant 3 12 RR** — Rank up ⬆️ !',
);
assert.equal(
  buildRankProgressLine({ tierBefore: 23, tier: 22, before: 8, after: 72 }),
  '📊 Ascendant 3 8 RR → **Ascendant 2 72 RR** — Rank down ⬇️ !',
);

// ─── Replis quand Riot ne donne pas tout ────────────────────────────────────
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: 22, before: null, after: null }),
  '📊 Ascendant 2',
  'sans RR ni changement de palier, pas de flèche inutile',
);
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: 23, before: null, after: null }),
  '📊 Ascendant 2 → **Ascendant 3** — Rank up ⬆️ !',
  'un changement de palier reste visible même sans RR',
);
assert.equal(
  buildRankProgressLine({ tierBefore: null, tier: 22, before: null, after: 59 }),
  '📊 Ascendant 2 59 RR',
  'première game de l’acte : pas d’avant connu',
);
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: null, before: 33, after: null }),
  '📊 Ascendant 2 33 RR',
);
assert.equal(buildRankProgressLine({ tierBefore: null, tier: null }), null);
assert.equal(buildRankProgressLine(null), null);

// ─── Régression : 0 RR ne doit jamais être confondu avec « inconnu » ────────
assert.equal(
  buildRankProgressLine({ tierBefore: 22, tier: 22, before: 0, after: 14 }),
  '📊 Ascendant 2 0 RR → **Ascendant 2 14 RR**',
);

console.log('valorant-rank: progression RR avant → après validée');
