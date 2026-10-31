import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featuredPerformance, historyAgentStats, historyDayGroups, historyMapStats, historyMemberStats, historyOverview,
  historyRosterMember, valorantTierIcon, valorantTierLabel,
} from '../js/history-overview.mjs';

const roster = [
  { name:'Liam', avatar:'https://cdn.discordapp.com/avatars/1/a.png', riot:{ name:'FakePlasticTrees', puuid:'liam' }, smurfs:[{ name:'Smurfy', puuid:'liam-smurf' }] },
  { name:'Nico', avatar:'', riot:{ name:'Drew A Picasso', puuid:'nico' } },
];
const player = (puuid, agent, kills, deaths, assists, acs, hs) => ({ puuid, agent, stats:{ kills, deaths, assists, acs, score:acs * 20, hsPercent:hs } });
const others = Array.from({ length:8 }, (_, i) => player(`o${i}`, 'Sova', 10, 15, 3, 150 + i, 20));
const at = iso => new Date(iso).getTime();
// Détail complet : chaque rapport porte les dix joueurs.
const comp = (id, ts, result, reports) => {
  const players = [...reports.flatMap(r => r.players), ...others];
  const full = reports.map(r => ({ map:'Haven', mode:'competitive', result, ts, durationMs:30 * 60_000, ...r, players }));
  return { ...full[0], historyId:id, reports:full };
};
const games = [
  comp('g1', at('2026-10-31T21:00:00'), 'win', [
    { player:'FakePlasticTrees#1706', playerPuuid:'liam', rr:{ delta:18, tier:14, after:40 }, players:[player('liam', 'Jett', 25, 10, 5, 320, 30)] },
    { player:'Drew A Picasso#XOOO', playerPuuid:'nico', rr:{ delta:20, tier:11, after:80 }, players:[player('nico', 'Omen', 12, 12, 9, 190, 22)] },
  ]),
  comp('g2', at('2026-10-31T20:00:00'), 'loss', [
    { player:'FakePlasticTrees#1706', playerPuuid:'liam', rr:{ delta:-15, tier:14, after:22 }, players:[player('liam', 'Jett', 15, 18, 4, 210, 25)] },
  ]),
  { historyId:'g3', ts:at('2026-10-30T19:00:00'), mode:'deathmatch', map:'Bind', result:'completed', durationMs:9 * 60_000,
    player:'Drew A Picasso#XOOO', playerPuuid:'nico',
    players:[player('x', 'Reyna', 40, 10, 0, 0, 30), player('nico', 'Clove', 30, 20, 2, 0, 18)] },
];

test('vue d’ensemble : victoires par partie, stats par membre suivi', () => {
  const overview = historyOverview(games);
  assert.equal(overview.games, 3);
  assert.deepEqual([overview.competitive, overview.deathmatch, overview.wins, overview.losses, overview.winrate], [2, 1, 1, 1, 50]);
  assert.equal(overview.performances, 4, 'Liam ×2, Nico en comp et en DM');
  assert.equal(overview.kills, 25 + 12 + 15 + 30);
  assert.equal(overview.kd.toFixed(2), (82 / 60).toFixed(2));
  assert.equal(overview.acs, Math.round((320 + 190 + 210) / 3), 'le DM n’a pas d’ACS');
  assert.equal(overview.hs, Math.round((30 + 22 + 25 + 18) / 4));
  assert.equal(overview.rrNet, 18 + 20 - 15);
  assert.equal(overview.mvps, 2, 'Liam premier de ses deux parties');
  assert.deepEqual(overview.recent, ['win', 'loss']);
  assert.equal(overview.maxKills, 30);
  assert.equal(overview.durationMs, 69 * 60_000);
  assert.equal(historyOverview([]).winrate, null);
  assert.equal(historyOverview([]).kd, null);
});

test('agents, maps et joueurs du groupe', () => {
  const agents = historyAgentStats(games);
  assert.equal(agents[0].label, 'Jett');
  assert.deepEqual([agents[0].games, agents[0].wins, agents[0].losses, agents[0].winrate], [2, 1, 1, 50]);
  assert.equal(agents.find(a => a.label === 'Clove').winrate, null, 'pas de victoire en DM');

  const maps = historyMapStats(games);
  assert.deepEqual(maps.map(m => [m.map, m.games, m.winrate]), [['Haven', 2, 50]], 'le DM ne compte pas');

  const members = historyMemberStats(games, roster);
  const liam = members.find(m => m.label === 'Liam');
  assert.deepEqual([liam.games, liam.winrate, liam.tier, liam.rr], [2, 50, 14, 40], 'dernier rang connu');
  assert.equal(liam.avatar, roster[0].avatar);
  assert.equal(members.find(m => m.label === 'Nico').games, 2);
  assert.equal(historyRosterMember({ player:'Smurfy#EUW', playerPuuid:'liam-smurf' }, roster).name, 'Liam', 'smurf reconnu');
});

test('ligne d’une partie : le meilleur des membres suivis est mis en avant', () => {
  assert.equal(featuredPerformance(games[0]).self.puuid, 'liam');
  assert.equal(featuredPerformance(games[2]).placement, 2);
  assert.equal(featuredPerformance({ mode:'competitive', player:'A', players:[] }), null);
});

test('parties par jour, avec le bilan de la journée', () => {
  const days = historyDayGroups(games, at('2026-10-31T23:00:00'));
  assert.deepEqual(days.map(d => [d.label, d.games.length, d.wins, d.losses, d.rrNet]), [["Aujourd'hui", 2, 1, 1, 23], ['Hier', 1, 0, 0, null]]);
});

test('rangs Valorant', () => {
  assert.match(valorantTierIcon(14), /competitivetiers\/[0-9a-f-]+\/14\/smallicon\.png$/);
  assert.equal(valorantTierIcon(0), '');
  assert.equal(valorantTierIcon('x'), '');
  assert.equal(valorantTierLabel(14), 'Or 3');
  assert.equal(valorantTierLabel(27), 'Radiant');
  assert.match(valorantTierLabel(14, 40), /^Or 3 · 40 RR$/);
  assert.equal(valorantTierLabel(null), '');
});
