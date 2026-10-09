const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createResultGuard, deleterFromAuditLog, repostContent } = require('../discord-bot/result-guard.js');

const BOT = 'bot-1';
const CHANNEL = 'salon-1';
const NOW = 1_800_000_000_000;

test('journal d’audit : qui vient de supprimer', () => {
  const seen = new Map();
  const entry = (id, executorId, count, ageMs, extra = {}) => ({ id, executorId, targetId: BOT, channelId: CHANNEL, count, createdTimestamp: NOW - ageMs, ...extra });
  // Entrée toute neuve.
  assert.equal(deleterFromAuditLog([entry('a', 'nico', 1, 2000)], { botId: BOT, channelId: CHANNEL, now: NOW, seen }), 'nico');
  // Discord regroupe les suppressions rapprochées : même entrée, compteur +1.
  assert.equal(deleterFromAuditLog([entry('a', 'nico', 2, 90_000)], { botId: BOT, channelId: CHANNEL, now: NOW, seen }), 'nico',
    'une entrée ancienne dont le compteur augmente, c’est cette suppression');
  // Rien de nouveau : on ne désigne personne.
  assert.equal(deleterFromAuditLog([entry('a', 'nico', 2, 95_000)], { botId: BOT, channelId: CHANNEL, now: NOW, seen }), null);
  // Autre salon, autre cible : pas concernés.
  assert.equal(deleterFromAuditLog([
    entry('b', 'liam', 1, 1000, { channelId: 'autre' }),
    entry('c', 'liam', 1, 1000, { targetId: 'quelqu-un' }),
  ], { botId: BOT, channelId: CHANNEL, now: NOW, seen }), null);
  // Entrée ancienne jamais vue (bot redémarré) : ambiguë, on n'accuse pas.
  assert.equal(deleterFromAuditLog([entry('d', 'rayhan', 3, 120_000)], { botId: BOT, channelId: CHANNEL, now: NOW, seen: new Map() }), null);
});

test('pique : mention, puis (x2), (x3)…', () => {
  assert.equal(repostContent('💀 Défaite de **Nico**', 'nico', 1),
    '😏 Bien essayé <@nico> — ce résultat ne disparaît pas si facilement.\n💀 Défaite de **Nico**');
  assert.match(repostContent('', 'nico', 2), /Bien essayé <@nico> \(x2\)/);
  assert.match(repostContent('', 'nico', 3), /\(x3\)/);
  assert.match(repostContent('', null, 1), /^😏 Bien essayé — /, 'sans coupable connu, on ne nomme personne');
});

function fakeDiscord({ auditEntries = () => [], auditError = null } = {}) {
  const sent = [];
  let nextId = 100;
  const guild = {
    id: 'g-1',
    fetchAuditLogs: async () => {
      if (auditError) throw auditError;
      return { entries: new Map(auditEntries().map(entry => [entry.id, {
        id: entry.id, executorId: entry.executorId, targetId: BOT,
        extra: { channel: { id: CHANNEL }, count: entry.count }, createdTimestamp: entry.createdTimestamp,
      }])) };
    },
  };
  const channel = {
    id: CHANNEL,
    send: async payload => { const message = { id: `m${nextId++}`, channelId: CHANNEL, guild, channel }; sent.push({ payload, message }); return message; },
  };
  const client = { user: { id: BOT }, channels: { fetch: async () => channel }, guilds: { fetch: async () => guild } };
  return { client, channel, guild, sent };
}

test('un résultat supprimé revient, et le compteur monte à chaque fois', async () => {
  let audit = [];
  let clock = NOW;
  const discord = fakeDiscord({ auditEntries: () => audit });
  const guard = createResultGuard({ client: discord.client, log: () => {}, now: () => clock, wait: async () => {} });

  const payload = { content: '💀 Défaite de **Nico**', embeds: ['carte'], files: [{ attachment: Buffer.from('png'), name: 'build-nico.png' }] };
  const original = await discord.channel.send(payload);
  guard.remember(original, payload);
  await new Promise(resolve => setImmediate(resolve)); // relevé initial du journal

  // Nico supprime la carte.
  audit = [{ id: 'e1', executorId: 'nico', count: 1, createdTimestamp: clock }];
  const first = await guard.handleDelete(original);
  assert.equal(first.deleterId, 'nico');
  assert.equal(first.count, 1);
  const repost = discord.sent.at(-1);
  assert.match(repost.payload.content, /^😏 Bien essayé <@nico> — /);
  assert.match(repost.payload.content, /Défaite de \*\*Nico\*\*$/, 'le résultat d’origine est repris');
  assert.deepEqual(repost.payload.embeds, ['carte']);
  assert.equal(repost.payload.files[0].name, 'build-nico.png', 'l’image du build revient aussi');
  assert.deepEqual(repost.payload.allowedMentions, { users: ['nico'] }, 'seul le coupable est notifié');

  // Il recommence sur le repost : même entrée regroupée, compteur 2.
  clock += 60_000;
  audit = [{ id: 'e1', executorId: 'nico', count: 2, createdTimestamp: NOW }];
  const second = await guard.handleDelete(repost.message);
  assert.equal(second.count, 2);
  assert.match(discord.sent.at(-1).payload.content, /Bien essayé <@nico> \(x2\)/);
  assert.doesNotMatch(discord.sent.at(-1).payload.content, /Bien essayé.*Bien essayé/s, 'pas de piques empilées');

  clock += 60_000;
  audit = [{ id: 'e1', executorId: 'nico', count: 3, createdTimestamp: NOW }];
  await guard.handleDelete(discord.sent.at(-1).message);
  assert.match(discord.sent.at(-1).payload.content, /\(x3\)/);
});

test('un message qui n’est pas un résultat n’est pas concerné', async () => {
  const discord = fakeDiscord();
  const guard = createResultGuard({ client: discord.client, log: () => {}, wait: async () => {} });
  assert.equal(await guard.handleDelete({ id: 'inconnu', channel: discord.channel }), null);
  assert.equal(discord.sent.length, 0);
});

test('un admin autorisé peut retirer un résultat erroné', async () => {
  let audit = [];
  const discord = fakeDiscord({ auditEntries: () => audit });
  const guard = createResultGuard({ client: discord.client, log: () => {}, allowList: ['liam'], wait: async () => {} });
  const message = await discord.channel.send({ content: 'x' });
  guard.remember(message, { content: 'x' });
  await new Promise(resolve => setImmediate(resolve)); // relevé initial, sans l'entrée
  audit = [{ id: 'e9', executorId: 'liam', count: 1, createdTimestamp: Date.now() }];
  const result = await guard.handleDelete(message);
  assert.equal(result, null);
  assert.equal(discord.sent.length, 1, 'rien n’est reposté');
});

test('sans accès au journal d’audit, le résultat revient sans accuser personne', async () => {
  const logs = [];
  const discord = fakeDiscord({ auditError: new Error('Missing Permissions') });
  const guard = createResultGuard({ client: discord.client, log: line => logs.push(line), wait: async () => {} });
  const message = await discord.channel.send({ content: 'résultat' });
  guard.remember(message, { content: 'résultat' });
  const result = await guard.handleDelete(message);
  assert.equal(result.deleterId, null);
  assert.match(discord.sent.at(-1).payload.content, /^😏 Bien essayé — /);
  assert.deepEqual(discord.sent.at(-1).payload.allowedMentions, { users: [] });
  assert.equal(logs.filter(line => line.includes("journal d'audit illisible")).length, 1, 'signalé une seule fois');
});

test('câblage : intents, surveillance des deux résultats, évènement', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'discord-bot', 'index.js'), 'utf8');
  assert.match(index, /intents: \[GatewayIntentBits\.Guilds, GatewayIntentBits\.GuildMessages\]/,
    'sans GuildMessages, Discord n’envoie pas les suppressions');
  assert.match(index, /partials: \[Partials\.Message\]/);
  assert.equal((index.match(/resultGuard\.remember\(await channel\.send\(payload\), payload\);/g) || []).length, 2,
    'résultats Valorant et LoL');
  assert.match(index, /client\.on\('messageDelete', message => \{\n\s*resultGuard\.handleDelete\(message\)/);
});
