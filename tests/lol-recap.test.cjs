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
      return { ...real, historyFor: async (game, ids) => ids.flatMap(id => history[id] || []) };
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
    gains: [{ memberName: 'Liam', riotId: 'a#1', delta: 61 }, { memberName: 'Rayhan', riotId: 'c#1', delta: -22 }],
  });

  const embeds = await buildQueueRecapEmbeds('solo', 'daily');
  assert.equal(embeds.length, 1, 'LP et stats doivent tenir dans un seul embed');

  const [embed] = embeds;
  assert.equal(embed.color, 0x3fcf6b, 'bilan positif = vert');
  assert.match(embed.author, /🔵 Récap SoloQ · \+39 LP aujourd’hui/);
  assert.match(embed.description, /3 games · 33% WR collectif/);
  assert.match(embed.description, /🥇 \*\*Liam\*\* · `\+61 LP` · Émeraude 2 64 LP/);
  assert.match(embed.description, /🟥🟩/, 'frise en ordre chronologique');

  // Winrate individuel, comme sur le récap Valorant. Le détail
  // victoires-défaites accompagne le pourcentage : « 100% WR » sur une seule
  // game ne veut pas dire la même chose que sur vingt.
  assert.match(embed.description, /🟥🟩 · 50% WR \(1-1\)/, 'WR individuel de Liam, 1V-1D');
  assert.match(embed.description, /0% WR \(0-1\)/, 'WR individuel de Rayhan, 0V-1D');

  assert.match(embed.description, /🌲 Jungle/, 'le poste le plus joué doit apparaître');
  assert.match(embed.description, /🛡️ Support/);
  assert.doesNotMatch(embed.description, /#\d/, 'aucun Riot ID dans le récap');

  // ─── Flex utilise sa propre file et son propre libellé ────────────────────
  const flex = await loadRecap({
    members: [{ name: 'Nico', riotIds: ['b#1'] }],
    history: { 'b#1': [game(true, 1, { queueId: 440, position: 'top' }), game(true, 2, { queueId: 420 })] },
    gains: [{ memberName: 'Nico', riotId: 'b#1', delta: 15 }],
  }).buildQueueRecapEmbeds('flex', 'daily');
  assert.match(flex[0].author, /🟣 Récap Flex/);
  assert.match(flex[0].description, /1 game ·/, 'seule la game Flex doit compter');

  // ─── Journée négative, et joueur sans stats exploitables ──────────────────
  const down = await loadRecap({
    members: [{ name: 'Rayhan', riotIds: ['c#1'] }],
    history: { 'c#1': [] },
    gains: [{ memberName: 'Rayhan', riotId: 'c#1', delta: -22 }],
  }).buildQueueRecapEmbeds('solo', 'daily');
  assert.equal(down[0].color, 0xff5f6d);
  assert.match(down[0].description, /🥇 \*\*Rayhan\*\* · `-22 LP`/);
  assert.doesNotMatch(down[0].description, /KDA|CS/);

  // ─── Rien à dire ──────────────────────────────────────────────────────────
  const silent = await loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }], history: { 'a#1': [] }, gains: [],
  }).buildQueueRecapEmbeds('solo', 'daily');
  assert.deepEqual(silent, []);

  // ─── Un membre, deux comptes ────────────────────────────────────────────
  // Même défaut que côté Valorant : les deux comptes tenaient sur une ligne, avec
  // le rang de la dernière partie jouée et un winrate mélangeant les deux niveaux.
  const smurf = await loadRecap({
    members: [{ name: 'Rayhan', riotIds: ['main#OLY', 'smurf#EUW'] }],
    history: {
      'main#OLY': [
        game(true, 10, { account: 'main#OLY', rankAfter: { tier: 'DIAMOND', division: 'I', lp: 55 }, position: 'jungle' }),
        game(true, 11, { account: 'main#OLY', position: 'jungle' }),
      ],
      // Joué APRÈS le compte principal : c'est ce rang-là qui écrasait l'autre.
      'smurf#EUW': [game(false, 12, { account: 'smurf#EUW', rankAfter: { tier: 'SILVER', division: 'III', lp: 8 }, position: 'top', cs: 90 })],
    },
    gains: [
      { memberName: 'Rayhan', riotId: 'main#OLY', delta: 48 },
      { memberName: 'Rayhan', riotId: 'smurf#EUW', delta: -15 },
    ],
  }).buildQueueRecapEmbeds('solo', 'daily');

  assert.match(smurf[0].description, /\*\*Rayhan \(main\)\*\* · `\+48 LP` · Diamant 1 55 LP/, 'le compte principal garde son rang et son LP');
  assert.match(smurf[0].description, /\*\*Rayhan \(smurf\)\*\* · `-15 LP` · Argent 3 8 LP/, 'le smurf a sa propre ligne');
  // Le CS aussi est propre au compte : 210 sur le principal, 90 sur le smurf.
  assert.match(smurf[0].description, /🟩🟩 · 100% WR \(2-0\) · 4\.75 KDA · 210 CS/, 'stats du compte principal');
  assert.match(smurf[0].description, /🟥 · 0% WR \(0-1\) · 4\.75 KDA · 90 CS/, 'stats du smurf, non moyennées avec le principal');
  // Le total collectif, lui, reste celui du membre : rien n'est compté deux fois.
  assert.match(smurf[0].author, /\+33 LP/);
  assert.match(smurf[0].description, /3 games · 67% WR collectif/);

  // ─── Deux comptes au même pseudo : le tag devient nécessaire ──────────────
  const sameName = await loadRecap({
    members: [{ name: 'Nico', riotIds: ['Nico#EUW', 'Nico#OLY'] }],
    history: {
      'Nico#EUW': [game(true, 1, { account: 'Nico#EUW', position: 'top' })],
      'Nico#OLY': [game(false, 2, { account: 'Nico#OLY', position: 'bottom' })],
    },
    gains: [{ memberName: 'Nico', riotId: 'Nico#EUW', delta: 21 }],
  }).buildQueueRecapEmbeds('solo', 'daily');
  assert.match(sameName[0].description, /\*\*Nico \(Nico#EUW\)\*\*/, 'pseudos identiques : on affiche le tag');
  assert.match(sameName[0].description, /\*\*Nico \(Nico#OLY\)\*\*/);

  // ─── Un seul compte actif : le nom du membre suffit ─────────────────────
  assert.match(embed.description, /🥇 \*\*Liam\*\* ·/, 'un seul compte actif : pas de parenthèse');

  console.log('lol-recap: un seul embed par file, classement, rang et poste validés');
})().catch(error => { console.error(error); process.exit(1); });
