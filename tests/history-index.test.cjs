const assert = require('node:assert/strict');
const { lolHistorySummary, valorantHistorySummary } = require('../live/history-index.js');

const valorant = valorantHistorySummary({
  ts:10, endTs:20, map:'Lotus', mode:'competitive', result:'win', player:'Nico#OLY', playerPuuid:'p1',
  players:[{ puuid:'p1', agent:'Omen', stats:{ kills:20 } }, { puuid:'p2', agent:'Jett', stats:{ kills:25 } }],
});
assert.equal(valorant.ts, 20);
assert.equal(valorant.players.length, 1);
assert.equal(valorant.players[0].agent, 'Omen');

const lol = lolHistorySummary({ ts:30, playerName:'Nico#OLY', win:true, kills:5, deaths:2, assists:8, items:[1,2,3] });
assert.equal(lol.win, true);
assert.equal(lol.kills, 5);
assert.equal('items' in lol, false, 'heavy LoL details stay outside the timeline index');

console.log('history-index: compact Valorant and LoL summaries validated');
