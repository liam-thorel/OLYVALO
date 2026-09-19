const assert = require('node:assert/strict');
const Module = require('node:module');

// Messages réellement envoyés à Discord pendant le test.
const sent = [];
// Points de participation réellement crédités.
const credited = [];
// Paris remboursés / tranchés pendant le test.
const refunded = [];
const resolved = [];
// Parties pour lesquelles un pari est ouvert — la production n'en ouvre qu'en
// file classée, le stub doit refléter ça plutôt que d'en offrir à toutes.
const OPEN_ROUNDS = new Set();

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
            return { id: name.toLowerCase(), name, discordId: `discord-${name.toLowerCase()}`, avatar: null, riotIds: [s?.playerName || ''] };
          },
        };
      case './trackers.js':
        return { startTrackerSync: () => {}, loadTrackersOnce: async () => ({}), trackersForPlayerGame: () => [{ channelId: 'salon-1' }] };
      case './discovered.js': return { recordDiscovered: async () => {} };
      case './build-image.js': return { buildItemsImage: async () => null };
      case './betting.js':
        return {
          openRound: async () => ({ key: 'k', round: {}, isNew: false }),
          closeRound: async () => null,
          resolveRound: async (key, outcome) => { resolved.push({ key, outcome }); return { round: {}, results: [] }; },
          cancelRound: async key => { refunded.push(key); return {}; },
          roundsForMatch: async (game, matchId) => (OPEN_ROUNDS.has(matchId)
            ? [[`k-${matchId}`, { channelId: 'salon-1', messageId: null }]] : []),
          placeBet: async () => ({ ok: false }),
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
      case './wallet.js':
        return {
          rewardForGamePlayed: async (userId, amount) => { credited.push({ userId, amount }); return amount; },
        };
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
        // Un vrai EmbedBuilder, et pas le proxy fourre-tout : le bloc « Paris »
        // part dans une description d'embed, invisible autrement.
        class EmbedBuilder {
          setColor() { return this; } setTimestamp() { return this; } setThumbnail() { return this; }
          setAuthor(a) { this.author = a?.name; return this; }
          setDescription(d) { this.description = d; return this; }
          addFields(...f) { this.fields = f.flat(); return this; }
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

const { notifyValorantGameStart, notifyValorantGameEnd, notifyLolGameStart, notifyLolGameEnd } = loadBot();

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

  // L'en-tête annonce le résultat, plus le simple fait d'être plusieurs.
  const solo = String(sent[0].payload.content);
  assert.match(solo, /🏆 \*\*Victoire\*\* pour \*\*Joueur\d+\*\*/);
  assert.doesNotMatch(solo, /STACK OLYCITY/, 'l’ancienne bannière ne doit plus partir');

  // Un stack : les deux joueurs sont nommés dans le même en-tête.
  sent.length = 0;
  const stackA = session('competitive');
  const stackB = session('competitive');
  stackB.matchId = stackA.matchId; // même game
  [stackA, stackB].forEach(s2 => {
    s2.active = false;
    s2.result = { ...endResult('competitive'), result: 'loss', matchId: stackA.matchId };
  });
  await notifyValorantGameEnd([stackA, stackB]);
  assert.equal(sent.length, 1, 'un stack tient dans un seul message');
  assert.match(
    String(sent[0].payload.content),
    /💀 \*\*Défaite\*\* pour \*\*Joueur\d+ et Joueur\d+\*\*/,
    'les deux joueurs sont nommés, avec le résultat',
  );

  // La casse du compétitif ne doit pas, elle, faire perdre une notif.
  for (const mode of ['Competitive', 'COMPETITIVE', ' competitive ']) {
    sent.length = 0;
    const s = session(mode);
    await notifyValorantGameStart(s, { [s.playerName]: s });
    assert.equal(sent.length, 1, `mode=${JSON.stringify(mode)} doit être notifié`);
  }

  // ─── LoL : seules les files classées (420 Solo/Duo, 440 Flex) ────────────
  // Le filtrage vit déjà dans live/lol-watcher.js, mais un poste resté sur une
  // vieille version du script pourrait publier autre chose : le bot doit s'en
  // protéger lui-même.
  const lolSession = (queueId, extra = {}) => {
    caseCounter += 1;
    const player = `Invoc${caseCounter}`;
    return {
      active: true, playerName: `${player}#EUW`, memberId: player.toLowerCase(),
      matchId: `lol-${caseCounter}`, queueId,
      champion: { name: 'Ahri', image: '' }, matchup: null, rank: null,
      position: 'MIDDLE', region: 'euw1', ...extra,
    };
  };
  const lolEndResult = queueId => ({
    win: true, queueId, kills: 9, deaths: 2, assists: 14, cs: 210,
    champion: { name: 'Ahri', image: '' }, durationLabel: '28:14',
    items: [], rankBefore: null, rankAfter: null, position: 'MIDDLE',
  });

  // 450 = ARAM, 400 = Normale draft, 830/840/850 = Co-op vs IA, 0 = Practice Tool.
  for (const queueId of [450, 400, 430, 830, 840, 850, 900, 1700, 0]) {
    sent.length = 0;
    const s = lolSession(queueId);
    await notifyLolGameStart(s, { [s.playerName]: s });
    assert.deepEqual(sent, [], `aucune carte de début LoL pour queueId=${queueId}`);

    const e = lolSession(queueId); e.active = false; e.result = lolEndResult(queueId);
    await notifyLolGameEnd([e]);
    assert.deepEqual(sent, [], `aucune carte de fin LoL pour queueId=${queueId}`);
  }

  for (const queueId of [420, 440]) {
    sent.length = 0;
    const s = lolSession(queueId);
    await notifyLolGameStart(s, { [s.playerName]: s });
    assert.equal(sent.length, 1, `la file classée LoL ${queueId} doit être annoncée`);

    sent.length = 0;
    const e = lolSession(queueId); e.active = false; e.result = lolEndResult(queueId);
    await notifyLolGameEnd([e]);
    assert.equal(sent.length, 1, `la carte de fin LoL doit partir pour la file ${queueId}`);
  }

  // Ancienne version du script live : pas de queueId sur la session de début.
  // Elle ne publie déjà que du classé, donc la notif doit continuer à partir —
  // sinon la mise à jour du bot ferait taire tous les postes pas encore à jour.
  sent.length = 0;
  const legacy = lolSession(undefined);
  delete legacy.queueId;
  await notifyLolGameStart(legacy, { [legacy.playerName]: legacy });
  assert.equal(sent.length, 1, 'un queueId absent ne doit pas faire sauter la notif');

  // ─── Points de participation hors file classée ─────────────────────────────
  // Ces modes ne doivent RIEN envoyer sur Discord, mais ils rapportent
  // désormais des points : une soirée ARAM occupe autant de temps qu'une
  // classée.
  const creditsFor = async (session) => {
    sent.length = 0; credited.length = 0;
    await notifyValorantGameEnd([session]);
    return { sent: [...sent], credited: [...credited] };
  };

  const dm = session('deathmatch');
  dm.active = false; dm.result = endResult('deathmatch');
  let run = await creditsFor(dm);
  assert.deepEqual(run.sent, [], 'toujours aucun message en deathmatch');
  assert.equal(run.credited.length, 1, 'mais le joueur est crédité');
  assert.equal(run.credited[0].amount, 50, 'deathmatch = 50 points');

  const unrated = session('unrated');
  unrated.active = false; unrated.result = endResult('unrated');
  run = await creditsFor(unrated);
  assert.deepEqual(run.sent, [], 'aucun message en non classée');
  assert.equal(run.credited[0].amount, 75, 'unrated = 75 points');

  const swift = session('swiftplay');
  swift.active = false; swift.result = endResult('swiftplay');
  run = await creditsFor(swift);
  assert.equal(run.credited[0].amount, 50, 'les autres modes = 50 points');

  // ─── LoL hors file classée ──────────────────────────────────────────────────
  const lolCredits = async (queueId) => {
    sent.length = 0; credited.length = 0;
    const s2 = lolSession(queueId);
    s2.active = false;
    s2.result = { ...lolEndResult(queueId), win: true };
    await notifyLolGameEnd([s2]);
    return { sent: [...sent], credited: [...credited] };
  };

  let lolRun = await lolCredits(450); // ARAM
  assert.deepEqual(lolRun.sent, [], 'aucun message en ARAM');
  assert.equal(lolRun.credited[0]?.amount, 50, 'ARAM = 50 points');

  lolRun = await lolCredits(400); // Normale draft
  assert.deepEqual(lolRun.sent, [], 'aucun message en normale');
  assert.equal(lolRun.credited[0]?.amount, 100, 'file non classée LoL = 100 points');

  lolRun = await lolCredits(1700); // Arena
  assert.equal(lolRun.credited[0]?.amount, 50, 'Arena = 50 points');

  // ─── Le classé reste le plus rentable ───────────────────────────────────────
  sent.length = 0; credited.length = 0;
  const rankedWin = session('competitive');
  rankedWin.active = false;
  rankedWin.result = { ...endResult('competitive'), result: 'win' };
  await notifyValorantGameEnd([rankedWin]);
  assert.equal(sent.length, 1, 'une classée est toujours annoncée');
  assert.equal(credited[0].amount, 150, 'classée gagnée = 150 points');

  sent.length = 0; credited.length = 0;
  const rankedLoss = session('competitive');
  rankedLoss.active = false;
  rankedLoss.result = { ...endResult('competitive'), result: 'loss' };
  await notifyValorantGameEnd([rankedLoss]);
  assert.equal(credited[0].amount, 50, 'classée perdue = 50 points');

  // ─── Match nul ─────────────────────────────────────────────────────────────
  // Une égalité n'est pas une défaite. Elle valait pourtant le montant d'une
  // défaite, parce que l'issue passait par un booléen `won` : « ni gagné » y
  // devient mécaniquement « perdu ».
  sent.length = 0; credited.length = 0; refunded.length = 0; resolved.length = 0;
  const nul = session('competitive');
  nul.active = false;
  nul.result = { ...endResult('competitive'), result: 'draw' };
  OPEN_ROUNDS.add(nul.matchId);
  await notifyValorantGameEnd([nul]);

  assert.equal(credited[0].amount, 100, 'classée nulle = 100 points, entre la victoire et la défaite');

  // Aucun pari ne peut être tranché sans gagnant : on rembourse.
  assert.deepEqual(resolved, [], 'aucun pari tranché sur une égalité');
  assert.equal(refunded.length, 1, 'les mises sont remboursées');

  // Et on le DIT. Une égalité et une partie sans résultat remboursaient toutes
  // deux, mais le message annonçait « résultat indisponible » dans les deux
  // cas : une égalité passait pour un raté du bot.
  const messageNul = sent.map(entry => JSON.stringify(entry.payload)).join('\n');
  assert.match(messageNul, /égalité, mises remboursées/i, 'le remboursement est annoncé comme une égalité');
  assert.doesNotMatch(messageNul, /résultat indisponible/, 'et pas comme un résultat perdu');
  assert.match(messageNul, /Égalité/, 'la carte de fin de partie annonce bien une égalité');

  // Une partie vraiment sans résultat garde son message d'origine.
  sent.length = 0; refunded.length = 0;
  const sansResultat = session('competitive');
  sansResultat.active = false;
  sansResultat.result = { ...endResult('competitive'), result: 'unknown' };
  OPEN_ROUNDS.add(sansResultat.matchId);
  await notifyValorantGameEnd([sansResultat]);
  assert.equal(refunded.length, 1, 'remboursé aussi');
  assert.match(sent.map(e => JSON.stringify(e.payload)).join('\n'), /résultat indisponible/);

  console.log('ranked-notify: seules les files classées notifient, et une égalité n’est pas une défaite');
})().catch(error => { console.error(error); process.exit(1); });
