const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MEDIA_HOSTS: LIVE_HOSTS,
  applyQueueEvent,
  createSseParser,
  displayDurationMs,
  isAllowedMediaUrl,
  layoutFor,
  normalizeItem,
  parseLiveChatConfig,
  shouldDisplay,
} = require('../live/livechat-utils.js');
const { hostKind } = require('../live/livechat.js');

// Le bot charge config.js, qui exige un token : on ne charge que ce qu'il faut.
const Module = require('node:module');
const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './firebase.js') return { fbGet: async () => null, fbPost: async () => ({}), fbDelete: async () => {}, fbPut: async () => {} };
  return original.call(this, request, parent, isMain);
};
const bot = require('../discord-bot/livechat.js');
Module._load = original;

const NOW = 1_800_000_000_000;
const CDN = 'https://cdn.discordapp.com/attachments/1/2/meme.png?ex=abc';

test('le bot et le Live acceptent exactement les mêmes hôtes de médias', () => {
  assert.deepEqual(bot.MEDIA_HOSTS, LIVE_HOSTS);
});

test('seuls les médias Discord, Tenor et consorts en https sont téléchargés', () => {
  assert.ok(isAllowedMediaUrl(CDN));
  assert.ok(isAllowedMediaUrl('https://media.tenor.com/x/y.mp4'));
  assert.ok(!isAllowedMediaUrl('http://cdn.discordapp.com/a.png'));
  assert.ok(!isAllowedMediaUrl('https://cdn.discordapp.com.evil.fr/a.png'));
  assert.ok(!isAllowedMediaUrl('https://example.com/a.png'));
  assert.ok(!isAllowedMediaUrl('file:///C:/Windows/win.ini'));
});

test('un élément venu de Firebase est validé champ par champ', () => {
  const item = normalizeItem('k1', {
    createdAt: NOW, text: '  Grim   avec  ', size: 'grand',
    media: { url: CDN, kind: 'image' }, from: { name: 'Liam', avatar: 'https://evil.fr/a.png' },
  });
  assert.equal(item.text, 'Grim avec');
  assert.equal(item.media.kind, 'image');
  assert.equal(item.from.avatar, null, 'un avatar hors liste ne doit pas être téléchargé');
  assert.deepEqual(item.layout, layoutFor('grand'));

  assert.equal(normalizeItem('k2', { createdAt: NOW, media: { url: 'https://evil.fr/x.png' } }), null);
  assert.equal(normalizeItem('k3', { createdAt: NOW, text: '   ' }), null);
  assert.equal(normalizeItem('k4', 'texte'), null);
  assert.equal(normalizeItem('k5', { createdAt: NOW, text: 'x'.repeat(500) }).text.length, 220);
  assert.equal(normalizeItem('k6', { createdAt: NOW, text: 'x', size: 'énorme' }).size, 'moyen');
});

test('une zone perso reste entièrement à l’écran', () => {
  const box = layoutFor('custom', { cx: 0.99, cy: -3, w: 0.5, h: 0.4 });
  assert.equal(box.w, 0.5);
  assert.equal(box.cx, 0.75);
  assert.equal(box.cy, 0.2);
  assert.deepEqual(layoutFor('custom', null), layoutFor('moyen'));
});

test('on n’affiche que le récent, une seule fois, et seulement au destinataire', () => {
  const item = normalizeItem('a', { createdAt: NOW - 5000, text: 'yo' });
  assert.ok(shouldDisplay(item, { now: NOW, memberId: 'liam' }));
  assert.ok(!shouldDisplay(item, { now: NOW + 120_000 }), 'trop vieux');
  assert.ok(!shouldDisplay(item, { now: NOW, seen: new Set(['a']) }), 'déjà vu');
  assert.ok(!shouldDisplay(item, { now: NOW, enabled: false }), 'coupé sur ce PC');
  const targeted = normalizeItem('b', { createdAt: NOW, text: 'yo', target: 'nico' });
  assert.ok(shouldDisplay(targeted, { now: NOW, memberId: 'nico' }));
  assert.ok(!shouldDisplay(targeted, { now: NOW, memberId: 'liam' }));
  const fromRayhan = normalizeItem('c', { createdAt: NOW, text: 'yo', target: 'nico', from: { id: 'rayhan', name: 'Rayhan' } });
  assert.ok(shouldDisplay(fromRayhan, { now: NOW, memberId: 'rayhan' }), 'l’expéditeur voit aussi son envoi ciblé');
  assert.ok(!shouldDisplay(fromRayhan, { now: NOW, memberId: 'liam' }), 'mais pas les autres');
  assert.ok(!shouldDisplay(normalizeItem('d', { createdAt: NOW, text: 'yo', target: 'nico' }), { now: NOW, memberId: '' }),
    'un poste sans identité ne devient pas l’expéditeur d’un envoi anonyme');
});

test('durées : le texte seul se lit, le grand format reste plus longtemps', () => {
  const text = normalizeItem('t', { createdAt: NOW, text: 'court' });
  assert.ok(displayDurationMs(text) >= 3500 && displayDurationMs(text) <= 10000);
  const grand = normalizeItem('g', { createdAt: NOW, size: 'grand', media: { url: CDN } });
  const petit = normalizeItem('p', { createdAt: NOW, size: 'petit', media: { url: CDN } });
  assert.ok(displayDurationMs(grand) > displayDurationMs(petit));
  assert.equal(displayDurationMs(normalizeItem('d', { createdAt: NOW, text: 'x', durationMs: 999999 })), 30000);
});

test('les réglages du poste ont des valeurs par défaut sûres', () => {
  assert.deepEqual(parseLiveChatConfig(''), { enabled: true, volume: 60, maxVideoSeconds: 30 });
  assert.deepEqual(parseLiveChatConfig('{"enabled":false,"volume":300}'), { enabled: false, volume: 100, maxVideoSeconds: 30 });
  assert.equal(parseLiveChatConfig('pas du json').enabled, true);
});

test('un GIF Tenor livré en MP4 est joué en boucle comme une vidéo', () => {
  const gif = normalizeItem('g', { createdAt: NOW, media: { url: 'https://media.tenor.com/a/b.mp4', kind: 'gif' } });
  assert.deepEqual(hostKind(gif, 'video/mp4', 'x.mp4'), { kind: 'video', loop: true });
  assert.deepEqual(hostKind(gif, 'image/gif', 'x.gif'), { kind: 'gif', loop: false });
  const image = normalizeItem('i', { createdAt: NOW, media: { url: CDN } });
  assert.deepEqual(hostKind(image, 'image/png', 'x.png'), { kind: 'image', loop: false });
});

test('le flux Firebase est reconstitué, y compris coupé en morceaux', () => {
  const events = [];
  const feed = createSseParser(event => events.push(event));
  feed('event: put\ndata: {"path":"/","data":{"a":{"text":"x"}}}\n');
  feed('\nevent: keep-alive\ndata: null\n\nevent: put\ndata: {"path":"/b","data":{"text":"y"}}\n\n');
  assert.deepEqual(events.map(e => e.event), ['put', 'keep-alive', 'put']);

  const queue = {};
  assert.deepEqual(applyQueueEvent(queue, 'put', events[0].data), ['a']);
  assert.deepEqual(applyQueueEvent(queue, 'put', events[2].data), ['b']);
  assert.deepEqual(applyQueueEvent(queue, 'put', { path: '/a', data: null }), []);
  assert.deepEqual(Object.keys(queue), ['b']);
  assert.deepEqual(applyQueueEvent(queue, 'patch', { path: '/', data: { c: { text: 'z' }, b: null } }), ['c']);
  assert.deepEqual(Object.keys(queue), ['c']);
  applyQueueEvent(queue, 'put', { path: '/c/text', data: 'w' });
  assert.equal(queue.c.text, 'w');
});

test('Discord : préfixe de format, cible en tête et GIF collé', () => {
  assert.deepEqual(bot.parseSizePrefix('g: regarde'), { size: 'grand', text: 'regarde' });
  assert.deepEqual(bot.parseSizePrefix('Petit : ok'), { size: 'petit', text: 'ok' });
  assert.deepEqual(bot.parseSizePrefix('pas de préfixe'), { size: 'moyen', text: 'pas de préfixe' });
  assert.deepEqual(bot.parseSizePrefix('gg: wp'), { size: 'moyen', text: 'gg: wp' });

  const members = { 111: { id: 'nico', name: 'Nico' }, 222: { id: 'liam', name: 'Liam' } };
  const memberByDiscordId = id => members[id] || null;
  const parsed = bot.parseLiveChatMessage({
    content: 'g: <@111> mdr <@222> https://tenor.com/view/x',
    attachments: new Map(),
    embeds: [{ data: { type: 'gifv', video: { url: 'https://media.tenor.com/abc/x.mp4' } } }],
    mentions: { users: new Map() },
  }, { memberByDiscordId });
  assert.equal(parsed.size, 'grand');
  assert.equal(parsed.target, 'nico');
  assert.equal(parsed.text, 'mdr Liam');
  assert.deepEqual(parsed.media, { url: 'https://media.tenor.com/abc/x.mp4', kind: 'gif' });

  const withFile = bot.parseLiveChatMessage({
    content: 'salut',
    attachments: new Map([['1', { url: CDN.replace('png', 'mp4'), contentType: 'video/mp4', name: 'clip.mp4' }]]),
    embeds: [],
  }, { memberByDiscordId });
  assert.equal(withFile.media.kind, 'video');
  assert.equal(withFile.target, null);
});

test('Discord : un élément construit par le bot passe la validation du Live', () => {
  const item = bot.buildLiveChatItem({
    from: { name: 'Liam', avatar: 'https://cdn.discordapp.com/avatars/1/a.png' },
    text: 'hello', media: { url: CDN, kind: 'image' }, size: 'petit', target: 'nico',
  });
  assert.deepEqual(item.createdAt, { '.sv': 'timestamp' });
  const normalized = normalizeItem('x', { ...item, createdAt: NOW });
  assert.equal(normalized.size, 'petit');
  assert.equal(normalized.target, 'nico');
  assert.equal(normalized.from.avatar, 'https://cdn.discordapp.com/avatars/1/a.png');
});

test('Discord : écrans en ligne et nettoyage de la file', () => {
  const receivers = bot.onlineReceivers({
    liam: { name: 'Liam', ts: NOW - 60_000 },
    nico: { name: 'Nico', ts: NOW - 60 * 60_000 },
    rayhan: { name: 'Rayhan', ts: NOW, enabled: false },
  }, NOW);
  assert.deepEqual(receivers, [{ memberId: 'liam', name: 'Liam' }]);
  assert.match(bot.deliverySummary(receivers, null), /1 écran \(Liam\)/);
  assert.match(bot.deliverySummary(receivers, 'nico', 'Nico'), /pas en ligne/);
  assert.match(bot.deliverySummary(receivers, 'nico', 'Nico', 'liam'), /tu le vois quand même sur le tien/);
  assert.match(bot.deliverySummary([...receivers, { memberId: 'nico', name: 'Nico' }], 'nico', 'Nico', 'liam'), /\*\*Nico\*\* \(et sur le tien\)/);
  const item = bot.buildLiveChatItem({ from: { id: 'liam', name: 'Liam' }, text: 'yo', target: 'nico' });
  assert.equal(item.from.id, 'liam');
  assert.equal(normalizeItem('e', { ...item, createdAt: NOW }).from.id, 'liam');
  assert.deepEqual(bot.staleQueueKeys({ old: { createdAt: NOW - 3_600_000 }, fresh: { createdAt: NOW }, broken: {} }, NOW), ['old', 'broken']);
});

test('un extrait vidéo choisi sur le site est validé', () => {
  const VIDEO = 'https://olycity-livechat.olycity.workers.dev/m/abcdef12.mp4';
  const clip = normalizeItem('v', { createdAt: NOW, media: { url: VIDEO, kind: 'video' }, trim: { startMs: 3000.4, endMs: 8900 } });
  assert.deepEqual(clip.trim, { startMs: 3000, endMs: 8900 });
  const at = trim => normalizeItem('v', { createdAt: NOW, media: { url: VIDEO, kind: 'video' }, trim }).trim;
  assert.equal(at({ startMs: 5000, endMs: 5100 }), null, 'extrait trop court');
  assert.equal(at({ startMs: -1, endMs: 5000 }), null);
  assert.equal(at({ startMs: 'x', endMs: 5000 }), null);
  assert.equal(at(null), null);
  const image = normalizeItem('i', { createdAt: NOW, media: { url: CDN }, trim: { startMs: 0, endMs: 5000 } });
  assert.equal(image.trim, null, 'pas d’extrait pour une image');
});
