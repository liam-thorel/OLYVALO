import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { valorantDuos, lolDuos, MIN_DUO_GAMES } from '../js/synergy-utils.mjs';

const require = createRequire(import.meta.url);
const bot = require('../discord-bot/synergy.js');

/**
 * Le site et Discord doivent classer les duos de la MÊME façon.
 *
 * La logique est écrite deux fois — le bot est en CommonJS, le site en ESM
 * sans étape de build, et aucun des deux ne peut importer l'autre. Une
 * divergence sur « qui joue bien avec qui » ne se remarquerait pas : elle se
 * discuterait, et personne n'irait vérifier lequel des deux a raison.
 *
 * Les jeux d'essai n'utilisent que des Riot ID, sans PUUID : le site sait en
 * plus rapprocher par PUUID, ce que le bot ne fait pas encore, et cette
 * capacité-là ne peut pas être comparée.
 */
const MEMBRES = [
  { name: 'Nico', riotIds: ['Drew A Picasso#XOOO', 'OG ANUNOBY#OLY'], puuids: [] },
  { name: 'Liam', riotIds: ['Wong Chi Ming#2046'], puuids: [] },
  { name: 'Rayhan', riotIds: ['RayBaz#OLY'], puuids: [] },
];

const joueur = (name, team) => ({ name, team, puuid: '' });
const partie = (id, resultat, joueurs, ts = 1000) => ([id, {
  reports: { r1: { mode: 'competitive', result: resultat, selfTeam: 'Blue', ts, players: joueurs } },
}]);

// Duos alliés, duos adverses, résultats mêlés : de quoi faire diverger deux
// implémentations qui ne s'accorderaient pas sur l'inversion du résultat.
const HISTORIQUE_VALO = Object.fromEntries([
  partie('m1', 'win', [joueur('Drew A Picasso#XOOO', 'Blue'), joueur('Wong Chi Ming#2046', 'Blue'), joueur('RayBaz#OLY', 'Red')]),
  partie('m2', 'win', [joueur('Drew A Picasso#XOOO', 'Blue'), joueur('Wong Chi Ming#2046', 'Blue')]),
  partie('m3', 'loss', [joueur('Drew A Picasso#XOOO', 'Blue'), joueur('Wong Chi Ming#2046', 'Blue')]),
  partie('m4', 'loss', [joueur('OG ANUNOBY#OLY', 'Red'), joueur('RayBaz#OLY', 'Red')]),
  partie('m5', 'win', [joueur('OG ANUNOBY#OLY', 'Red'), joueur('RayBaz#OLY', 'Red')]),
  partie('m6', 'win', [joueur('OG ANUNOBY#OLY', 'Red'), joueur('RayBaz#OLY', 'Red')]),
  // Inconnus, égalité, sans équipe : autant d'occasions de compter à tort.
  partie('m7', 'draw', [joueur('Drew A Picasso#XOOO', 'Blue'), joueur('Wong Chi Ming#2046', 'Blue')]),
  partie('m8', 'win', [joueur('Inconnu#0000', 'Blue'), joueur('Wong Chi Ming#2046', 'Blue')]),
  partie('m9', 'win', [joueur('Drew A Picasso#XOOO', 'NEUTRAL'), joueur('Wong Chi Ming#2046', 'NEUTRAL')]),
]);

const duosSite = valorantDuos(HISTORIQUE_VALO, MEMBRES);
const duosBot = bot.valorantDuoStats(HISTORIQUE_VALO, MEMBRES);
assert.ok(duosSite.length > 0, 'le jeu d’essai doit produire un classement, sinon il ne compare rien');
assert.deepEqual(
  duosSite.map(({ duo, games, wins, losses, winrate }) => ({ duo, games, wins, losses, winrate })),
  duosBot,
  'Valorant : le site et Discord doivent produire le MÊME classement',
);

// Le duo adverse du rapporteur : c'est là qu'une implémentation qui oublie
// d'inverser le résultat se trahit.
const adverse = duosSite.find(entry => entry.duo === 'Nico + Rayhan');
assert.ok(adverse, 'un duo dans l’équipe adverse compte aussi');
assert.equal(adverse.wins, 1, 'leurs deux « win » du rapporteur sont leurs défaites, et inversement');
assert.equal(adverse.losses, 2);

// ─── LoL ─────────────────────────────────────────────────────────────────────
const lol = (matchId, name, win, ts = 1000) => ([`${matchId}-${name.replace(/[.#]/g, '_')}`,
  { matchId, playerName: name, win, ts }]);
const HISTORIQUE_LOL = Object.fromEntries([
  ...lol('g1', 'Drew A Picasso#XOOO', true), ...[lol('g1', 'Wong Chi Ming#2046', true)],
  lol('g2', 'Drew A Picasso#XOOO', true), lol('g2', 'Wong Chi Ming#2046', true),
  lol('g3', 'Drew A Picasso#XOOO', false), lol('g3', 'Wong Chi Ming#2046', false),
  lol('g5', 'Drew A Picasso#XOOO', true), lol('g5', 'Wong Chi Ming#2046', true),
  // Résultats opposés : ils se sont affrontés, ce n'est pas un duo. Il en faut
  // AU MOINS trois, sinon le seuil les écarterait de toute façon et la règle
  // ne serait pas réellement éprouvée.
  lol('g6', 'Drew A Picasso#XOOO', true), lol('g6', 'RayBaz#OLY', false),
  lol('g7', 'Drew A Picasso#XOOO', false), lol('g7', 'RayBaz#OLY', true),
  lol('g8', 'Drew A Picasso#XOOO', true), lol('g8', 'RayBaz#OLY', false),
  lol('g9', 'Drew A Picasso#XOOO', true), lol('g9', 'RayBaz#OLY', false),
].filter(entry => Array.isArray(entry) && typeof entry[0] === 'string'));

const lolSite = lolDuos(HISTORIQUE_LOL, MEMBRES);
assert.deepEqual(
  lolSite.map(({ duo, games, wins, losses, winrate }) => ({ duo, games, wins, losses, winrate })),
  bot.lolDuoStats(HISTORIQUE_LOL, MEMBRES),
  'LoL : même classement des deux côtés',
);
assert.ok(!lolSite.some(entry => entry.duo.includes('Rayhan')),
  'des résultats opposés sur la même partie ne font pas un duo');

// Le seuil doit rester le même : un classement où un duo apparaît d'un côté et
// pas de l'autre est pire qu'une divergence de chiffres.
assert.equal(MIN_DUO_GAMES, bot.MIN_DUO_GAMES);

console.log('synergy-parity: le site et Discord classent les duos à l’identique');
