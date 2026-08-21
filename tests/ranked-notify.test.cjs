const assert = require('node:assert/strict');
const Module = require('node:module');

// Messages réellement envoyés à Discord pendant le test.
const sent = [];

function loadBot() {
  const original = Module._load;
  const chain = () => new Proxy(function () {}, {
    get: (t, prop) => (prop === 'then' ? undefined : chain()),
    apply: () => chain(),
    construct: () => chain(),
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
          // Le nom dérive du playerName : chaque cas de test a donc son propre
          // joueur, sinon la fenêtre anti-doublon de 20 min du bot bloquerait
          // légitimement les cas suivants.
          memberByIdentity: s => {
            const name = String(s?.playerName || 'X').split('#')[0];
            return { id: name.toLowerCase(), name, discordId: null, avatar: null, riotIds: [s?.playerName || ''] };
          },
        };
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
        class Client {
          constructor() {
            this.commands = new Collection();
            this.channels = { fetch: async id => ({ id, send: async payload => { sent.push({ channelId: id, payload }); return { id: 'm1' }; }, messages: { fetch: async () => null } }) };
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

const { notifyValorantGameStart, notifyValorantGameEnd } = loadBot();

let caseCounter = 0;
const session = (mode, extra = {}) => {
  caseCounter += 1;
  const player = `Joueur${caseCounter}`;
  return {
    active: true, playerName: `${player}#OLY`, memberId: player.toLowerCase(), mode,
    matchId: `match-${caseCounter}`, ...extra,
  };
};

const endResult = mode => ({
  result: 'completed', mode, kills: 19, deaths: 29, assists: 5,
  acs: 6125, hsPercent: 0, map: 'Summit', durationSeconds: 405,
});

(async () => {
  // ─── Deathmatch : AUCUN message, ni au début ni à la fin ──────────────────
  sent.length = 0;
  const dmStart = session('deathmatch');
  await notifyValorantGameStart(dmStart, { [dmStart.playerName]: dmStart });
  assert.deepEqual(sent, [], 'aucune carte « en game ! » en deathmatch');

  const dmEnd = session('deathmatch');
  dmEnd.active = false;
  dmEnd.result = endResult('deathmatch');
  await notifyValorantGameEnd([dmEnd]);
  assert.deepEqual(sent, [], 'aucune carte de fin en deathmatch');

  // La casse renvoyée par Riot ne doit pas rouvrir la porte.
  for (const mode of ['Deathmatch', 'DEATHMATCH', ' deathmatch ']) {
    sent.length = 0;
    const s = session(mode);
    await notifyValorantGameStart(s, { [s.playerName]: s });
    const e = session(mode); e.active = false; e.result = endResult(mode);
    await notifyValorantGameEnd([e]);
    assert.deepEqual(sent, [], `aucun message pour mode=${JSON.stringify(mode)}`);
  }

  // ─── Aucune file NON CLASSÉE ne doit notifier ─────────────────────────────
  // Le deathmatch n'est qu'un cas parmi d'autres : seul le compétitif compte.
  const casual = ['unrated', 'swiftplay', 'spikerush', 'hurm', 'ggteam', 'onefa', 'newmap', '', null];
  for (const mode of casual) {
    sent.length = 0;
    const s = session(mode);
    await notifyValorantGameStart(s, { [s.playerName]: s });
    assert.deepEqual(sent, [], `aucune carte de début pour mode=${JSON.stringify(mode)}`);

    const e = session(mode); e.active = false; e.result = endResult(mode);
    await notifyValorantGameEnd([e]);
    assert.deepEqual(sent, [], `aucune carte de fin pour mode=${JSON.stringify(mode)}`);
  }

  // ─── Compétitif : les messages partent toujours ───────────────────────────
  sent.length = 0;
  const compStart = session('competitive');
  await notifyValorantGameStart(compStart, { [compStart.playerName]: compStart });
  assert.equal(sent.length, 1, 'une game classée doit toujours être annoncée');
  assert.match(String(sent[0].payload.content), /en game/);

  sent.length = 0;
  const compEnd = session('competitive');
  compEnd.active = false;
  compEnd.result = { ...endResult('competitive'), result: 'win' };
  await notifyValorantGameEnd([compEnd]);
  assert.equal(sent.length, 1, 'la carte de fin d’une game classée doit partir');

  // La casse du compétitif ne doit pas, elle, faire perdre une notif.
  for (const mode of ['Competitive', 'COMPETITIVE', ' competitive ']) {
    sent.length = 0;
    const s = session(mode);
    await notifyValorantGameStart(s, { [s.playerName]: s });
    assert.equal(sent.length, 1, `mode=${JSON.stringify(mode)} doit être notifié`);
  }

  console.log('ranked-notify: seules les files classées notifient, sur Valorant comme sur LoL');
})().catch(error => { console.error(error); process.exit(1); });
