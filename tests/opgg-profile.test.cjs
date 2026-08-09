const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOpggSoloProfile } = require('../live/opgg-profile');

test('parses full-season SoloQ champion data from an OP.GG flight payload', () => {
  const data = {
    game_type: 'SOLORANKED', season_id: 33, play: 20, win: 12, lose: 8,
    my_champion_stats: [
      { id: 0, play: 20, win: 12, lose: 8 },
      { id: 267, champion_id: 267, name: 'Nami', image_url: 'nami.png', play: 10, win: 7, lose: 3, win_rate: 70, kda: { kda: 4.876 } },
      { id: 161, champion_id: 161, name: "Vel'Koz", image_url: 'velkoz.png', play: 6, win: 3, lose: 3, win_rate: 50, kda: { kda: 2.4 } },
      { id: 69, champion_id: 69, name: 'Cassiopeia', image_url: 'cassiopeia.png', play: 4, win: 2, lose: 2, win_rate: 50, kda: { kda: 3.1 } },
    ],
  };
  const chunk = `x:{"data":${JSON.stringify(data)},"region":"euw"}`;
  const html = `<meta name="description" content="Test / Platinum 3 3 39LP / 12Win 8Lose Win rate 60%"><script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
  const profile = parseOpggSoloProfile(html, 'Test#EUW');
  assert.deepEqual(profile.rank, { tier: 'PLATINUM', division: 'III', lp: 39, wins: 12, losses: 8, games: 20, winRate: 60 });
  assert.deepEqual(profile.soloQueue, { games: 20, wins: 12, losses: 8, winRate: 60 });
  assert.deepEqual(profile.topChampions.map(champion => [champion.name, champion.games, champion.winRate, champion.kda]), [
    ['Nami', 10, 70, 4.88], ["Vel'Koz", 6, 50, 2.4], ['Cassiopeia', 4, 50, 3.1],
  ]);
  assert.equal(profile.topChampions[0].image, 'nami.png');
  assert.equal(profile.seasonVerified, true);
});

test('returns a verified empty season for a valid unranked profile', () => {
  const html = '<title>Stupefiant#NOXUS - Summoner\'s champion information - League of Legends</title>';
  const profile = parseOpggSoloProfile(html, 'Stupefiant#NOXUS');
  assert.equal(profile.seasonVerified, true);
  assert.equal(profile.soloQueue.games, 0);
  assert.deepEqual(profile.topChampions, []);
});
