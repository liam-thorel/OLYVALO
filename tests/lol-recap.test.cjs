const assert = require('node:assert/strict');
const Module = require('node:module');

function loadRecap({ members, history, gains }) {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { FIREBASE_URL: 'x', ROSTER_URL: 'x' };
    if (request === './firebase.js') return { fbGet: async () => null, fbPut: async () => true };
    if (request === './roster.js') return { ensureRoster: async () => members };
    if (request === './recap-channel.js') return { getRecapChannelId: async () => null };
    if (request === './rank-tracking.js') return { allRankGains: async () => gains, resetRankGains: async () => {} };
    if (request === './stats.js') {
      const real = original('./stats.js', parent, isMain);
      return { ...real, historyFor: async (game, ids) => history[ids[0]] || [] };
    }
    if (request === 'discord.js') {
      return { EmbedBuilder: class {
        setColor(c) { this.color = c; return this; }
        setAuthor(a) { this.author = a.name; return this; }
        setDescription(d) { this.description = d; return this; }
        setTimestamp() { return this; }
      } };
    }
    return original(request, parent, isMain);
  };
  delete require.cache[require.resolve('../discord-bot/lol-recap.js')];
  const mod = require('../discord-bot/lol-recap.js');
  Module._load = original;
  return mod;
}

const game = (win, ts, extra = {}) => ({
  win, ts, queueId: 420, kills: 8, deaths: 4, assists: 11, cs: 210, ...extra,
});

(async () => {
  const { buildQueueRecapEmbeds } = loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }, { name: 'Rayhan', riotIds: ['c#1'] }],
    history: {
      'a#1': [
        game(true, 3, { rankAfter: { tier: 'EMERALD', division: 'II', lp: 64 }, position: 'jungle' }),
        game(false, 2, { position: 'middle' }),
      ],
      'c#1': [game(false, 3, { rankAfter: { tier: 'PLATINUM', division: 'IV', lp: 31 }, position: 'utility', cs: 38 })],
    },
    gains: [{ memberName: 'Liam', delta: 61 }, { memberName: 'Rayhan', delta: -22 }],
  });

  const embeds = await buildQueueRecapEmbeds('solo', 'daily');
  assert.equal(embeds.length, 1, 'LP et stats doivent tenir dans un seul embed');

  const [embed] = embeds;
  assert.equal(embed.color, 0x3fcf6b, 'bilan positif = vert');
  assert.match(embed.author, /🔵 Récap SoloQ · \+39 LP aujourd’hui/);
  assert.match(embed.description, /3 games · 33% WR collectif/);
  assert.match(embed.description, /🥇 \*\*Liam\*\* · `\+61 LP` · Émeraude 2 64 LP/);
  assert.match(embed.description, /🟥🟩/, 'frise en ordre chronologique');
  assert.match(embed.description, /🌲 Jungle/, 'le poste le plus joué doit apparaître');
  assert.match(embed.description, /🛡️ Support/);
  assert.doesNotMatch(embed.description, /#\d/, 'aucun Riot ID dans le récap');

  // ─── Flex utilise sa propre file et son propre libellé ────────────────────
  const flex = await loadRecap({
    members: [{ name: 'Nico', riotIds: ['b#1'] }],
    history: { 'b#1': [game(true, 1, { queueId: 440, position: 'top' }), game(true, 2, { queueId: 420 })] },
    gains: [{ memberName: 'Nico', delta: 15 }],
  }).buildQueueRecapEmbeds('flex', 'daily');
  assert.match(flex[0].author, /🟣 Récap Flex/);
  assert.match(flex[0].description, /1 game ·/, 'seule la game Flex doit compter');

  // ─── Journée négative, et joueur sans stats exploitables ──────────────────
  const down = await loadRecap({
    members: [{ name: 'Rayhan', riotIds: ['c#1'] }],
    history: { 'c#1': [] },
    gains: [{ memberName: 'Rayhan', delta: -22 }],
  }).buildQueueRecapEmbeds('solo', 'daily');
  assert.equal(down[0].color, 0xff5f6d);
  assert.match(down[0].description, /🥇 \*\*Rayhan\*\* · `-22 LP`/);
  assert.doesNotMatch(down[0].description, /KDA|CS/);

  // ─── Rien à dire ──────────────────────────────────────────────────────────
  const silent = await loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }], history: { 'a#1': [] }, gains: [],
  }).buildQueueRecapEmbeds('solo', 'daily');
  assert.deepEqual(silent, []);

  console.log('lol-recap: un seul embed par file, classement, rang et poste validés');
})().catch(error => { console.error(error); process.exit(1); });
