const assert = require('node:assert/strict');
const Module = require('node:module');

// Le pari d'avant-match ne peut s'appuyer que sur le rang et le winrate : Riot
// masque l'adversaire jusqu'à la fin de la partie. À la mi-temps, le score
// donne enfin un signal direct — et un second pari s'ouvre dessus.

const opened = [];

function loadBot() {
  const original = Module._load;
  const chain = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : chain()), apply: () => chain(), construct: () => chain(),
  });
  Module._load = function stub(request, parent, isMain) {
    switch (request) {
      case './config.js':
        return { DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: 'x', DISCORD_LOG_CHANNEL_ID: null, FIREBASE_URL: 'x', ROSTER_URL: 'x', ROLES_URL: 'x' };
      case './firebase.js':
        return { fbGet: async () => null, fbPut: async () => true, fbDelete: async () => true, watchNode: () => () => {} };
      case './roster.js':
        return {
          ensureRoster: async () => [],
          memberByIdentity: s => {
            const name = String(s?.playerName || 'X').split('#')[0];
            return { id: name.toLowerCase(), name, discordId: `d-${name}`, avatar: null, riotIds: [s?.playerName || ''] };
          },
        };
      case './trackers.js':
        return { startTrackerSync: () => {}, loadTrackersOnce: async () => ({}), trackersForPlayerGame: () => [{ channelId: 'salon-1' }] };
      case './discovered.js': return { recordDiscovered: async () => {} };
      case './build-image.js': return { buildItemsImage: async () => null };
      case './betting.js':
        return {
          // On observe ce qui est réellement demandé : phase et cotes comprises.
          openRound: async args => { opened.push(args); return { key: 'k', round: {}, isNew: false }; },
          roundsForMatch: async () => [], closeRound: async () => null,
          resolveRound: async () => null, cancelRound: async () => null,
          placeBet: async () => ({ ok: false }), attachMessage: async () => {},
          betErrorMessage: () => '', betConfirmation: () => '', betModalLabels: () => ({}),
          MIN_BET: 10, BETTING_WINDOW_MS: 1000,
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
        class Client {
          constructor() {
            this.commands = new Collection();
            this.channels = { fetch: async id => ({ id, send: async () => ({ id: 'm1' }), messages: { fetch: async () => null } }) };
            this.users = { fetch: async () => ({ username: 'x' }) };
          }
          on() { return this; } once() { return this; } isReady() { return true; }
          async login() { return 'stub'; }
        }
        return new Proxy({ Client, Collection, GatewayIntentBits: { Guilds: 1 } }, {
          get: (t, k) => (k in t ? t[k] : chain()),
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

const { maybeOpenHalfTimeRound } = loadBot();

let n = 0;
const session = (extra = {}) => {
  n += 1;
  return {
    active: true, mode: 'competitive', matchId: `M${n}`,
    playerName: `Joueur${n}#OLY`, selfTeam: 'ORDER',
    score: { blue: 9, red: 3 }, ...extra,
  };
};
const run = async s => { opened.length = 0; await maybeOpenHalfTimeRound(s, { [s.playerName]: s }); return [...opened]; };

(async () => {
  // ─── Cas nominal ───────────────────────────────────────────────────────────
  let calls = await run(session());
  assert.equal(calls.length, 1, 'un pari de mi-temps doit s’ouvrir');
  assert.equal(calls[0].phase, 'half', 'la phase distingue ce pari de celui d’avant-match');
  assert.ok(calls[0].odds, 'les cotes viennent du score, pas de l’estimation d’avant-match');
  assert.equal(calls[0].odds.oddsWin, 1.05, '9–3 : large favori');

  // Le camp compte : mené 3–9, la cote de victoire doit monter.
  calls = await run(session({ selfTeam: 'CHAOS' }));
  assert.equal(calls[0].odds.oddsWin, 20, 'du côté CHAOS, 9–3 se lit 3–9');

  // ─── Une seule fois par partie ─────────────────────────────────────────────
  // Le score est republié à chaque manche et la session reste active.
  const repeated = session();
  await run(repeated);
  const again = await run(repeated);
  assert.deepEqual(again, [], 'le pari de mi-temps ne s’ouvre qu’une fois');

  // ─── Ce qui ne doit rien ouvrir ────────────────────────────────────────────
  assert.deepEqual(await run(session({ score: { blue: 6, red: 5 } })), [], '11 manches : pas la mi-temps');
  assert.deepEqual(await run(session({ score: { blue: 7, red: 6 } })), [], '13 manches : mi-temps passée');
  assert.deepEqual(await run(session({ mode: 'unrated' })), [], 'hors classé, aucun pari');
  assert.deepEqual(await run(session({ mode: 'deathmatch' })), [], 'deathmatch non plus');
  assert.deepEqual(await run(session({ selfTeam: 'NEUTRAL' })), [], 'camp inconnu : on n’invente pas la cote');
  assert.deepEqual(await run(session({ selfTeam: null })), []);
  assert.deepEqual(await run(session({ score: null })), [], 'sans score, rien');
  assert.deepEqual(await run(session({ score: {} })), []);
  assert.deepEqual(await run(session({ matchId: '' })), [], 'sans matchId, impossible de rattacher le pari');

  console.log('half-time-odds: pari de mi-temps ouvert une fois, avec la cote du bon camp');
})().catch(error => { console.error(error); process.exit(1); });
