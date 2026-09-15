const assert = require('node:assert/strict');
const Module = require('node:module');

// Une partie annulée — dodge en sélection d'agents, joueur qui ne se connecte
// pas — n'a ni mode ni résultat : le script publie la fin de session AVANT
// d'aller chercher le rapport de fin de partie, et pour ces parties-là ce
// rapport n'arrive jamais.
//
// C'est pourtant ce chemin qui doit annuler le pari, rembourser les mises et
// réactualiser le message. Le garde « file classée » sortait avant, parce
// qu'un mode absent se lisait comme un mode non classé.

// Parties sur lesquelles un pari a réellement été ouvert (donc des classées
// qui ont démarré) avant d'être annulées.
const OPEN_ROUNDS = new Set(['match-dodge', 'lol-annule']);

const cancelled = [];
const resolved = [];
const edited = [];

function loadBot() {
  const original = Module._load;
  const chain = () => new Proxy(function () {}, {
    get: (t, prop) => (prop === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(),
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
          // Un round n'existe que si la notif de début l'a ouvert, donc
          // seulement sur une file classée. Le stub le reflète : sans ça, le
          // test validerait une annulation impossible en production.
          roundsForMatch: async (game, matchId) => (OPEN_ROUNDS.has(matchId)
            ? [[`${game}:${matchId}`, {
              game, matchId, channelId: 'salon-1', messageId: 'msg-1', status: 'open',
              players: ['Joueur1'], oddsWin: 1.8, oddsLose: 2.1,
            }]]
            : []),
          cancelRound: async key => { cancelled.push(key); return { key }; },
          resolveRound: async key => { resolved.push(key); return null; },
          openRound: async () => ({ key: 'k', round: {}, isNew: false }),
          placeBet: async () => ({ ok: false }),
          attachMessage: async () => {},
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
      case './wallet.js': return { rewardForGamePlayed: async (id, amount) => amount };
      case './rank-tracking.js': return { recordRankGain: async () => {}, lolRankPoints: () => 0 };
      case './valorant-awards.js': return { recordAward: async () => {} };
      case 'discord.js': {
        class Collection extends Map {}
        class Client {
          constructor() {
            this.commands = new Collection();
            this.channels = {
              fetch: async id => ({
                id,
                send: async () => ({ id: 'm1' }),
                // C'est ici que le message de pari est réactualisé.
                messages: {
                  fetch: async mid => ({
                    id: mid,
                    components: [{ components: [{ setDisabled: () => {} }] }],
                    edit: async payload => { edited.push({ mid, payload }); },
                  }),
                },
              }),
            };
            this.users = { fetch: async () => ({ username: 'x' }) };
          }
          on() { return this; } once() { return this; } isReady() { return true; }
          async login() { return 'stub'; }
        }
        return new Proxy({ Client, Collection, GatewayIntentBits: { Guilds: 1 } }, {
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

const { notifyValorantGameEnd, notifyLolGameEnd } = loadBot();

(async () => {
  // ─── Le cas signalé : dodge ─────────────────────────────────────────────────
  // La session telle que le script la publie vraiment à l'annulation : ni mode,
  // ni résultat, juste le matchId de la sélection d'agents.
  cancelled.length = 0; resolved.length = 0; edited.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Joueur1#OLY',
    memberId: 'joueur1', member: 'Joueur1', matchId: 'match-dodge',
  }]);

  assert.deepEqual(cancelled, ['valorant:match-dodge'],
    'le pari doit être annulé et les mises remboursées');
  assert.deepEqual(resolved, [], 'sans vainqueur, on annule au lieu de résoudre');
  assert.equal(edited.length, 1, 'le message de pari doit être réactualisé');

  // ─── Le garde reste efficace sur un mode RÉELLEMENT identifié ──────────────
  cancelled.length = 0; edited.length = 0;
  await notifyValorantGameEnd([{
    active: false, ts: Date.now(), playerName: 'Joueur2#OLY',
    memberId: 'joueur2', member: 'Joueur2', matchId: 'match-dm',
    mode: 'deathmatch',
    result: { result: 'completed', mode: 'deathmatch', kills: 30, deaths: 20, assists: 0 },
  }]);
  assert.deepEqual(cancelled, [], 'aucun pari n’existe sur un deathmatch, rien à annuler');

  // ─── LoL : une file inconnue ne doit pas non plus bloquer le nettoyage ─────
  cancelled.length = 0; edited.length = 0;
  await notifyLolGameEnd([{
    active: false, ts: Date.now(), playerName: 'Invoc1#EUW',
    memberId: 'invoc1', member: 'Invoc1', matchId: 'lol-annule',
  }]);
  assert.deepEqual(cancelled, ['lol:lol-annule'],
    'une partie LoL annulée doit aussi rembourser');

  console.log('dodge-cleanup: une partie annulée annule le pari et réactualise le message');
})().catch(error => { console.error(error); process.exit(1); });
