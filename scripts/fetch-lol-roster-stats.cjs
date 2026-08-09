const { fetchOpggSoloProfile } = require('../live/opgg-profile');

const ACCOUNTS = [
  'phileas fogg#OLY',
  'FakePlasticTrees#1706',
  'NoWaY#alone',
  'RayBaz#OLY',
  'M A I R#LGND',
  'Stupefiant#NOXUS',
];
const SEASON_ROLE_ESTIMATES = {
  'phileas fogg#OLY': 'support',
  'FakePlasticTrees#1706': 'top',
  'NoWaY#alone': 'adc',
  'RayBaz#OLY': 'top',
  'M A I R#LGND': 'mid',
};

async function main() {
  const profiles = {};
  for (const riotId of ACCOUNTS) {
    try {
      const profile = await fetchOpggSoloProfile(riotId);
      const mainRole = SEASON_ROLE_ESTIMATES[riotId] || '';
      profiles[riotId] = {
        ...profile,
        soloQueue: {
          ...profile.soloQueue,
          ...(mainRole ? { mainRole, mainRoleSource: 'season-champions' } : {}),
        },
        updatedAt: Date.now(),
      };
      process.stderr.write(`OK ${riotId}\n`);
    } catch (error) {
      process.stderr.write(`SKIP ${riotId}: ${error.message}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ updatedAt: Date.now(), profiles }, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
