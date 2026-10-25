import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { appMembers } from '../js/home-dashboard.mjs';
import { mergeMemberProfiles } from '../js/member-profiles.mjs';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const LIAM_ID = '292778302278598656';
const FRESH = `https://cdn.discordapp.com/avatars/${LIAM_ID}/nouvelle.png?size=256`;

// ─── Accueil : tous ceux qui ont l'appli ─────────────────────────────────────
test('l’accueil montre aussi les personnes dont le Live s’est signalé', () => {
  const members = [{ id: 'liam', name: 'Liam', avatar: 'a' }];
  const people = appMembers(members, {
    valorantClients: { p1: { memberId: 'max', member: 'Max' }, p2: { memberId: 'liam', member: 'Liam' } },
    lolClients: { p3: { memberId: 'Max', member: 'Max' }, p4: { memberId: '', member: 'Anonyme' }, p5: { memberId: 'x/../y' } },
  });
  assert.deepEqual(people.map(person => person.id), ['liam', 'max'], 'une seule fois, sans doublon ni identifiant douteux');
  assert.equal(people[1].name, 'Max');
  assert.deepEqual(appMembers(members, {}), members);
  assert.match(read('js/home-dashboard.mjs'), /memberFaces\(appMembers\(members, snapshot\), model\.onlineIds\)/);
});

// ─── Photos de profil Discord à jour ─────────────────────────────────────────
test('le site préfère la photo Discord actuelle, seulement depuis Discord', () => {
  const roster = [{ id: 'liam', name: 'Liam', avatar: 'ancienne.png', discordId: LIAM_ID }];
  const merged = profiles => mergeMemberProfiles({ roster, profiles })[0].avatar;
  assert.equal(merged({ liam: { avatar: FRESH, discordId: LIAM_ID } }), FRESH);
  assert.equal(merged({ liam: { avatar: 'https://evil.fr/a.png', discordId: LIAM_ID } }), 'ancienne.png', 'Firebase est ouvert : adresse refusée');
  assert.equal(merged({ liam: { avatar: FRESH, discordId: '1' } }), 'ancienne.png', 'photo d’un autre compte');
  assert.equal(merged(null), 'ancienne.png');
  assert.match(read('js/main.js'), /mergeMemberProfiles\(\{ roster, members, overlay: memberOverlay \|\| \{\}, profiles: discordProfiles \}\)/);
});

test('le bot publie les photos actuelles et ne réécrit que ce qui change', async () => {
  const { profileChanged, refreshDiscordProfiles } = require('../discord-bot/discord-profiles.js');
  const user = (id, hash) => ({ id, globalName: 'Liam', username: 'toasterliam', displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256` });
  const writes = [];
  const client = { users: { fetch: async id => { if (id === '404') throw new Error('Unknown User'); return user(id, 'h2'); } } };
  const members = [
    { id: 'liam', name: 'Liam', discordId: LIAM_ID },
    { id: 'max', name: 'Max', discordId: null },
    { id: 'parti', name: 'Parti', discordId: '404' },
  ];
  const existing = { liam: { discordId: LIAM_ID, avatar: `https://cdn.discordapp.com/avatars/${LIAM_ID}/h1.png?size=256`, globalName: 'Liam', username: 'toasterliam' } };
  const updated = await refreshDiscordProfiles({ client, members, fbGet: async () => existing, fbPut: async (path, value) => writes.push([path, value]), now: 5 });
  assert.equal(updated, 1);
  assert.equal(writes[0][0], 'discordProfiles/liam');
  assert.match(writes[0][1].avatar, /h2\.png/);
  assert.equal(writes[0][1].updatedAt, 5);
  assert.equal(profileChanged(writes[0][1], { ...writes[0][1] }), false, 'rien de neuf : pas d’écriture');
  assert.match(read('discord-bot/index.js'), /startDiscordProfilesRefresh\(\{ client, ensureRoster, fbGet, fbPut \}\)/);
});

test('bot et livechat utilisent la photo actuelle', async () => {
  // roster.js : la photo publiée remplace l'adresse figée.
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { ROSTER_URL: 'http://localhost/roster.json' };
    if (request === './firebase.js') return { fbGet: async () => null };
    return original(request, parent, isMain);
  };
  const roster = require('../discord-bot/roster.js');
  const { senderFor } = require('../discord-bot/livechat.js');
  Module._load = original;
  const players = JSON.parse(read('data/roster.json'));
  roster.__test.indexRoster(players, null, { liam: { avatar: FRESH, discordId: LIAM_ID }, nico: { avatar: 'https://evil.fr/x.png' } });
  assert.equal(roster.memberById('liam').avatar, FRESH);
  assert.notEqual(roster.memberById('nico').avatar, 'https://evil.fr/x.png');

  const sender = senderFor({ id: LIAM_ID, avatar: 'h', displayAvatarURL: () => FRESH, username: 'toasterliam' }, null, () => ({ id: 'liam', name: 'Liam', avatar: 'ancienne.png' }));
  assert.equal(sender.avatar, FRESH);
  assert.match(read('workers/livechat/worker.mjs'), /avatar: \(user\.avatar \? `https:\/\/cdn\.discordapp\.com\/avatars/);
});

// ─── Live : inscription rattrapée ────────────────────────────────────────────
test('le Live inscrit au roster une personne créée sur ce PC, sans rien écraser', async () => {
  const { ensureMemberRegistered } = require('../live/member-registration.js');
  const run = async ({ member = null, hidden = null, identity = { memberId: 'max', memberName: 'Max', isNewMember: true } } = {}) => {
    const writes = [];
    const done = await ensureMemberRegistered({
      identity,
      getFB: async path => (path.includes('hiddenMembers') ? hidden : member),
      putFB: async (path, value) => { writes.push([path, value]); return true; },
      now: 7,
    });
    return { done, writes };
  };
  const missing = await run();
  assert.equal(missing.done, true);
  assert.deepEqual(missing.writes, [
    ['rosterOverlay/members/max/name', 'Max'],
    ['rosterOverlay/members/max/createdBy', 'olycity-live'],
    ['rosterOverlay/members/max/createdAt', 7],
  ], 'champ par champ : une fiche existante n’est jamais remplacée');
  assert.deepEqual((await run({ member: { name: 'Max', discordId: '1' } })).writes, [], 'déjà inscrit');
  assert.deepEqual((await run({ hidden: true })).writes, [], 'retiré depuis l’admin : il ne revient pas');
  assert.deepEqual((await run({ identity: { memberId: 'liam', memberName: 'Liam', isNewMember: false } })).writes, [], 'membre du roster : rien à faire');
  assert.ok(JSON.parse(read('live/update-manifest.json')).files.includes('member-registration.js'));
});
