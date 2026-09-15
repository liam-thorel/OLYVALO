const assert = require('node:assert/strict');
const { valorantDuoStats, lolDuoStats, valorantMapStats, lolMatchIdOf } = require('../discord-bot/synergy.js');

const members = [
  { name: 'Mathis', riotIds: ['Motivex500#EUW', 'M A I R#LGND'] },
  { name: 'Rayhan', riotIds: ['RayBaz#OLY'] },
  { name: 'Nico', riotIds: ['Drew A Picasso#XOOO'] },
];

// ─── Valorant ────────────────────────────────────────────────────────────────
const joueur = (name, team, stats = {}) => ({
  name, team, puuid: name, agent: 'Omen',
  stats: { kills: 15, deaths: 10, assists: 5, acs: 200, hsPercent: 25, ...stats },
});

// Le résultat d'un rapport est celui du RAPPORTEUR. Un duo dans l'équipe
// adverse doit voir ce résultat inversé — sinon ses défaites comptent comme
// des victoires.
const rapport = (extra = {}) => ({
  matchId: 'M1', map: 'Split', mode: 'competitive', ts: 1000,
  selfTeam: 'ORDER', result: 'win',
  players: [joueur('Motivex500#EUW', 'ORDER'), joueur('RayBaz#OLY', 'ORDER')],
  ...extra,
});

let duos = valorantDuoStats({ M1: { reports: { r1: rapport() } } }, members, { minGames: 1 });
assert.deepEqual(duos, [{ duo: 'Mathis + Rayhan', games: 1, wins: 1, losses: 0, winrate: 100 }]);

// Les deux dans l'équipe ADVERSE au rapporteur : la victoire du rapporteur est
// leur défaite.
duos = valorantDuoStats({ M1: { reports: { r1: rapport({
  selfTeam: 'CHAOS', result: 'win',
  players: [joueur('Motivex500#EUW', 'ORDER'), joueur('RayBaz#OLY', 'ORDER'), joueur('Autre#EU', 'CHAOS')],
}) } } }, members, { minGames: 1 });
assert.equal(duos[0].wins, 0, 'le résultat du rapporteur doit être inversé pour l’équipe d’en face');
assert.equal(duos[0].losses, 1);

// Deux membres dans des équipes OPPOSÉES ne forment pas un duo.
duos = valorantDuoStats({ M1: { reports: { r1: rapport({
  players: [joueur('Motivex500#EUW', 'ORDER'), joueur('RayBaz#OLY', 'CHAOS')],
}) } } }, members, { minGames: 1 });
assert.deepEqual(duos, [], 'des adversaires ne sont pas des coéquipiers');

// Un stack publie un rapport PAR joueur : la partie ne doit compter qu'une fois.
duos = valorantDuoStats({ M1: { reports: { r1: rapport(), r2: rapport() } } }, members, { minGames: 1 });
assert.equal(duos[0].games, 1, 'deux rapports de la même partie = une game');

// Trois membres ensemble : trois paires.
duos = valorantDuoStats({ M1: { reports: { r1: rapport({
  players: [joueur('Motivex500#EUW', 'ORDER'), joueur('RayBaz#OLY', 'ORDER'), joueur('Drew A Picasso#XOOO', 'ORDER')],
}) } } }, members, { minGames: 1 });
assert.equal(duos.length, 3, 'un trio produit trois duos');

// Un smurf mène au même membre : il ne doit pas créer un duo avec lui-même.
duos = valorantDuoStats({ M1: { reports: { r1: rapport({
  players: [joueur('Motivex500#EUW', 'ORDER'), joueur('M A I R#LGND', 'ORDER')],
}) } } }, members, { minGames: 1 });
assert.deepEqual(duos, [], 'deux comptes du même joueur ne font pas un duo');

// Égalité, deathmatch, partie incomplète : rien à compter.
for (const result of ['draw', 'completed', 'unknown', undefined]) {
  assert.deepEqual(valorantDuoStats({ M1: { reports: { r1: rapport({ result }) } } }, members, { minGames: 1 }), [],
    `résultat ${JSON.stringify(result)} ignoré`);
}

// Le seuil protège d'un winrate qui ne veut rien dire.
const deuxGames = { A: { reports: { r: rapport({ matchId: 'A' }) } }, B: { reports: { r: rapport({ matchId: 'B' }) } } };
assert.deepEqual(valorantDuoStats(deuxGames, members), [], '2 games sous le seuil par défaut de 3');
assert.equal(valorantDuoStats(deuxGames, members, { minGames: 2 }).length, 1);

assert.deepEqual(valorantDuoStats({}, members), []);
assert.deepEqual(valorantDuoStats(null, members), []);
assert.deepEqual(valorantDuoStats({ M1: { reports: {} } }, members), []);

// Classé uniquement, comme partout ailleurs dans le projet : une synergie
// mesurée sur des unrated ne dit rien du classé.
for (const mode of ['unrated', 'swiftplay', 'deathmatch', 'ggteam', '', undefined]) {
  assert.deepEqual(
    valorantDuoStats({ M1: { reports: { r1: rapport({ mode }) } } }, members, { minGames: 1 }), [],
    `mode ${JSON.stringify(mode)} exclu des synergies`);
  assert.deepEqual(
    valorantMapStats({ M1: { reports: { r1: rapport({ mode }) } } }, ['Motivex500#EUW']), [],
    `mode ${JSON.stringify(mode)} exclu du bilan par carte`);
}

// ─── LoL ─────────────────────────────────────────────────────────────────────
// Pas de composition d'équipe dans l'historique : même résultat = coéquipiers.
const lolEntry = (playerName, win, extra = {}) => ({ playerName, win, matchId: 'EUW1_1', ts: 1000, ...extra });

let lol = lolDuoStats({
  a: lolEntry('Motivex500#EUW', true),
  b: lolEntry('RayBaz#OLY', true),
}, members, { minGames: 1 });
assert.deepEqual(lol, [{ duo: 'Mathis + Rayhan', games: 1, wins: 1, losses: 0, winrate: 100 }]);

// Résultats opposés dans la même partie : ils se sont affrontés.
lol = lolDuoStats({
  a: lolEntry('Motivex500#EUW', true),
  b: lolEntry('RayBaz#OLY', false),
}, members, { minGames: 1 });
assert.deepEqual(lol, [], 'résultats opposés = adversaires');

// Parties différentes : aucun duo, même avec le même résultat.
lol = lolDuoStats({
  a: lolEntry('Motivex500#EUW', true, { matchId: 'EUW1_1' }),
  b: lolEntry('RayBaz#OLY', true, { matchId: 'EUW1_2' }),
}, members, { minGames: 1 });
assert.deepEqual(lol, []);

// Entrées d'avant l'ajout du matchId : il ne vit que dans la clé.
assert.equal(lolMatchIdOf('EUW1_7412-Motivex500_EUW', { playerName: 'Motivex500#EUW' }), 'EUW1_7412');
assert.equal(lolMatchIdOf('EUW1_7412', { playerName: 'Motivex500#EUW' }), 'EUW1_7412', 'ancienne clé sans suffixe');
assert.equal(lolMatchIdOf('abc', {}), 'abc');

lol = lolDuoStats({
  'EUW1_9-Motivex500_EUW': { playerName: 'Motivex500#EUW', win: true },
  'EUW1_9-RayBaz_OLY': { playerName: 'RayBaz#OLY', win: true },
}, members, { minGames: 1 });
assert.equal(lol.length, 1, 'le matchId se retrouve depuis la clé');

// Une entrée sans résultat exploitable ne compte pas.
assert.deepEqual(lolDuoStats({ a: lolEntry('Motivex500#EUW', null), b: lolEntry('RayBaz#OLY', null) }, members, { minGames: 1 }), []);
assert.deepEqual(lolDuoStats({}, members), []);
assert.deepEqual(lolDuoStats(null, members), []);

// ─── Classement ──────────────────────────────────────────────────────────────
// À winrate égal, le duo le mieux établi passe devant.
const classement = lolDuoStats({
  a1: lolEntry('Motivex500#EUW', true, { matchId: '1' }), b1: lolEntry('RayBaz#OLY', true, { matchId: '1' }),
  a2: lolEntry('Motivex500#EUW', true, { matchId: '2' }), b2: lolEntry('RayBaz#OLY', true, { matchId: '2' }),
  c1: lolEntry('Drew A Picasso#XOOO', true, { matchId: '3' }), d1: lolEntry('RayBaz#OLY', true, { matchId: '3' }),
}, members, { minGames: 1 });
assert.equal(classement[0].duo, 'Mathis + Rayhan', '2 games à 100 % devant 1 game à 100 %');

// ─── Bilan par carte ─────────────────────────────────────────────────────────
const maps = valorantMapStats({
  M1: { reports: { r1: rapport({ matchId: 'M1', map: 'Split', result: 'win' }) } },
  M2: { reports: { r1: rapport({ matchId: 'M2', map: 'Split', result: 'loss' }) } },
  M3: { reports: { r1: rapport({ matchId: 'M3', map: 'Ascent', result: 'win',
    players: [joueur('Motivex500#EUW', 'ORDER', { kills: 30, deaths: 5, acs: 400 })] }) } },
}, ['Motivex500#EUW']);

const split = maps.find(m => m.map === 'Split');
assert.equal(split.games, 2);
assert.equal(split.winrate, 50);
assert.equal(split.kd, 1.5, '30 kills pour 20 morts');
const ascent = maps.find(m => m.map === 'Ascent');
assert.equal(ascent.kd, 6);
assert.equal(ascent.acs, 400);
assert.equal(maps[0].map, 'Ascent', 'trié par winrate décroissant');

// Un stack ne doit pas faire compter la partie deux fois.
const dedupe = valorantMapStats({ M1: { reports: { r1: rapport(), r2: rapport() } } }, ['Motivex500#EUW']);
assert.equal(dedupe[0].games, 1);

// Aucune partie au vainqueur connu : null plutôt que 0 %, qui laisserait
// croire à une série de défaites.
const sansResultat = valorantMapStats({ M1: { reports: { r1: rapport({ result: 'completed' }) } } }, ['Motivex500#EUW']);
assert.equal(sansResultat[0].winrate, null);
assert.equal(sansResultat[0].games, 1);

assert.deepEqual(valorantMapStats({}, ['x']), []);
assert.deepEqual(valorantMapStats(null, []), []);

console.log('synergy: duos Valorant et LoL, inversion du résultat et bilan par carte validés');
