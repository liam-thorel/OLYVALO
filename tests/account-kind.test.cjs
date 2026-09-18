const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { accountKind, accountMark, accountDetail, shortAccount } = require('../discord-bot/account-kind.js');

// ─── Nature du compte ────────────────────────────────────────────────────────
const rayhan = { name: 'Rayhan', riotIds: ['RayBaz#OLY', 'rbz#3030'], mainRiotId: 'RayBaz#OLY' };

assert.equal(accountKind(rayhan, 'RayBaz#OLY'), 'main');
assert.equal(accountKind(rayhan, 'rbz#3030'), 'smurf');
// Les Riot ID remontent de Riot avec une casse variable.
assert.equal(accountKind(rayhan, 'raybaz#oly'), 'main');
assert.equal(accountKind(rayhan, '  RayBaz#OLY  '), 'main');

// Un membre à compte unique : rien à préciser, le nom suffit.
const noe = { name: 'Noé', riotIds: ['baby hayabusa#NoWaY'], mainRiotId: 'baby hayabusa#NoWaY' };
assert.equal(accountKind(noe, 'baby hayabusa#NoWaY'), 'solo');
assert.equal(accountMark(noe, 'baby hayabusa#NoWaY'), '', 'pas de mention parasite');
assert.equal(accountDetail(noe, 'baby hayabusa#NoWaY'), '');

// ─── Aucun compte principal déclaré ──────────────────────────────────────────
// Les comptes ajoutés depuis l'admin n'ont pas cette notion (voir roster.js).
// Désigner le premier de la liste reviendrait à inventer.
const inconnu = { name: 'X', riotIds: ['a#1', 'b#2'], mainRiotId: null };
assert.equal(accountKind(inconnu, 'a#1'), 'unknown');
assert.equal(accountMark(inconnu, 'a#1'), '', 'aucune affirmation sans source');
// On dit quand même LEQUEL : c'est moins, mais c'est vrai.
assert.equal(accountDetail(inconnu, 'a#1'), ' (a)');

// Compte joué inconnu (session sans playerName) : même prudence.
assert.equal(accountKind(rayhan, ''), 'unknown');
assert.equal(accountKind(rayhan, null), 'unknown');
assert.equal(accountMark(rayhan, undefined), '');

// ─── Mentions ────────────────────────────────────────────────────────────────
assert.equal(accountMark(rayhan, 'RayBaz#OLY'), ' (main)');
assert.equal(accountMark(rayhan, 'rbz#3030'), ' (smurf)');
// L'en-tête reste court même à cinq joueurs : pas de nom de compte dedans.
assert.doesNotMatch(accountMark(rayhan, 'rbz#3030'), /rbz/);
// L'embed, lui, nomme le compte — utile quand un membre a DEUX smurfs.
assert.equal(accountDetail(rayhan, 'rbz#3030'), ' (smurf · rbz)');
assert.equal(accountDetail(rayhan, 'RayBaz#OLY'), ' (main · RayBaz)');

const mathis = {
  name: 'Mathis',
  riotIds: ['M A I R#LGND', 'Motivex500#EUW', 'IlIlllIlIlIllllI#00000'],
  mainRiotId: 'M A I R#LGND',
};
assert.equal(accountDetail(mathis, 'Motivex500#EUW'), ' (smurf · Motivex500)');
assert.equal(accountDetail(mathis, 'IlIlllIlIlIllllI#00000'), ' (smurf · IlIlllIlIlIllllI)');
assert.notEqual(
  accountDetail(mathis, 'Motivex500#EUW'), accountDetail(mathis, 'IlIlllIlIlIllllI#00000'),
  'deux smurfs du même membre doivent rester distinguables');

assert.equal(shortAccount('RayBaz#OLY'), 'RayBaz');
assert.equal(shortAccount('sansTag'), 'sansTag');
assert.equal(shortAccount(''), '');

// ─── Le roster expose bien le compte principal ───────────────────────────────
// roster.json est la seule source qui sépare `riot` de `smurfs`.
// config.js exige DISCORD_TOKEN au require : on le neutralise le temps du load.
const originalLoad = Module._load;
Module._load = function stubbed(request, parent, isMain) {
  if (request === './config.js') return { ROSTER_URL: 'http://localhost/roster.json' };
  if (request === './firebase.js') return { fbGet: async () => null };
  return originalLoad(request, parent, isMain);
};
const rosterModule = require('../discord-bot/roster.js');
Module._load = originalLoad;

const { __test: { indexRoster }, memberByName } = rosterModule;
const roster = require(path.join(__dirname, '..', 'data', 'roster.json'));
indexRoster(roster, null);

const vraiRayhan = memberByName('Rayhan');
assert.ok(vraiRayhan, 'Rayhan est dans le roster');
assert.equal(vraiRayhan.mainRiotId, 'RayBaz#OLY');
assert.equal(accountKind(vraiRayhan, 'RayBaz#OLY'), 'main');
assert.equal(accountKind(vraiRayhan, 'rbz#3030'), 'smurf');

// Un membre ajouté depuis l'admin n'a pas de compte principal : `null`, et non
// le premier Riot ID venu.
indexRoster([], { members: { invite: { name: 'Invité' } }, accounts: { invite: { k1: { name: 'a', tag: '1' }, k2: { name: 'b', tag: '2' } } } });
const invite = memberByName('Invité');
assert.equal(invite.mainRiotId, null, 'aucun principal inventé');
assert.equal(invite.riotIds.length, 2);
assert.equal(accountMark(invite, 'a#1'), '');

// ─── Bout en bout : le message réellement envoyé ─────────────────────────────
const sent = [];

function loadBot(members) {
  const original = Module._load;
  const chain = () => new Proxy(function () {}, {
    get: (t, prop) => (prop === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(),
  });
  const byRiotId = riotId => members.find(m =>
    m.riotIds.some(id => id.toLowerCase() === String(riotId || '').toLowerCase())) || null;

  Module._load = function stub(request, parent, isMain) {
    switch (request) {
      case './config.js':
        return { DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: 'x', DISCORD_LOG_CHANNEL_ID: null, FIREBASE_URL: 'x', ROSTER_URL: 'x', ROLES_URL: 'x' };
      case './firebase.js':
        return { fbGet: async () => null, fbPut: async () => true, fbDelete: async () => true, watchNode: () => () => {} };
      case './roster.js':
        return { ensureRoster: async () => members, memberByIdentity: s => byRiotId(s?.playerName) };
      case './trackers.js':
        return { startTrackerSync: () => {}, loadTrackersOnce: async () => ({}), trackersForPlayerGame: () => [{ channelId: 'salon-1' }] };
      case './discovered.js': return { recordDiscovered: async () => {} };
      case './build-image.js': return { buildItemsImage: async () => null };
      case './betting.js':
        return {
          openRound: async () => ({ key: 'k', round: {}, isNew: false }),
          closeRound: async () => null, resolveRound: async () => null, cancelRound: async () => null,
          roundsForMatch: async () => [], placeBet: async () => ({ ok: false }),
          attachMessage: async () => {}, BETTING_WINDOW_MS: 1000,
        };
      case './weekly.js': return { startWeeklyScheduler: () => {} };
      case './daily-recap.js': return { startDailyRecapScheduler: () => {} };
      case './lol-recap.js':
        return Object.fromEntries(['startLolSoloRecapScheduler', 'startLolFlexRecapScheduler',
          'startLolSoloWeeklyRecapScheduler', 'startLolFlexWeeklyRecapScheduler',
          'startLolSoloMonthlyRecapScheduler', 'startLolFlexMonthlyRecapScheduler'].map(n => [n, () => {}]));
      case './valo-daily-recap.js':
        return Object.fromEntries(['startValoDailyRecapScheduler', 'startValoWeeklyRecapScheduler',
          'startValoMonthlyRecapScheduler'].map(n => [n, () => {}]));
      case './leaderboard-rank.js': return { startLeaderboardScheduler: () => {} };
      case './wallet.js': return { rewardForGamePlayed: async () => 0 };
      case './rank-tracking.js': return { recordRankGain: async () => {}, lolRankPoints: () => 0 };
      case './valorant-awards.js': return { recordAward: async () => {} };
      case 'discord.js': {
        class Collection extends Map {}
        class EmbedBuilder {
          setColor() { return this; } setTimestamp() { return this; } setThumbnail() { return this; }
          setDescription(d) { this.description = d; return this; }
          setAuthor(a) { this.author = a.name; return this; }
          addFields(...fields) { this.fields = fields.flat(); return this; }
        }
        class Client {
          constructor() {
            this.commands = new Collection();
            this.channels = { fetch: async id => ({ id, send: async payload => { sent.push(payload); return { id: 'm1' }; }, messages: { fetch: async () => null } }) };
            this.users = { fetch: async () => ({ username: 'x' }) };
          }
          on() { return this; } once() { return this; } isReady() { return true; }
          async login() { return 'stub'; }
        }
        return new Proxy({ Client, Collection, EmbedBuilder, GatewayIntentBits: { Guilds: 1 } }, {
          get: (t, prop) => (prop in t ? t[prop] : chain()),
        });
      }
      case 'dotenv': return { config: () => {} };
      default:
        if (request.startsWith('./commands/')) return { data: { name: request }, execute: async () => {} };
        return original(request, parent, isMain);
    }
  };
  delete require.cache[require.resolve('../discord-bot/index.js')];
  const bot = require('../discord-bot/index.js');
  Module._load = original;
  return bot.__test;
}

(async () => {
  const bot = loadBot([rayhan, noe]);

  // Le smurf, seul.
  sent.length = 0;
  const smurf = { active: true, playerName: 'rbz#3030', mode: 'competitive', matchId: 'm-smurf', side: 'ATTAQUE' };
  await bot.notifyValorantGameStart(smurf, { [smurf.playerName]: smurf });
  assert.equal(sent.length, 1, 'une notification envoyée');
  assert.match(sent[0].content, /\*\*Rayhan\*\* \(smurf\) en game !/, 'l’en-tête dit smurf');
  const joueurs = sent[0].embeds[0].fields.find(f => f.name === 'Joueur');
  assert.match(joueurs.value, /\*\*Rayhan\*\* \(smurf · rbz\) — ⚔️ Attaque/, 'l’embed nomme le compte');

  // Le compte principal.
  sent.length = 0;
  const main = { active: true, playerName: 'RayBaz#OLY', mode: 'competitive', matchId: 'm-main', side: 'DEFENSE' };
  await bot.notifyValorantGameStart(main, { [main.playerName]: main });
  assert.match(sent[0].content, /\*\*Rayhan\*\* \(main\) en game !/);

  // Un membre à compte unique ne gagne aucune mention.
  sent.length = 0;
  const solo = { active: true, playerName: 'baby hayabusa#NoWaY', mode: 'competitive', matchId: 'm-solo' };
  await bot.notifyValorantGameStart(solo, { [solo.playerName]: solo });
  assert.match(sent[0].content, /\*\*Noé\*\* en game !/);
  assert.doesNotMatch(sent[0].content, /main|smurf/, 'rien à préciser sur un compte unique');

  // ─── La fenêtre anti-doublon ne doit pas avaler le changement de compte ────
  // Elle existe pour qu'une reconnexion du flux Firebase ne renotifie pas la
  // MÊME partie. Indexée sur le seul nom du membre, elle faisait aussi taire la
  // partie suivante jouée sur l'autre compte.
  const bot2 = loadBot([rayhan, noe]);
  sent.length = 0;
  const surLeSmurf = { active: true, playerName: 'rbz#3030', mode: 'competitive', matchId: 'a1' };
  await bot2.notifyValorantGameStart(surLeSmurf, { [surLeSmurf.playerName]: surLeSmurf });
  const surLeMain = { active: true, playerName: 'RayBaz#OLY', mode: 'competitive', matchId: 'a2' };
  await bot2.notifyValorantGameStart(surLeMain, { [surLeMain.playerName]: surLeMain });
  assert.equal(sent.length, 2, 'changer de compte est une vraie nouvelle partie');
  assert.match(sent[0].content, /\(smurf\)/);
  assert.match(sent[1].content, /\(main\)/);

  // Le garde-fou reste entier : même compte, même joueur, un seul message.
  // Bot neuf : rbz vient d'être notifié ci-dessus, la fenêtre court déjà.
  const bot3 = loadBot([rayhan, noe]);
  sent.length = 0;
  const revu = { active: true, playerName: 'rbz#3030', mode: 'competitive', matchId: 'b1' };
  await bot3.notifyValorantGameStart(revu, { [revu.playerName]: revu });
  const revuBis = { active: true, playerName: 'rbz#3030', mode: 'competitive', matchId: 'b2' };
  await bot3.notifyValorantGameStart(revuBis, { [revuBis.playerName]: revuBis });
  assert.equal(sent.length, 1, 'la même partie revue ne renotifie pas');

  // ─── LoL ───────────────────────────────────────────────────────────────────
  sent.length = 0;
  const lol = {
    active: true, playerName: 'rbz#3030', queueId: 420, matchId: 'm-lol',
    champion: { name: 'Ahri' }, position: 'middle',
  };
  await bot.notifyLolGameStart(lol, { [lol.playerName]: lol });
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /\*\*Rayhan\*\* \(smurf\) en game LoL !/);
  assert.match(sent[0].embeds[0].author, /Rayhan \(smurf · rbz\) — Ahri/);

  console.log('account-kind: main et smurf distingués dans les notifications Valorant et LoL');
})().catch(error => { console.error(error); process.exit(1); });
