import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as worker from '../workers/livechat/worker.mjs';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const links = require('../live/video-links.js');
const utils = require('../live/livechat-utils.js');
const { expectedHash, FORMAT } = require('../live/ytdlp.js');
const { skipArgs } = require('../live/livechat.js');

// Le bot exige config.js (jeton Discord) et Firebase : neutralisés.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './firebase.js' || request === '../firebase.js') return { fbGet: async () => null, fbPut: async () => true, fbPost: async () => ({}), fbDelete: async () => {} };
  return originalLoad(request, parent, isMain);
};
const bot = require('../discord-bot/livechat.js');
Module._load = originalLoad;

const NOW = 1_800_000_000_000;

// ─── Une seule règle pour les liens ──────────────────────────────────────────
test('la règle des liens est la même partout', () => {
  const source = read('live/video-links.js');
  assert.equal(read('discord-bot/video-links.js'), source, 'copie du bot identique');
  assert.equal(read('extension/video-links.js'), source, 'copie de l’extension identique');
  assert.deepEqual(worker.VIDEO_LINK_HOSTS, links.VIDEO_LINK_HOSTS, 'liste du Worker identique');
  for (const url of [
    'https://youtu.be/dQw4w9WgXcQ?t=42', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://clips.twitch.tv/Abc', 'https://x.com/a/status/1#m', 'http://www.reddit.com/r/a/comments/b/',
    'https://youtube.com/@chaine', 'https://evil.com/youtube.com', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://user:pw@youtube.com/watch?v=dQw4w9WgXcQ', 'ftp://youtube.com/x', `https://x.com/${'a'.repeat(600)}`,
  ]) {
    assert.equal(worker.normalizeVideoLink(url), links.normalizeVideoLink(url)?.url ?? null, url);
  }
});

test('les liens acceptés sont ramenés à une forme canonique', () => {
  assert.deepEqual(links.normalizeVideoLink('https://youtu.be/dQw4w9WgXcQ?t=1m30s&si=xx'),
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', site: 'youtube', startMs: 90000 });
  assert.equal(links.normalizeVideoLink('https://youtube.com/@chaine'), null, 'une chaîne n’est pas une vidéo');
  assert.equal(links.normalizeVideoLink('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(links.normalizeVideoLink('https://evil.com/?u=https://youtube.com'), null);
  assert.equal(links.normalizeVideoLink('http://x.com/a/status/1').url, 'https://x.com/a/status/1');
  assert.equal(links.parseTimecode('1:02:03'), 3723000);
  assert.equal(links.parseTimecode('80'), 80000);
  assert.equal(links.parseTimecode('1m20s'), 80000);
  assert.equal(links.parseTimecode('abc'), null);
});

// ─── Live ────────────────────────────────────────────────────────────────────
test('le Live accepte un lien de site connu, jamais une adresse libre', () => {
  const item = utils.normalizeItem('a', { createdAt: NOW, link: { url: 'https://youtu.be/dQw4w9WgXcQ' }, trim: { startMs: 80000, endMs: 95000 } });
  assert.deepEqual(item.media, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'video', link: true, site: 'youtube' });
  assert.deepEqual(item.trim, { startMs: 80000, endMs: 95000 }, 'l’extrait suit le lien');
  assert.equal(utils.normalizeItem('b', { createdAt: NOW, link: { url: 'https://evil.com/v.mp4' } }), null);
  // Un média Discord reste prioritaire sur un lien.
  const both = utils.normalizeItem('c', { createdAt: NOW, media: { url: 'https://cdn.discordapp.com/a.png' }, link: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.equal(both.media.link, undefined);
});

test('yt-dlp : empreinte vérifiée, formats lisibles sans ffmpeg', () => {
  const hash = 'a'.repeat(64);
  assert.equal(expectedHash(`${'b'.repeat(64)}  yt-dlp\n${hash}  yt-dlp.exe\n`), hash);
  assert.equal(expectedHash(`${hash} *yt-dlp.exe`), hash);
  assert.equal(expectedHash('rien'), null);
  assert.doesNotMatch(FORMAT, /\+/, 'jamais d’image et de son séparés : ffmpeg serait nécessaire');
  assert.match(FORMAT, /protocol!\*=dash/);
  const source = read('live/ytdlp.js');
  assert.match(source, /expected !== actual\) throw/, 'un binaire à l’empreinte inconnue est rejeté');
  assert.match(source, /'!is_live'/, 'un direct est refusé');
  assert.ok(JSON.parse(read('live/update-manifest.json')).files.includes('livechat-keys.cs'));
});

test('touches : modificateurs exacts, défauts sûrs, jamais deux fois la même', () => {
  const config = utils.parseLiveChatConfig('');
  assert.equal(utils.hotkeyLabel(config.skipKey), 'Ctrl+Maj+F9');
  assert.equal(utils.hotkeyLabel(config.toggleKey), 'Ctrl+Maj+F10');
  assert.equal(utils.parseLiveChatConfig('{"toggleKey":null}').toggleKey, null, 'une touche retirée le reste');
  assert.equal(utils.parseLiveChatConfig('{"skipKey":{"vk":1}}').skipKey.vk, 0x78, 'le clic gauche est refusé');
  assert.equal(utils.parseLiveChatConfig('{"skipKey":{"vk":17}}').skipKey.vk, 0x78, 'Ctrl seul est refusé');
  const same = '{"skipKey":{"vk":5},"toggleKey":{"vk":5}}';
  assert.equal(utils.parseLiveChatConfig(same).toggleKey, null, 'passer l’emporte');
  assert.equal(utils.hotkeyLabel({ vk: 0x05 }), 'Souris 4');
  assert.equal(utils.hotkeyLabel({ vk: 0x41, alt: true }), 'Alt+A');
  assert.deepEqual(skipArgs(null), { skipVk: 0 });
  assert.deepEqual(skipArgs({ vk: 0x78, ctrl: true, shift: false, alt: false, win: false }), { skipVk: 0x78, skipCtrl: true, skipShift: false, skipAlt: false, skipWin: false });
  const host = read('live/livechat-host.cs');
  assert.match(host, /Down\(0x11\) == item\.SkipCtrl/, 'la fenêtre compare les modificateurs exactement');
  assert.match(read('live/livechat-keys.cs'), /CtrlDown\(\) == combo\.Ctrl/);
  assert.doesNotMatch(read('live/livechat-keys.cs'), /SetWindowsHookEx|RegisterHotKey\(/, 'ni hook clavier ni RegisterHotKey');
});

test('réactivation à distance : la plus récente, une fois, pas trop vieille', () => {
  const control = { all: { enableAt: NOW - 1000, by: 'Liam' }, members: { nico: { enableAt: NOW - 500, by: 'Liam' } } };
  assert.deepEqual(utils.pendingControl(control, { memberId: 'nico', now: NOW }), { at: NOW - 500, by: 'Liam' });
  assert.deepEqual(utils.pendingControl(control, { memberId: 'rayhan', now: NOW }), { at: NOW - 1000, by: 'Liam' });
  assert.equal(utils.pendingControl(control, { memberId: 'nico', appliedAt: NOW - 500, now: NOW }), null, 'déjà appliquée');
  assert.equal(utils.pendingControl({ all: { enableAt: NOW - 13 * 3600e3 } }, { now: NOW }), null, 'trop vieille');
  assert.equal(utils.pendingControl(null, { now: NOW }), null);
  const live = read('live/livechat.js');
  assert.match(live, /writeConfig\(\{ controlAppliedAt: order\.at \}\)/, 'appliquée une seule fois, même après redémarrage');
});

// ─── Bot ─────────────────────────────────────────────────────────────────────
test('bot : un lien posté dans #livechat, avec son extrait', () => {
  const message = (content) => ({ content, attachments: new Map(), embeds: [{ type: 'video', thumbnail: { url: 'https://i.ytimg.com/x.jpg' } }], mentions: { users: new Map() } });
  const parsed = bot.parseLiveChatMessage(message('g: https://youtu.be/dQw4w9WgXcQ 1:20-1:35 regardez'), { memberByDiscordId: () => null });
  assert.equal(parsed.size, 'grand');
  assert.equal(parsed.link, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(parsed.trim, { startMs: 80000, endMs: 95000 });
  assert.equal(parsed.text, 'regardez');
  assert.equal(parsed.media, null, 'la miniature YouTube n’est pas le média');
  assert.deepEqual(bot.linkFromText('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42').trim, { startMs: 42000, endMs: 72000 });
  assert.equal(bot.linkFromText('https://tenor.com/view/x'), null, 'un GIF Tenor reste un embed');
  assert.deepEqual(bot.clipFromTimes('1:00', '0:30'), { startMs: 60000, endMs: 90000 }, 'une fin avant le début : 30 s');
  assert.deepEqual(bot.clipFromTimes('0', '20:00'), { startMs: 0, endMs: 600000 }, 'extrait borné à 10 min');

  const item = bot.buildLiveChatItem({ from: { name: 'Liam' }, link: parsed.link, trim: parsed.trim });
  assert.deepEqual(item.link, { url: parsed.link });
  assert.equal(item.media, null);
  assert.deepEqual(item.trim, parsed.trim);
  const live = utils.normalizeItem('x', { ...item, createdAt: NOW });
  assert.equal(live.media.link, true, 'ce que le bot écrit, le Live le lit');
});

test('bot : /livechat-reactiver réservé à Liam, chargé et déclaré', () => {
  const command = read('discord-bot/commands/livechat-reactiver.js');
  assert.match(command, /if \(!LIVECHAT_ADMIN_IDS\.includes\(interaction\.user\.id\)\)/);
  assert.match(read('discord-bot/config.js'), /LIVECHAT_ADMIN_IDS \|\| '292778302278598656'/, 'toasterliam par défaut');
  assert.match(read('discord-bot/index.js'), /'\.\/commands\/livechat-reactiver\.js'/);
  assert.deepEqual(bot.mutedReceivers({ a: { name: 'A', enabled: false, ts: NOW }, b: { name: 'B', enabled: true, ts: NOW }, c: { enabled: false, ts: 0 } }, NOW),
    [{ memberId: 'a', name: 'A' }]);
});

// ─── Worker ──────────────────────────────────────────────────────────────────
test('Worker : lien et extrait acceptés, route de réactivation réservée', async () => {
  const member = { id: 'liam', name: 'Liam', avatar: null };
  const submission = worker.parseSubmission({ link: 'https://youtu.be/dQw4w9WgXcQ', trim: { startMs: 1000, endMs: 9000 }, via: 'extension' }, member);
  assert.equal(submission.link, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const queued = worker.queueItem(submission, null);
  assert.deepEqual(queued.link, { url: submission.link });
  assert.deepEqual(queued.trim, { startMs: 1000, endMs: 9000 });
  assert.match(worker.discordContent(submission), /<https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ>[\s\S]*extension navigateur/);
  assert.match(worker.parseSubmission({ link: 'https://evil.com/a.mp4' }, member).error, /non pris en charge/);

  assert.equal(worker.isAdmin({ discordId: '292778302278598656' }, {}), true);
  assert.equal(worker.isAdmin({ discordId: '1' }, {}), false);
  assert.equal(worker.isAdmin({ discordId: '1' }, { LIVECHAT_ADMIN_IDS: '1,2' }), true);
  assert.equal(worker.controlWrite('all', 'Liam').path, 'livechat/control/all');
  assert.equal(worker.controlWrite('nico', 'Liam').path, 'livechat/control/members/nico');
  assert.match(worker.controlWrite('../x').error, /invalide/);

  // L'extension est une origine autorisée ; une autre extension non.
  const call = origin => worker.handleRequest(new Request('https://w.test/me', { headers: { Origin: origin } }), {});
  assert.equal((await call('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).status, 403);
  assert.equal((await call('chrome-extension://enlemeekfaobchkhfgealebaiabpmdgm')).status, 401, 'acceptée, puis connexion demandée');
});

// ─── Extension ───────────────────────────────────────────────────────────────
test('extension : identifiant fixe, permissions et fichiers en place', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...digest].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.equal(id, 'enlemeekfaobchkhfgealebaiabpmdgm', 'la clé publique donne l’identifiant déclaré à Discord et au Worker');
  assert.match(read('workers/livechat/worker.mjs'), new RegExp(`chrome-extension://${id}`));
  assert.match(read('extension/README.md'), new RegExp(`https://${id}\\.chromiumapp\\.org/`));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['identity', 'storage']);
  assert.deepEqual(manifest.content_scripts[0].js, ['video-links.js', 'content.js']);
  for (const file of ['background.js', 'content.js', 'popup.html', 'popup.js', ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(new URL(`../extension/${file}`, import.meta.url)), file);
  }
  const background = read('extension/background.js');
  assert.match(background, /DISCORD_CLIENT_ID = '1281505908224168027'/, 'application OLYBOT');
  assert.match(background, /params\.get\('state'\) !== state/, 'état OAuth vérifié');
  assert.match(background, /via: 'extension'/);
  const content = read('extension/content.js');
  assert.match(content, /attachShadow/, 'le style de la page ne touche pas au panneau');
  assert.match(content, /event\.stopPropagation\(\)/, 'les raccourcis de YouTube ne réagissent pas pendant la saisie');
  assert.match(content, /if \(!clipOrVod\) return null;/, 'pas de direct Twitch/Kick');
});
