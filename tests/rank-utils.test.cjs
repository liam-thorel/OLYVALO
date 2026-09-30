const assert = require('node:assert/strict');
const {
  buildRankSnapshot,
  historicalPeakTier,
  currentSeasonStats,
  seasonIdOf,
  rrDelta,
} = require('../live/rank-utils.js');

// currentAct est placé EN PREMIER dans le dict, oldAct après — exprès, pour
// prouver que currentSeasonStats() n'a plus besoin de supposer un ordre
// chronologique des clés (une première version faisait cette hypothèse,
// jamais vérifiable sans données réelles à l'époque, et donnait de mauvais
// chiffres pour certains comptes en prod).
const mmr = {
  QueueSkills: {
    competitive: {
      SeasonalInfoBySeasonID: {
        currentAct: {
          CompetitiveTier: 15,
          WinsByTier: { 15: 7 },
          NumberOfGames: 30,
          NumberOfWins: 18,
        },
        oldAct: {
          CompetitiveTier: 18,
          WinsByTier: { 18: 4, 19: 2, 20: 0 },
          NumberOfGames: 40,
          NumberOfWins: 22,
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
      SeasonID: 'currentAct',
      TierAfterUpdate: 15,
      RankedRatingAfterUpdate: 42,
      RankedRatingBeforeUpdate: 25,
      RankedRatingEarned: 17,
    },
    {
      SeasonID: 'currentAct',
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

// Le SeasonID du dernier match identifie l'acte en cours (currentAct, 30
// games) — malgré son ordre dans le dict, jamais oldAct (40 games).
assert.deepEqual(currentSeasonStats(mmr, updates), { games: 30, wins: 18, winRatePct: 60 });

// Sans SeasonID exploitable, on ne renvoie RIEN.
//
// Le repli précédent prenait le dernier acte du dictionnaire — dont les clés
// sont des UUID sans ordre garanti. L'écran affichait donc les parties et le
// winrate d'un acte pris au hasard, sous le libellé « Acte compétitif en
// cours » : un chiffre faux présenté comme juste, que personne ne va vérifier.
// Ne rien afficher est la seule réponse honnête.
assert.equal(currentSeasonStats(mmr), null, 'sans updates, l’acte est indéterminable');
assert.equal(currentSeasonStats(mmr, { Matches: [{ TierAfterUpdate: 15 }] }), null, 'une partie sans SeasonID non plus');
assert.equal(currentSeasonStats(mmr, { Matches: [{ SeasonID: 'unknown-act' }] }), null,
  'un acte absent du dictionnaire : ce joueur n’y a pas joué en classé');

// L'acte de RÉFÉRENCE prime sur le dernier acte du joueur : c'est celui du
// joueur local, qui est en train d'y jouer.
assert.deepEqual(currentSeasonStats(mmr, { Matches: [{ SeasonID: 'oldAct' }] }, 'currentAct'),
  { games: 30, wins: 18, winRatePct: 60 }, 'la référence décide, pas l’historique du joueur');

// Et un joueur qui n'a PAS joué en classé cet acte-ci n'affiche rien, au lieu
// des chiffres de l'acte précédent présentés comme actuels.
const inactif = { QueueSkills: { competitive: { SeasonalInfoBySeasonID: {
  oldAct: { NumberOfGames: 40, NumberOfWins: 22 },
} } } };
assert.equal(currentSeasonStats(inactif, { Matches: [{ SeasonID: 'oldAct' }] }, 'currentAct'), null);

// seasonIdOf : l'acte de la classée la plus récente, ou rien.
assert.equal(seasonIdOf({ Matches: [{ SeasonID: 'a' }, { SeasonID: 'b' }] }), 'a');
assert.equal(seasonIdOf({ Matches: [] }), null);
assert.equal(seasonIdOf(null), null);
assert.equal(seasonIdOf({ Matches: [{ TierAfterUpdate: 3 }] }), null);

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

console.log('rank-utils: historical peak, season stats (by SeasonID) and anonymous fallback validated');

// ─── Le script fournit bien l'acte de référence ─────────────────────────────
// La correction ne vaut que si index.js transmet l'acte : sans lui, chaque
// joueur reste jugé sur SON dernier acte classé.
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'live', 'index.js'), 'utf8');

assert.match(script, /buildRankSnapshot\(mmr, updates, xp\?\.Progress\?\.Level, acteEnCours\)/,
  'l’acte en cours est transmis à chaque instantané');
// Le joueur local d'abord : c'est lui qui donne l'acte, puisqu'il y joue.
assert.match(script, /const ordonnes = \[\.\.\.puuidsCopy\]\.sort\(/);
assert.match(script, /for \(const puuid of ordonnes\)/, 'la boucle suit cet ordre, sinon le tri ne sert à rien');
// Seule une partie CLASSÉE prouve l'acte : en Deathmatch, la dernière classée
// du joueur local peut dater d'un acte passé.
assert.match(script, /String\(stableMode \|\| ''\)\.toLowerCase\(\) === 'competitive'/);
assert.match(script, /acteEnCours = seasonIdOf\(updates\)/);

console.log('rank-utils: l’acte en cours vient du joueur local, jamais d’un acte tiré au hasard');
