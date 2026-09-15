const assert = require('node:assert/strict');
const {
  playReward, rewardDependsOnOutcome,
  RANKED_WIN, RANKED_LOSS, VALORANT_UNRATED, LOL_NORMAL, FUN,
} = require('../discord-bot/play-rewards.js');

// Une soirée ARAM ou Deathmatch ne rapportait aucun point alors qu'elle occupe
// autant de temps qu'une classée. Ce barème corrige ça — sans toucher aux
// notifications, qui restent réservées aux files classées.

// ─── Classé : le seul mode où le résultat compte ─────────────────────────────
assert.equal(playReward({ game: 'valorant', mode: 'competitive', won: true }), RANKED_WIN);
assert.equal(playReward({ game: 'valorant', mode: 'competitive', won: false }), RANKED_LOSS);
assert.equal(playReward({ game: 'lol', queueId: 420, won: true }), RANKED_WIN);
assert.equal(playReward({ game: 'lol', queueId: 440, won: false }), RANKED_LOSS);
assert.equal(playReward({ game: 'valorant', mode: 'Competitive', won: true }), RANKED_WIN,
  'la casse renvoyée par Riot ne doit pas faire perdre la récompense classée');

assert.equal(rewardDependsOnOutcome({ game: 'valorant', mode: 'competitive' }), true);
assert.equal(rewardDependsOnOutcome({ game: 'lol', queueId: 420 }), true);

// ─── Valorant hors classé ────────────────────────────────────────────────────
assert.equal(playReward({ game: 'valorant', mode: 'unrated' }), VALORANT_UNRATED);
for (const mode of ['deathmatch', 'swiftplay', 'spikerush', 'hurm', 'ggteam', 'onefa', 'snowball']) {
  assert.equal(playReward({ game: 'valorant', mode }), FUN, `${mode} doit rapporter ${FUN}`);
}

// Le montant est fixe hors classé : un Deathmatch gagné ne vaut pas une
// classée gagnée, et beaucoup de ces modes n'ont pas de vainqueur clair.
assert.equal(playReward({ game: 'valorant', mode: 'deathmatch', won: true }),
  playReward({ game: 'valorant', mode: 'deathmatch', won: false }),
  'le résultat ne change rien hors classé');
assert.equal(rewardDependsOnOutcome({ game: 'valorant', mode: 'deathmatch' }), false);

// ─── LoL hors classé ─────────────────────────────────────────────────────────
// Files non classées au sens strict : Draft, Aveugle, Partie rapide.
for (const queueId of [400, 430, 490]) {
  assert.equal(playReward({ game: 'lol', queueId }), LOL_NORMAL, `file ${queueId}`);
}
// ARAM, Arena et tout le reste.
for (const queueId of [450, 1700, 1710, 830, 840, 850, 900, 1300]) {
  assert.equal(playReward({ game: 'lol', queueId }), FUN, `file ${queueId}`);
}
assert.equal(playReward({ game: 'lol', queueId: 450, won: true }),
  playReward({ game: 'lol', queueId: 450, won: false }));
assert.equal(rewardDependsOnOutcome({ game: 'lol', queueId: 450 }), false);

// Une file au format texte doit être comprise : Firebase peut renvoyer une
// chaîne là où le script a écrit un nombre.
assert.equal(playReward({ game: 'lol', queueId: '450' }), FUN);
assert.equal(playReward({ game: 'lol', queueId: '420', won: true }), RANKED_WIN);

// ─── On s'abstient plutôt que de distribuer au hasard ────────────────────────
// Un rapport incomplet ne doit pas créditer : mieux vaut zéro qu'un montant
// inventé sur une partie dont on ignore la nature.
assert.equal(playReward({ game: 'lol' }), 0, 'file LoL inconnue');
assert.equal(playReward({ game: 'lol', queueId: null }), 0);
assert.equal(playReward({ game: 'lol', queueId: 'inconnue' }), 0);
assert.equal(playReward({ game: 'valorant' }), 0, 'mode Valorant inconnu');
assert.equal(playReward({ game: 'valorant', mode: '' }), 0);
assert.equal(playReward({ game: 'valorant', mode: null }), 0);
assert.equal(playReward({ game: 'tft', mode: 'whatever' }), 0, 'jeu non suivi');
assert.equal(playReward({}), 0);
assert.equal(playReward(), 0);

// ─── Hiérarchie des montants ─────────────────────────────────────────────────
// C'est l'intention du barème : jouer classé reste le plus rentable.
assert.ok(RANKED_WIN > LOL_NORMAL, 'une classée gagnée vaut plus qu’une normale LoL');
assert.ok(LOL_NORMAL > VALORANT_UNRATED, 'la non classée LoL vaut plus que l’unrated Valorant');
assert.ok(VALORANT_UNRATED > FUN, 'l’unrated vaut plus qu’un mode fun');
assert.equal(RANKED_LOSS, FUN, 'une classée perdue vaut autant qu’un mode fun');

console.log('play-rewards: barème par mode validé, classé toujours le plus rentable');
