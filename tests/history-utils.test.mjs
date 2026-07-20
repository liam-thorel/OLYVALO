import assert from 'node:assert/strict';
import { filterHistoryGames, historyDailyPerformances, historyMode, historyOwnerKey, historyOwnerLabel, historyPlayerName, historyPlayerPerformance, historyRankedPlayers, isOpaquePlayerName } from '../js/history-utils.mjs';

assert.equal(historyMode({ mode: 'competitive' }), 'competitive');
assert.equal(historyMode({ mode: 'deathmatch' }), 'deathmatch');
assert.equal(historyMode({ mode: 'swiftplay' }), 'other');

assert.equal(isOpaquePlayerName('b2f303f9'), true);
assert.equal(isOpaquePlayerName('Nico#XOOO'), false);
assert.equal(historyPlayerName({}, { name: 'b2f303f9' }, 2), 'Joueur 3');
assert.equal(historyPlayerName({ player: 'Nico#XOOO' }, { name: 'Nico#XOOO' }), 'Nico');
assert.equal(historyPlayerName(
  { player: 'b2f303f9', playerPuuid: 'self-id' },
  { name: 'b2f303f9', puuid: 'self-id' },
), 'Vous');

const now = new Date('2026-07-20T12:00:00').getTime();
const history = [
  { player:'Drew A Picasso#XOOO', mode:'deathmatch', ts:now - 3600000 },
  { player:'Wong Chi Ming#2046', mode:'competitive', ts:now - 2 * 86400000 },
  { player:'Wong Chi Ming#2046', mode:'competitive', ts:now - 10 * 86400000 },
];
const roster = [{ name:'Nico', riot:{name:'Drew A Picasso'} }, { name:'Liam', riot:{name:'Wong Chi Ming'} }];
assert.equal(historyOwnerKey(history[0]), 'drew a picasso');
assert.equal(historyOwnerLabel(history[0], roster), 'Nico');
assert.equal(filterHistoryGames(history, {owner:'all',period:'7d',view:'summary',mode:'all'}, now).length, 2);
assert.equal(filterHistoryGames(history, {owner:'wong chi ming',period:'all',view:'matches',mode:'competitive'}, now).length, 2);
assert.equal(filterHistoryGames(history, {owner:'all',period:'all',view:'matches',mode:'deathmatch'}, now).length, 1);

const detailedDeathmatch = {
  mode:'deathmatch', playerPuuid:'self',
  players:[
    {puuid:'other', stats:{kills:40,deaths:10,score:12000}},
    {puuid:'self', stats:{kills:25,deaths:20,score:8000}},
    {puuid:'third', stats:{kills:25,deaths:22,score:7000}},
  ],
};
assert.deepEqual(historyRankedPlayers(detailedDeathmatch).map(player => player.puuid), ['other','self','third']);
assert.equal(historyPlayerPerformance(detailedDeathmatch).placement, 2);
assert.equal(historyPlayerPerformance(detailedDeathmatch).playerCount, 3);
assert.equal(historyPlayerPerformance(detailedDeathmatch).kd, 1.25);
assert.deepEqual(historyRankedPlayers({
  mode:'competitive',
  players:[{puuid:'low',stats:{score:2500}},{puuid:'mvp',stats:{score:5100}}],
}).map(player => player.puuid), ['mvp','low']);

const daily = historyDailyPerformances([
  {player:'Drew A Picasso#XOOO',playerPuuid:'self',map:'Sunset',mode:'deathmatch',players:[
    {puuid:'mvp',stats:{kills:40,deaths:10,assists:1,score:12000}},
    {puuid:'self',agent:'Clove',stats:{kills:15,deaths:11,assists:1,score:4539}},
  ]},
  {player:'Drew A Picasso#XOOO',playerPuuid:'self',map:'Breeze',mode:'deathmatch',players:[
    {puuid:'self',agent:'Vyse',stats:{kills:25,deaths:25,assists:3,score:7600}},
  ]},
], roster);
assert.equal(daily.length, 1);
assert.equal(daily[0].name, 'Nico');
assert.deepEqual([daily[0].games,daily[0].kills,daily[0].deaths,daily[0].assists,daily[0].mvps], [2,40,36,4,1]);
assert.equal(daily[0].kd.toFixed(2), '1.11');
assert.equal(daily[0].best.agent, 'Clove');

console.log('history-utils: modes, owners, filters, labels and performance validated');
