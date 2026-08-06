const assert = require('node:assert/strict');
const test = require('node:test');
const { roleKey, soloRankFromStats, summarizeSoloQueue } = require('../live/lol-profile-utils');

test('solo rank includes LP, season record and win rate', () => {
  assert.deepEqual(soloRankFromStats({ queues: [
    { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', wins: 2, losses: 1 },
    { queueType: 'RANKED_SOLO_5x5', tier: 'PLATINUM', division: 'II', leaguePoints: 63, wins: 24, losses: 16 },
  ] }), { tier: 'PLATINUM', division: 'II', lp: 63, wins: 24, losses: 16, games: 40, winRate: 60 });
});

test('main role and top champions come only from current-season SoloQ games', () => {
  const puuid = 'player-puuid';
  const game = (championId, win, role, createdAt = 2000) => ({
    queueId: 420,
    gameCreation: createdAt,
    participants: [{ puuid, championId, teamPosition: role, stats: { win, kills: 8, deaths: 4, assists: 6 } }],
  });
  const result = summarizeSoloQueue([
    game(103, true, 'MIDDLE'), game(103, false, 'MIDDLE'), game(103, true, 'MIDDLE'),
    game(64, true, 'JUNGLE'), game(22, false, 'BOTTOM'),
    { ...game(99, true, 'MIDDLE'), queueId: 440 },
    game(1, true, 'MIDDLE', 100),
  ], { puuid }, {
    103: { name: 'Ahri', image: 'ahri.png' },
    64: { name: 'Lee Sin', image: 'leesin.png' },
    22: { name: 'Ashe', image: 'ashe.png' },
  }, 1000);
  assert.equal(result.games, 5);
  assert.equal(result.mainRole, 'mid');
  assert.deepEqual(result.roles, { top: 0, jungle: 1, mid: 3, adc: 1, support: 0 });
  assert.deepEqual(result.topChampions.map(champion => [champion.name, champion.games, champion.winRate, champion.kda]), [
    ['Ahri', 3, 67, 3.5], ['Lee Sin', 1, 100, 3.5], ['Ashe', 1, 0, 3.5],
  ]);
});

test('support role is detected from bottom lane support metadata', () => {
  assert.equal(roleKey({ timeline: { lane: 'BOTTOM', role: 'DUO_SUPPORT' } }), 'support');
});
