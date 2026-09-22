import assert from 'node:assert/strict';
import { valorantDuos, lolDuos, duoRanking, memberIndex, MIN_DUO_GAMES } from '../js/synergy-utils.mjs';

const MEMBRES = [
  { name: 'Nico', riotIds: ['Drew A Picasso#XOOO'], puuids: ['puuid-nico'] },
  { name: 'Liam', riotIds: ['Wong Chi Ming#2046'], puuids: ['puuid-liam'] },
];

// ─── Identification : PUUID d'abord, nom en repli ────────────────────────────
const index = memberIndex(MEMBRES);
assert.equal(index.byPuuid.get('puuid-liam'), 'Liam');
assert.equal(index.byRiotId.get('wong chi ming#2046'), 'Liam');

// Un compte RENOMMÉ garde son PUUID. Sans ce rapprochement, toutes ses parties
// disparaîtraient du classement le jour où il change de pseudo.
const apresRenommage = {
  m1: { reports: { r: { mode: 'competitive', result: 'win', selfTeam: 'Blue', ts: 10, players: [
    { name: 'Drew A Picasso#XOOO', team: 'Blue', puuid: 'puuid-nico' },
    { name: 'FakePlasticTrees#1706', team: 'Blue', puuid: 'puuid-liam' },
  ] } } },
};
const parPuuid = valorantDuos(apresRenommage, MEMBRES, { minGames: 1 });
assert.deepEqual(parPuuid.map(e => e.duo), ['Liam + Nico'],
  'le pseudo a changé, le PUUID non : la partie compte toujours');

// Les entrées d'avant la publication du PUUID n'en ont pas : le nom les sauve.
const sansPuuid = {
  m1: { reports: { r: { mode: 'competitive', result: 'win', selfTeam: 'Blue', ts: 10, players: [
    { name: 'Drew A Picasso#XOOO', team: 'Blue' }, { name: 'Wong Chi Ming#2046', team: 'Blue' },
  ] } } },
};
assert.deepEqual(valorantDuos(sansPuuid, MEMBRES, { minGames: 1 }).map(e => e.duo), ['Liam + Nico']);

// ─── Le seuil protège d'un winrate qui ne veut rien dire ─────────────────────
assert.equal(MIN_DUO_GAMES, 3);
assert.deepEqual(valorantDuos(sansPuuid, MEMBRES), [], 'une seule partie ne classe personne');

// ─── La plage de temps ───────────────────────────────────────────────────────
// L'écran des courbes a un sélecteur de plage : le classement doit le suivre,
// sinon « qui joue bien avec qui » resterait figé sur tout l'historique alors
// que la courbe au-dessus montre les sept derniers jours.
const partie = (id, ts) => [id, { reports: { r: { mode: 'competitive', result: 'win', selfTeam: 'Blue', ts, players: [
  { name: 'Drew A Picasso#XOOO', team: 'Blue' }, { name: 'Wong Chi Ming#2046', team: 'Blue' },
] } } }];
const etale = Object.fromEntries([partie('a', 100), partie('b', 200), partie('c', 5000), partie('d', 6000), partie('e', 7000)]);
assert.equal(valorantDuos(etale, MEMBRES, { minGames: 1 })[0].games, 5, 'sans plage, tout compte');
assert.equal(valorantDuos(etale, MEMBRES, { minGames: 1, since: 1000 })[0].games, 3, 'la plage restreint');
assert.deepEqual(valorantDuos(etale, MEMBRES, { minGames: 1, since: 99999 }), [], 'une plage vide ne classe rien');

// ─── Tri : winrate, puis nombre de parties ───────────────────────────────────
// À winrate égal, le duo le mieux établi passe devant — 3 victoires sur 3 et
// 10 sur 10 ne valent pas la même chose.
const trois = [
  { name: 'A', riotIds: ['a#1'], puuids: [] }, { name: 'B', riotIds: ['b#1'], puuids: [] },
  { name: 'C', riotIds: ['c#1'], puuids: [] },
];
const duel = (id, gagnants, resultat) => [id, { reports: { r: { mode: 'competitive', result: resultat, selfTeam: 'Blue', ts: 1, players:
  gagnants.map(n => ({ name: n, team: 'Blue' })) } } }];
const egalite = Object.fromEntries([
  ...[1, 2, 3].map(i => duel(`ab${i}`, ['a#1', 'b#1'], 'win')),
  ...[1, 2, 3, 4, 5].map(i => duel(`ac${i}`, ['a#1', 'c#1'], 'win')),
]);
const classement = valorantDuos(egalite, trois);
assert.deepEqual(classement.map(e => e.duo), ['A + C', 'A + B'], 'même winrate : le plus établi devant');
assert.equal(classement[0].winrate, 100);
assert.deepEqual(classement[0].members, ['A', 'C'], 'les membres sont exposés séparément, pour l’affichage');

// ─── Ce qui ne doit pas compter ──────────────────────────────────────────────
const bruit = {
  unrated: { reports: { r: { mode: 'unrated', result: 'win', selfTeam: 'Blue', ts: 1, players: [
    { name: 'Drew A Picasso#XOOO', team: 'Blue' }, { name: 'Wong Chi Ming#2046', team: 'Blue' } ] } } },
  sansRapport: { reports: {} },
  vide: {},
};
assert.deepEqual(valorantDuos(bruit, MEMBRES, { minGames: 1 }), [], 'non classé, rapport absent : rien');
assert.deepEqual(valorantDuos(null, MEMBRES), []);
assert.deepEqual(valorantDuos({}, []), []);

// ─── Aiguillage par jeu ──────────────────────────────────────────────────────
assert.deepEqual(duoRanking('valorant', sansPuuid, MEMBRES, { minGames: 1 }).map(e => e.duo), ['Liam + Nico']);
const lolHist = {
  'g1-a': { matchId: 'g1', playerName: 'Drew A Picasso#XOOO', win: true, ts: 1 },
  'g1-b': { matchId: 'g1', playerName: 'Wong Chi Ming#2046', win: true, ts: 1 },
};
assert.deepEqual(duoRanking('lol', lolHist, MEMBRES, { minGames: 1 }).map(e => e.duo), ['Liam + Nico']);

// Deux entrées pour le même joueur (rejeu, correction) ne forment pas un duo
// avec lui-même.
const doublon = {
  'g1-a': { matchId: 'g1', playerName: 'Drew A Picasso#XOOO', win: true, ts: 1 },
  'g1-a-bis': { matchId: 'g1', playerName: 'Drew A Picasso#XOOO', win: true, ts: 1 },
};
assert.deepEqual(lolDuos(doublon, MEMBRES, { minGames: 1 }), []);

console.log('synergy-utils: duos identifiés par PUUID, bornés à la plage, triés par winrate');
