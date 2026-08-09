import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYERS, historyFallback, rankLabel, viewFor } from '../js/lol-roster.mjs';

test('League roster uses the six requested Riot IDs', () => {
  assert.deepEqual(PLAYERS.map(player => `${player.name}:${player.riotId}`), [
    'Nico:phileas fogg#OLY',
    'Liam:FakePlasticTrees#1706',
    'Noé:NoWaY#alone',
    'Rayhan:RayBaz#OLY',
    'Mathis:M A I R#LGND',
    'Logan:Stupefiant#NOXUS',
  ]);
});

test('history fallback derives rank, main role and champion stats', () => {
  const year = new Date().getFullYear();
  const ts = new Date(year, 2, 1).getTime();
  const data = historyFallback([
    { playerName:'phileas fogg#OLY', ts, win:true, kills:9, deaths:3, assists:6, position:'middle', champion:{ name:'Ahri', image:'https://ddragon.leagueoflegends.com/Ahri.png' }, rankAfter:{ tier:'GOLD', division:'I', lp:72 } },
    { playerName:'phileas fogg#OLY', ts:ts+1, win:false, kills:3, deaths:5, assists:7, position:'middle', champion:{ name:'Ahri', image:'https://ddragon.leagueoflegends.com/Ahri.png' } },
  ], 'phileas fogg#OLY');
  assert.equal(rankLabel(data.rank), 'GOLD I');
  assert.equal(data.soloQueue.mainRole, 'mid');
  assert.equal(data.topChampions[0].games, 2);
  assert.equal(data.topChampions[0].winRate, 50);
});

test('verified season data replaces the truncated live champion sample', () => {
  const player = PLAYERS[0];
  const live = {
    current: {
      playerName: player.riotId,
      rank: { tier: 'PLATINUM', division: 'II', games: 21 },
      soloQueue: { games: 20, roles: { support: 14 }, mainRole: 'support' },
      topChampions: [{ name: 'Ahri', games: 2 }],
    },
  };
  const verified = {
    [player.riotId]: {
      playerName: player.riotId,
      seasonVerified: true,
      soloQueue: { games: 104, wins: 58, losses: 46, winRate: 56, mainRole: 'support', mainRoleSource: 'season-champions' },
      topChampions: [{ name: 'Nami', games: 38 }],
    },
  };
  const result = viewFor(player, live, [], verified);
  assert.equal(result.topChampions[0].name, 'Nami');
  assert.equal(result.soloQueue.games, 104);
  assert.equal(result.soloQueue.mainRole, 'support');
  assert.equal(result.soloQueue.mainRoleSource, 'season-champions');
  assert.equal(result.rank.division, 'II');
});
