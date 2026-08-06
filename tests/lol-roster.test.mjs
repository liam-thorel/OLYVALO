import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYERS, historyFallback, rankLabel } from '../js/lol-roster.mjs';

test('League roster uses the five requested Riot IDs', () => {
  assert.deepEqual(PLAYERS.map(player => `${player.name}:${player.riotId}`), [
    'Nico:phileas fogg#OLY',
    'Liam:FakePlasticTrees#1706',
    'Noé:NoWaY#alone',
    'Rayhan:RayBaz#OLY',
    'Mathis:MrScooby#MYSTR',
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
