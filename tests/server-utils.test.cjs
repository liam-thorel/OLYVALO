const assert = require('node:assert/strict');
const { riotServer } = require('../live/server-utils.js');

assert.deepEqual(
  riotServer('aresriot.aws-rclusterprod-euc1-1.eu-gp-frankfurt-1', 'eu'),
  {
    name: 'Francfort',
    gamePodId: 'aresriot.aws-rclusterprod-euc1-1.eu-gp-frankfurt-1',
  },
);
assert.equal(riotServer('eu-gp-paris-1', 'eu').name, 'Paris');
assert.equal(riotServer('ap-gp-singapore-2', 'ap').name, 'Singapour');
assert.equal(riotServer('unknown-pod', 'eu').name, 'Europe');
assert.equal(riotServer('', 'na').name, 'Amérique du Nord');
assert.equal(riotServer('', ''), null);

console.log('server-utils: Riot GamePodID parsing validated');
