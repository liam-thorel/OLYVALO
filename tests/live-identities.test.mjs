import assert from 'node:assert/strict';
import { buildLiveIdentityIndex, resolveLiveIdentity } from '../js/live-identities.mjs';

const index = buildLiveIdentityIndex([
  {
    name: 'Rayhan', avatar: 'rayhan.png',
    riot: { name: 'RayBaz', tag: 'OLY' },
    smurfs: [{ name: 'rbz', tag: '3030' }],
  },
  { name: 'Mathis', avatar: 'mathis.png', riot: { name: 'MrScooby', tag: 'MYSTR' } },
], {
  members: { logan: { name: 'Logan', avatar: 'logan.png' } },
  accounts: {
    mathis: { account: { name: 'M A I R', tag: 'LGND', puuid: 'mathis-puuid' } },
    logan: { account: { name: 'LoganMain', tag: 'OLY' } },
  },
});

assert.equal(resolveLiveIdentity({ playerName:'RayBaz#OLY' }, index)?.member, 'Rayhan');
assert.equal(resolveLiveIdentity({ playerName:'RBZ#3030' }, index)?.avatar, 'rayhan.png');
assert.equal(resolveLiveIdentity({ puuid:'mathis-puuid', playerName:'renamed#NEW' }, index)?.member, 'Mathis');
assert.equal(resolveLiveIdentity({ memberId:'logan', playerName:'anything#123' }, index)?.avatar, 'logan.png');
assert.equal(resolveLiveIdentity({ playerName:'unknown#EUW' }, index), null);

const withKnownLeagueAccount = buildLiveIdentityIndex([
  { name:'Nico', avatar:'nico.png', riot:{ name:'Drew A Picasso', tag:'XOOO' } },
], {}, [{ name:'Nico', riotId:'phileas fogg#OLY' }]);
assert.equal(resolveLiveIdentity({ playerName:'phileas fogg#OLY' }, withKnownLeagueAccount)?.member, 'Nico');

console.log('live-identities: admin links, roster accounts, names and avatars validated');
