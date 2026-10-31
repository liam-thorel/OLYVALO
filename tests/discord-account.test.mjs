import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  DISCORD_CLIENT_ID, authorizeUrl, parseOAuthReturn, discordIdOf, memberForDiscordId, discordAvatarUrl,
  accountFromDiscordUser, profileForAccount, fetchDiscordAccount, completeDiscordLogin, recordAccount,
  loadAccount, saveAccount, unlinkedAccounts, SHARED_COOKIE, sharedCookieDomain, readSharedLogin, writeSharedLogin,
  clearSharedLogin, adoptSharedLogin, linkableMembers, suggestedMember, linkWrites, refreshAccount,
} from '../js/discord-account.mjs';
import { memberId } from '../js/member-profiles.mjs';
import { rosterMembers } from '../workers/livechat/worker.mjs';

const require = createRequire(import.meta.url);
const members = JSON.parse(fs.readFileSync(new URL('../data/members.json', import.meta.url), 'utf8'));
const roster = JSON.parse(fs.readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
const LIAM_ID = '292778302278598656';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ─── Le lien compte Discord ↔ joueur ─────────────────────────────────────────
test('chaque membre du roster a un identifiant Discord, le même que son avatar', () => {
  assert.equal(members.length, 7);
  for (const member of [...members, ...roster]) {
    assert.match(member.discordId, /^\d{17,20}$/, `${member.name} doit être relié à un compte Discord`);
    assert.ok(member.avatar.includes(`/avatars/${member.discordId}/`), `${member.name} : identifiant et avatar concordent`);
  }
  assert.equal(new Set(members.map(m => m.discordId)).size, members.length, 'un compte Discord par personne');
  for (const player of roster) {
    assert.equal(members.find(m => m.name === player.name)?.discordId, player.discordId, `${player.name} identique dans les deux fichiers`);
  }
});

test('l’identifiant déclaré prime, l’avatar sert de repli', () => {
  assert.equal(discordIdOf({ avatar: 'https://cdn.discordapp.com/avatars/111111111111111111/x.png' }), '111111111111111111');
  assert.equal(discordIdOf({ discordId: '222222222222222222', avatar: 'https://cdn.discordapp.com/avatars/111111111111111111/x.png' }), '222222222222222222');
  assert.equal(discordIdOf({ discordId: 'pas-un-id', avatar: '' }), null);
  assert.equal(memberForDiscordId(members, LIAM_ID)?.id, 'liam');
  assert.equal(memberForDiscordId(members, ''), null);
  // Le Worker livechat applique la même règle.
  const fromWorker = rosterMembers([{ id: 'a', name: 'A', discordId: '333333333333333333', avatar: 'https://cdn.discordapp.com/avatars/111111111111111111/x.png' }], {
    b: { name: 'B', discordId: '444444444444444444' },
  });
  assert.deepEqual(fromWorker.map(m => m.discordId), ['333333333333333333', '444444444444444444']);
});

// ─── OAuth2 ──────────────────────────────────────────────────────────────────
test('l’autorisation demande seulement l’identité, à l’application OLYBOT', () => {
  const url = new URL(authorizeUrl({ redirect: 'https://tracker.olycity.fr/', state: 's1' }));
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), DISCORD_CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://tracker.olycity.fr/');
  assert.equal(url.searchParams.get('state'), 's1');
  // Même application que la page livechat d'olycity.fr.
  assert.match(fs.readFileSync(new URL('../workers/livechat/README.md', import.meta.url), 'utf8'), /OLYBOT/);
});

test('le retour de Discord n’est accepté qu’avec l’état posé au départ', () => {
  assert.equal(parseOAuthReturn('#comp-1-2', 's1'), null, 'un lien de comp n’est pas un retour Discord');
  assert.equal(parseOAuthReturn('', 's1'), null);
  assert.deepEqual(parseOAuthReturn('#access_token=t&state=s1', 's1'), { token: 't', expiresIn: 0 });
  assert.deepEqual(parseOAuthReturn('#access_token=t&expires_in=604800&state=s1', 's1'), { token: 't', expiresIn: 604800 });
  assert.match(parseOAuthReturn('#access_token=t&state=autre', 's1').error, /état invalide/);
  assert.match(parseOAuthReturn('#access_token=t&state=s1', null).error, /état invalide/, 'sans départ depuis ce navigateur');
  assert.match(parseOAuthReturn('#error=access_denied&state=s1', 's1').error, /annulée/);
});

// ─── Compte ──────────────────────────────────────────────────────────────────
test('un membre garde son nom et son avatar du roster', () => {
  const account = accountFromDiscordUser({ id: LIAM_ID, username: 'fpt', global_name: 'Autre nom', avatar: 'h' }, members);
  assert.equal(account.memberId, 'liam');
  assert.equal(account.name, 'Liam');
  assert.equal(account.avatar, members.find(m => m.id === 'liam').avatar);
  assert.deepEqual(profileForAccount(account, members, memberId), { id: 'liam', name: 'Liam', avatar: account.avatar });
});

test('quelqu’un hors roster obtient un nouveau compte à son nom Discord', () => {
  const account = accountFromDiscordUser({ id: '123456789012345678', username: 'zed', global_name: 'Zed', avatar: null }, members);
  assert.equal(account.memberId, null);
  assert.equal(account.name, 'Zed');
  assert.match(account.avatar, /embed\/avatars\/\d\.png$/, 'avatar par défaut de Discord');
  const profile = profileForAccount(account, members, memberId);
  assert.deepEqual(profile, { id: 'discord-123456789012345678', name: 'Zed', avatar: account.avatar, discordOnly: true });
  assert.match(profile.id, /^[a-z0-9-]{1,48}$/, 'compatible avec le cookie partagé');
  assert.equal(discordAvatarUrl({ id: '1', avatar: 'abc' }), 'https://cdn.discordapp.com/avatars/1/abc.png?size=256');
});

test('un compte hors roster ne peut pas porter le nom d’un membre', () => {
  const account = accountFromDiscordUser({ id: '123456789012345678', username: 'liam.fan', global_name: 'Liam', avatar: null }, members);
  const profile = profileForAccount(account, members, memberId);
  assert.notEqual(memberId(profile.name), 'liam');
  assert.equal(profile.name, 'Liam (@liamfan)', 'le point est interdit dans une clé Firebase');
  const weird = profileForAccount({ ...account, name: 'a.b#c$d[e]f/g' }, members, memberId);
  assert.equal(weird.name, 'abcdefg');
  assert.equal(profileForAccount({ ...account, name: '...' }, members, memberId).name, 'Joueur 5678');
});

test('l’identité vient de Discord, avec repli sur le Worker livechat pour les membres', async () => {
  const calls = [];
  const direct = async (url, init) => { calls.push([url, init.headers.Authorization]); return json(200, { id: LIAM_ID, username: 'fpt' }); };
  assert.equal((await fetchDiscordAccount('tok', members, direct)).memberId, 'liam');
  assert.deepEqual(calls[0], ['https://discord.com/api/v10/users/@me', 'Bearer tok']);

  await assert.rejects(fetchDiscordAccount('tok', members, async () => json(401, {})), /expirée/);

  const fallback = async url => (url.includes('discord.com') ? Promise.reject(new TypeError('CORS')) : json(200, { member: { id: 'nico', name: 'Nico' } }));
  const viaWorker = await fetchDiscordAccount('tok', members, fallback);
  assert.equal(viaWorker.memberId, 'nico');
  assert.equal(viaWorker.discordId, members.find(m => m.id === 'nico').discordId);

  const nobody = async url => (url.includes('discord.com') ? Promise.reject(new TypeError('CORS')) : json(403, { error: 'Ton compte Discord ne fait pas partie du roster OLYCITY.' }));
  await assert.rejects(fetchDiscordAccount('tok', members, nobody), /roster/);
});

test('le jeton est retiré de l’adresse et seul le compte est gardé dans le navigateur', async () => {
  const storage = memoryStorage({ 'olycity-discord-state': 's1' });
  const loc = { origin: 'https://tracker.olycity.fr', pathname: '/', hash: '#access_token=secret&state=s1' };
  const replaced = [];
  const history = { replaceState: (_s, _t, url) => replaced.push(url) };
  const result = await completeDiscordLogin(members, {
    storage, loc, history, fetchImpl: async () => json(200, { id: LIAM_ID, username: 'fpt' }),
  });
  assert.equal(result.account.memberId, 'liam');
  assert.deepEqual(replaced, ['https://tracker.olycity.fr/']);
  assert.equal(storage.getItem('olycity-discord-state'), null, 'un état ne sert qu’une fois');
  assert.doesNotMatch(storage.getItem('olycity-account'), /secret/, 'le jeton n’est pas conservé');
  assert.equal(loadAccount(storage).discordId, LIAM_ID);

  const none = await completeDiscordLogin(members, { storage, loc: { ...loc, hash: '' }, history });
  assert.equal(none, null);
  saveAccount({ discordId: 'nope' }, storage);
  assert.equal(loadAccount(storage), null, 'un compte illisible ne vaut rien');
});

// ─── Connexion unique ────────────────────────────────────────────────────────
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123';
function cookieJar() {
  const jar = { cookies: new Map(), written: [] };
  return Object.defineProperty(jar, 'cookie', {
    get: () => [...jar.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    set: line => {
      jar.written.push(line);
      const [pair, ...attrs] = line.split('; ');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (attrs.includes('Max-Age=0')) jar.cookies.delete(name); else jar.cookies.set(name, value);
    },
  });
}

test('le jeton est partagé entre tous les sites d’olycity.fr, et seulement eux', () => {
  assert.equal(sharedCookieDomain('tracker.olycity.fr'), 'olycity.fr');
  assert.equal(sharedCookieDomain('olycity.fr'), 'olycity.fr');
  assert.equal(sharedCookieDomain('musique.olycity.fr'), 'olycity.fr');
  assert.equal(sharedCookieDomain('olycity.fr.evil.com'), null);
  assert.equal(sharedCookieDomain('evilolycity.fr'), null);
  assert.equal(sharedCookieDomain('liam-thorel.github.io'), null);

  const now = 1_800_000_000_000;
  const doc = cookieJar();
  assert.equal(writeSharedLogin(TOKEN, 604800, { doc, loc: { hostname: 'liam-thorel.github.io' }, now }), false, 'rien hors olycity.fr');
  assert.equal(writeSharedLogin('a;b=c', 604800, { doc, loc: { hostname: 'tracker.olycity.fr' }, now }), false, 'jamais de jeton bizarre dans un cookie');
  assert.equal(writeSharedLogin(TOKEN, 604800, { doc, loc: { hostname: 'tracker.olycity.fr' }, now }), true);
  assert.match(doc.written.at(-1), new RegExp(`^${SHARED_COOKIE}=.+; Domain=olycity\\.fr; Path=/; Max-Age=604740; Secure; SameSite=Lax$`));
  assert.deepEqual(readSharedLogin(doc.cookie, now), { token: TOKEN, expiresAt: now + 604740 * 1000 });
  assert.equal(readSharedLogin(doc.cookie, now + 604800 * 1000), null, 'expiré');
  assert.equal(readSharedLogin(`autre=1; ${SHARED_COOKIE}=v2%7C1%7Cx`, now), null, 'format inconnu');
  assert.equal(readSharedLogin('', now), null);
  clearSharedLogin({ doc, loc: { hostname: 'olycity.fr' } });
  assert.equal(readSharedLogin(doc.cookie, now), null, 'déconnecté partout');
});

test('une connexion faite ailleurs connecte le site, une connexion ici connecte les autres', async () => {
  const now = Date.now();
  const doc = cookieJar();
  const loc = { origin: 'https://tracker.olycity.fr', hostname: 'tracker.olycity.fr', pathname: '/', hash: '' };
  writeSharedLogin(TOKEN, 3600, { doc, loc, now });
  const storage = memoryStorage();
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers.Authorization); return json(200, { id: LIAM_ID, username: 'fpt' }); };
  const adopted = await adoptSharedLogin(members, { storage, doc, loc, fetchImpl, now });
  assert.equal(adopted.account.memberId, 'liam');
  assert.deepEqual(seen, [`Bearer ${TOKEN}`]);
  assert.equal(loadAccount(storage).discordId, LIAM_ID);
  assert.equal(await adoptSharedLogin(members, { storage, doc, loc, fetchImpl, now }), null, 'déjà connecté : rien à faire');

  const revoked = cookieJar();
  writeSharedLogin(TOKEN, 3600, { doc: revoked, loc, now });
  assert.equal(await adoptSharedLogin(members, { storage: memoryStorage(), doc: revoked, loc, fetchImpl: async () => json(401, {}), now }), null);
  assert.equal(readSharedLogin(revoked.cookie, now), null, 'un jeton révoqué est oublié');

  const fresh = cookieJar();
  const back = await completeDiscordLogin(members, {
    storage: memoryStorage({ 'olycity-discord-state': 's1' }),
    loc: { ...loc, hash: `#access_token=${TOKEN}&expires_in=604800&state=s1` },
    history: { replaceState() {} }, doc: fresh, now,
    fetchImpl: async () => json(200, { id: LIAM_ID, username: 'fpt' }),
  });
  assert.equal(back.account.memberId, 'liam');
  assert.equal(readSharedLogin(fresh.cookie, now).token, TOKEN, 'la page livechat et la musique en profitent');
});

test('le compte est tracé dans Firebase sans écraser sa date de création', async () => {
  const sent = [];
  const fetchImpl = existing => async (url, init = {}) => {
    if (!init.method) return json(200, existing);
    sent.push([init.method, url, JSON.parse(init.body)]);
    return json(200, {});
  };
  const account = { discordId: LIAM_ID, username: 'fpt', name: 'Liam', avatar: 'a', memberId: 'liam' };
  await recordAccount(account, 'https://fb', fetchImpl(null), 1000);
  assert.equal(sent[0][0], 'PATCH');
  assert.equal(sent[0][1], `https://fb/accounts/${LIAM_ID}.json`);
  assert.equal(sent[0][2].createdAt, 1000);
  await recordAccount(account, 'https://fb', fetchImpl({ createdAt: 5 }), 2000);
  assert.equal(sent[1][2].createdAt, undefined);
  assert.equal(sent[1][2].lastLoginAt, 2000);
});

test('l’admin voit les comptes connectés qui ne sont reliés à personne', () => {
  const rows = unlinkedAccounts({
    a: { discordId: LIAM_ID, name: 'Liam', lastLoginAt: 3 },
    b: { discordId: '123456789012345678', name: 'Zed', lastLoginAt: 1 },
    c: { discordId: '223456789012345678', name: 'Yo', lastLoginAt: 2 },
    d: { discordId: 'faux' },
  }, members);
  assert.deepEqual(rows.map(r => r.name), ['Yo', 'Zed']);
  const admin = fs.readFileSync(new URL('../js/admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /fbPut\(`rosterOverlay\/members\/\$\{id\}`, \{ name, role: '', avatar: account\.avatar \|\| '', discordId: account\.discordId \}\)/,
    'la fiche ajoutée porte l’identifiant Discord');
});

// ─── Bot ─────────────────────────────────────────────────────────────────────
test('le bot écrit le même compte, relié au même membre', async () => {
  const { accountRecord, linkAccount, accountMessage } = require('../discord-bot/account-link.js');
  const user = { id: LIAM_ID, username: 'fpt', globalName: 'Liam D', avatar: 'h' };
  const member = { id: 'liam', name: 'Liam', avatar: 'roster.png' };
  assert.deepEqual(accountRecord(user, member, { createdAt: 5, lastLoginAt: 9 }, 100), {
    createdAt: 5, lastLoginAt: 9, discordId: LIAM_ID, username: 'fpt', name: 'Liam', avatar: 'roster.png', memberId: 'liam', lastBotAt: 100,
  });
  const writes = [];
  const result = await linkAccount({ user, member: null, fbGet: async () => null, fbPut: async (path, value) => writes.push([path, value]), now: 7 });
  assert.equal(result.isNew, true);
  assert.equal(writes[0][0], `accounts/${LIAM_ID}`);
  assert.equal(writes[0][1].memberId, null);
  assert.match(accountMessage({ record: result.record, isNew: true, balance: 500 }), /Compte OLYCITY créé[\s\S]*hors roster[\s\S]*500/);
  assert.match(accountMessage({ record: { ...result.record, memberId: 'liam', name: 'Liam' }, isNew: false }), /relié à \*\*Liam\*\*/);

  const index = fs.readFileSync(new URL('../discord-bot/index.js', import.meta.url), 'utf8');
  assert.match(index, /'\.\/commands\/compte\.js'/, '/compte est chargée par le bot');
  assert.match(fs.readFileSync(new URL('../discord-bot/roster.js', import.meta.url), 'utf8'), /discordId: discordIdOf\(player\)/);
});

test('la page Paris montre le solde du compte connecté', async () => {
  const { myWalletLine } = await import('../js/betting-page.mjs');
  assert.equal(myWalletLine(null, {}), null, 'invité : rien');
  assert.match(myWalletLine({ discordId: LIAM_ID }, {}), /\/compte/);
  assert.equal(myWalletLine({ discordId: LIAM_ID }, { [LIAM_ID]: { balance: 1200, weekStartBalance: 1000 } }),
    'Ton solde : <strong>1200 pts</strong> · +200 cette semaine');
});

// ─── Relier un membre créé par le Live (ex. Max) ─────────────────────────────
const MAX_ID = '123456789012345678';
const withMax = [...members, { id: 'max', name: 'Max', avatar: '', createdBy: 'olycity-live' }];

test('un membre créé par le Live se relie à son compte Discord', () => {
  assert.deepEqual(linkableMembers(withMax).map(m => m.id), ['max'], 'seuls ceux sans compte Discord');
  const account = { discordId: MAX_ID, username: 'max.gg', name: 'Max', avatar: 'https://cdn.discordapp.com/avatars/1/a.png' };
  assert.equal(suggestedMember(account, withMax, memberId)?.id, 'max', 'même nom : suggéré');
  assert.equal(suggestedMember({ ...account, name: 'Autre', username: 'autre' }, withMax, memberId), null);
  assert.deepEqual(linkWrites(account, withMax.at(-1)), [
    ['rosterOverlay/members/max/discordId', MAX_ID],
    ['rosterOverlay/members/max/avatar', account.avatar],
    [`accounts/${MAX_ID}/memberId`, 'max'],
  ]);
  assert.deepEqual(linkWrites(account, { id: 'max', avatar: 'deja.png' }).map(([path]) => path), [
    'rosterOverlay/members/max/discordId', `accounts/${MAX_ID}/memberId`,
  ], 'un avatar existant est gardé');
  assert.deepEqual(linkWrites({ discordId: 'x' }, { id: 'max' }), []);
  const admin = fs.readFileSync(new URL('../js/admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /for \(const \[path, value\] of linkWrites\(account, member\)\) await fbPut\(path, value\);/);
});

test('un compte relié depuis est reconnu sans reconnexion', () => {
  const stored = { discordId: MAX_ID, username: 'max.gg', name: 'Max', avatar: 'a', memberId: null };
  const linked = [...members, { id: 'max', name: 'Max', avatar: 'a', discordId: MAX_ID }];
  assert.deepEqual(refreshAccount(stored, linked), { ...stored, memberId: 'max' });
  assert.equal(refreshAccount(stored, withMax), stored, 'pas encore relié : inchangé');
  assert.equal(refreshAccount({ ...stored, memberId: 'max' }, withMax).memberId, null, 'membre retiré');
  const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(main, /const account = refreshAccount\(storedAccount, state\.MEMBERS\);\s*if \(account !== storedAccount\) saveAccount\(account\);/);
});

test('bot : /relier réservé à Liam, sans écraser un compte existant', () => {
  const { linkPlan } = require('../discord-bot/account-link.js');
  const user = { id: MAX_ID, avatar: 'h' };
  assert.deepEqual(linkPlan({ user, member: { id: 'max', name: 'Max', avatar: '', source: 'overlay', discordId: null } }).writes, [
    ['rosterOverlay/members/max/discordId', MAX_ID],
    ['rosterOverlay/members/max/avatar', `https://cdn.discordapp.com/avatars/${MAX_ID}/h.png?size=256`],
  ]);
  assert.match(linkPlan({ user, member: null }).error, /introuvable/);
  assert.match(linkPlan({ user, member: { id: 'max', name: 'Max', discordId: '999999999999999999', source: 'overlay' } }).error, /autre compte/);
  assert.match(linkPlan({ user, member: { id: 'max', name: 'Max', source: 'overlay' }, owner: { id: 'nico', name: 'Nico' } }).error, /déjà relié à \*\*Nico/);
  assert.match(linkPlan({ user, member: { id: 'liam', name: 'Liam', source: 'roster' } }).error, /roster\.json/);
  const command = fs.readFileSync(new URL('../discord-bot/commands/relier.js', import.meta.url), 'utf8');
  assert.match(command, /if \(!LIVECHAT_ADMIN_IDS\.includes\(interaction\.user\.id\)\)/);
  assert.match(fs.readFileSync(new URL('../discord-bot/index.js', import.meta.url), 'utf8'), /'\.\/commands\/relier\.js'/);
});
