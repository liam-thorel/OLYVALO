/**
 * Chargement du bot Discord avec toutes ses dépendances bouchonnées.
 *
 * Partagé entre les tests qui doivent faire tourner les vraies fonctions de
 * notification (dodge-cleanup, dodge-announce…) : le bouchon est long, et deux
 * copies divergentes, c'est deux tests qui ne testent plus la même chose.
 *
 * Ce n'est pas un fichier de test : `node --test "tests/*.test.*"` ne le prend
 * pas pour une suite.
 */
const Module = require('node:module');

/**
 * @param {object} options
 * @param {string[]} options.openRounds  matchIds sur lesquels un pari est réellement ouvert.
 *   Un round n'existe que si la notif de début l'a ouvert, donc seulement sur
 *   une file classée : sans ce filtre, un test validerait une annulation
 *   impossible en production.
 * @param {string[]} options.trackedPlayers  membres suivis dans un salon (tous par défaut).
 */
function loadBot({ openRounds = [], trackedPlayers = null } = {}) {
  const open = new Set(openRounds);
  const calls = {
    cancelled: [], resolved: [], edited: [], sends: [], opened: [],
    rankGains: [], playRewards: [], awards: [],
  };

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
        return {
          startTrackerSync: () => {}, loadTrackersOnce: async () => ({}),
          trackersForPlayerGame: name =>
            (!trackedPlayers || trackedPlayers.includes(name) ? [{ channelId: 'salon-1' }] : []),
        };
      case './discovered.js': return { recordDiscovered: async () => {} };
      case './build-image.js': return { buildItemsImage: async () => null };
      case './betting.js':
        return {
          roundsForMatch: async (game, matchId) => (open.has(matchId)
            ? [[`${game}:${matchId}`, {
              game, matchId, channelId: 'salon-1', messageId: 'msg-1', status: 'open',
              players: ['Joueur1'], oddsWin: 1.8, oddsLose: 2.1,
            }]]
            : []),
          cancelRound: async key => { calls.cancelled.push(key); return { key }; },
          resolveRound: async key => { calls.resolved.push(key); return null; },
          openRound: async (game, matchId) => { calls.opened.push(`${game}:${matchId}`); return { key: `${game}:${matchId}`, round: {}, isNew: true }; },
          closeRound: async () => null,
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
      case './wallet.js':
        return {
          rewardForGamePlayed: async (id, amount) => { calls.playRewards.push({ id, amount }); return amount; },
          getBalance: async () => 0,
        };
      case './rank-tracking.js':
        return {
          recordRankGain: async (bucket, account, member, delta) => { calls.rankGains.push({ bucket, account, member, delta }); },
          lolRankPoints: () => 0,
        };
      case './valorant-awards.js':
        return { recordAward: async (kind, id, name) => { calls.awards.push({ kind, id, name }); } };
      case 'discord.js': {
        class Collection extends Map {}
        // Le seul bouchon fidèle du lot : les tests doivent pouvoir LIRE ce
        // que le bot a écrit dans ses embeds. Un proxy fourre-tout renvoie des
        // proxies à la place du texte, et une assertion sur le contenu du
        // message passerait alors quoi qu'il arrive.
        class EmbedBuilder {
          constructor() { this.data = { fields: [] }; }
          setColor(color) { this.data.color = color; return this; }
          setTitle(title) { this.data.title = title; return this; }
          setAuthor(author) { this.data.author = author; return this; }
          setDescription(description) { this.data.description = description; return this; }
          setFooter(footer) { this.data.footer = footer; return this; }
          setThumbnail(url) { this.data.thumbnail = { url }; return this; }
          setImage(url) { this.data.image = { url }; return this; }
          setTimestamp() { return this; }
          addFields(...fields) { this.data.fields.push(...fields.flat()); return this; }
        }
        class Client {
          constructor() {
            this.commands = new Collection();
            this.channels = {
              fetch: async id => ({
                id,
                send: async payload => { calls.sends.push({ channelId: id, payload }); return { id: 'm1' }; },
                // C'est ici que le message de pari est réactualisé.
                messages: {
                  fetch: async mid => ({
                    id: mid,
                    components: [{ components: [{ setDisabled: () => {} }] }],
                    edit: async payload => { calls.edited.push({ mid, payload }); },
                  }),
                },
              }),
            };
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
  return { api: bot.__test, calls };
}

/** Texte de tous les embeds/contenus envoyés, pour chercher une phrase dedans. */
function sentText(sends) {
  return sends.map(({ payload }) => {
    if (typeof payload === 'string') return payload;
    const embeds = (payload?.embeds || []).map(embed => {
      const data = embed?.data || embed;
      return [data?.author?.name, data?.description, ...(data?.fields || []).map(f => `${f.name} ${f.value}`)]
        .filter(Boolean).join('\n');
    });
    return [payload?.content, ...embeds].filter(Boolean).join('\n');
  }).join('\n---\n');
}

module.exports = { loadBot, sentText };
