const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const roles = require(path.join(__dirname, '..', 'data', 'roles.json'));

function loadRecap({ members, history, gains }) {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { FIREBASE_URL: 'x', ROSTER_URL: 'x', ROLES_URL: 'x' };
    if (request === './firebase.js') return { fbGet: async () => null, fbPut: async () => true };
    if (request === './roster.js') return { ensureRoster: async () => members };
    if (request === './recap-channel.js') return { getRecapChannelId: async () => null };
    if (request === './rank-tracking.js') return { allRankGains: async () => gains, resetRankGains: async () => {} };
    if (request === './agent-roles.js') {
      const real = original('./agent-roles.js', parent, isMain);
      return { ...real, ensureAgentRoles: async () => ({ roles: roles.roles, labels: roles.labels }) };
    }
    if (request === './stats.js') {
      const real = original('./stats.js', parent, isMain);
      // rankedOnly n'est PAS stubé : c'est lui qu'on veut voir à l'œuvre.
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
  delete require.cache[require.resolve('../discord-bot/valo-daily-recap.js')];
  const mod = require('../discord-bot/valo-daily-recap.js');
  Module._load = original;
  return mod;
}

const game = (win, ts, extra = {}) => ({
  win, ts, mode: 'competitive', kills: 15, deaths: 12, assists: 6, acs: 200, hsPercent: 22, ...extra,
});

(async () => {
  // ─── Cas nominal ──────────────────────────────────────────────────────────
  const { buildValoRecapEmbeds } = loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }, { name: 'Mathis', riotIds: ['d#1'] }],
    history: {
      'a#1': [
        game(true, 3, { matchId: 'm3', tier: 19, rr: 88, champion: { name: 'Omen' } }),
        game(false, 2, { matchId: 'm2', champion: { name: 'Astra' } }),
        // Ne doit RIEN ajouter au récap : hors file classée.
        game(true, 4, { matchId: 'm4', mode: 'deathmatch', champion: { name: 'Reyna' } }),
        game(true, 5, { matchId: 'm5', mode: 'unrated', champion: { name: 'Omen' } }),
      ],
      'd#1': [game(false, 3, { matchId: 'm3', tier: 22, rr: 41, champion: { name: 'Reyna' } })],
    },
    gains: [{ memberName: 'Liam', riotId: 'a#1', delta: 52 }, { memberName: 'Mathis', riotId: 'd#1', delta: -38 }],
  });

  const embeds = await buildValoRecapEmbeds('daily');

  // Le défaut principal : deux messages pour la même chose.
  assert.equal(embeds.length, 1, 'RR et stats doivent tenir dans un seul embed');

  const [embed] = embeds;
  assert.equal(embed.color, 0x3fcf6b, 'bilan positif = vert');
  assert.match(embed.author, /Récap OLYCITY · \+14 RR aujourd’hui/);
  // 3 games classées comptées : le deathmatch et l'unrated d'Liam sont exclus.
  assert.match(embed.description, /3 games · 33% WR collectif/);
  assert.doesNotMatch(embed.description, /5 games|4 games/, 'aucune game hors classé dans le total');

  // Classement par RR, médailles, rang atteint.
  const podium = embed.description.indexOf('🥇 **Liam**');
  const second = embed.description.indexOf('🥈 **Mathis**');
  assert.ok(podium >= 0 && second > podium, 'les joueurs sont classés par RR gagné');
  assert.match(embed.description, /🥇 \*\*Liam\*\* · `\+52 RR` · Diamant 2 88 RR/);

  // Frise chronologique : la défaite (ts=2) précède la victoire (ts=3).
  assert.match(embed.description, /🟥🟩/, 'la frise doit suivre l’ordre des games');

  // Winrate individuel, en plus du collectif déjà présent en en-tête. Le
  // détail victoires-défaites accompagne le pourcentage : « 100% WR » sur une
  // seule game ne veut pas dire la même chose que sur vingt.
  assert.match(embed.description, /🟥🟩 · 50% WR \(1-1\)/, 'WR individuel de Liam, 1V-1D');
  assert.match(embed.description, /0% WR \(0-1\)/, 'WR individuel de Mathis, 0V-1D');

  // Le rôle demandé, et non l'agent.
  assert.match(embed.description, /🌫️ Contrôleur/);
  assert.match(embed.description, /⚔️ Duelliste/);

  // Le Riot ID brut ne doit plus apparaître.
  assert.doesNotMatch(embed.description, /#\d/, 'aucun Riot ID dans le récap');

  // ─── Journée négative ─────────────────────────────────────────────────────
  const down = await loadRecap({
    members: [{ name: 'Mathis', riotIds: ['d#1'] }],
    history: { 'd#1': [game(false, 1, { tier: 22, rr: 41, champion: { name: 'Reyna' } })] },
    gains: [{ memberName: 'Mathis', riotId: 'd#1', delta: -38 }],
  }).buildValoRecapEmbeds('daily');
  assert.equal(down[0].color, 0xff5f6d, 'bilan négatif = rouge');
  assert.match(down[0].author, /-38 RR/);

  // ─── Un joueur avec du RR mais sans stats exploitables ────────────────────
  // Le rapport de fin de game peut manquer : il doit quand même figurer au
  // classement, sans ligne de détail vide.
  const partial = await loadRecap({
    members: [{ name: 'Nico', riotIds: ['b#1'] }],
    history: { 'b#1': [] },
    gains: [{ memberName: 'Nico', riotId: 'b#1', delta: 12 }],
  }).buildValoRecapEmbeds('daily');
  assert.equal(partial.length, 1);
  assert.match(partial[0].description, /🥇 \*\*Nico\*\* · `\+12 RR`/);
  assert.doesNotMatch(partial[0].description, /KDA|ACS|HS/);
  // Aucune game jouée : pas de « 0% WR (0-0) » trompeur.
  assert.doesNotMatch(partial[0].description, /WR/, 'sans game, aucun winrate à afficher');

  // ─── Rien à dire : aucun message ──────────────────────────────────────────
  const silent = await loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }],
    history: { 'a#1': [] },
    gains: [],
  }).buildValoRecapEmbeds('daily');
  assert.deepEqual(silent, [], 'une période sans activité ne doit rien poster');

  // ─── Les trois cadences partagent la même mise en forme ───────────────────
  const weekly = await loadRecap({
    members: [{ name: 'Liam', riotIds: ['a#1'] }],
    history: { 'a#1': [game(true, 1, { champion: { name: 'Omen' } })] },
    gains: [{ memberName: 'Liam', riotId: 'a#1', delta: 20 }],
  }).buildValoRecapEmbeds('weekly');
  assert.match(weekly[0].author, /cette semaine/);

  // ─── Un membre, deux comptes ──────────────────────────────────────────────
  // Le défaut corrigé : les deux comptes étaient fondus en une ligne. Le rang
  // affiché était celui de la dernière partie jouée — le smurf en Fer faisait
  // passer un Immortel pour un Fer — et le winrate mêlait les deux niveaux.
  const smurf = await loadRecap({
    members: [{ name: 'Rayhan', riotIds: ['main#OLY', 'smurf#EUW'] }],
    history: {
      'main#OLY': [
        game(true, 10, { matchId: 'p1', account: 'main#OLY', tier: 21, rr: 70, champion: { name: 'Omen' } }),
        game(true, 11, { matchId: 'p2', account: 'main#OLY', champion: { name: 'Omen' } }),
      ],
      // Joué APRÈS le compte principal : c'est ce rang-là qui écrasait l'autre.
      'smurf#EUW': [game(false, 12, { matchId: 'p3', account: 'smurf#EUW', tier: 3, rr: 12, acs: 340, champion: { name: 'Reyna' } })],
    },
    gains: [
      { memberName: 'Rayhan', riotId: 'main#OLY', delta: 44 },
      { memberName: 'Rayhan', riotId: 'smurf#EUW', delta: -17 },
    ],
  }).buildValoRecapEmbeds('daily');

  assert.match(smurf[0].description, /\*\*Rayhan \(main\)\*\* · `\+44 RR` · Ascendant 1 70 RR/, 'le compte principal garde son rang et son RR');
  assert.match(smurf[0].description, /\*\*Rayhan \(smurf\)\*\* · `-17 RR` · Fer 1 12 RR/, 'le smurf a sa propre ligne');
  assert.match(smurf[0].description, /100% WR \(2-0\)/, 'winrate du compte principal, sans la défaite du smurf');
  assert.match(smurf[0].description, /0% WR \(0-1\)/, 'winrate du smurf, sans les victoires du principal');
  // L'ACS aussi est propre au compte : 340 sur le smurf, 200 sur le principal.
  assert.match(smurf[0].description, /🟩🟩 · 100% WR \(2-0\) · 1\.75 KDA · 200 ACS/, 'stats du compte principal');
  assert.match(smurf[0].description, /🟥 · 0% WR \(0-1\) · 1\.75 KDA · 340 ACS/, 'stats du smurf, non moyennées avec le principal');
  // Le total collectif, lui, reste celui du membre : rien n'est compté deux fois.
  assert.match(smurf[0].author, /\+27 RR/);
  assert.match(smurf[0].description, /3 games · 67% WR collectif/);

  // ─── Deux comptes au même pseudo : le tag devient nécessaire ──────────────
  const sameName = await loadRecap({
    members: [{ name: 'Nico', riotIds: ['Nico#EUW', 'Nico#OLY'] }],
    history: {
      'Nico#EUW': [game(true, 1, { matchId: 'q1', account: 'Nico#EUW', champion: { name: 'Omen' } })],
      'Nico#OLY': [game(false, 2, { matchId: 'q2', account: 'Nico#OLY', champion: { name: 'Reyna' } })],
    },
    gains: [{ memberName: 'Nico', riotId: 'Nico#EUW', delta: 19 }],
  }).buildValoRecapEmbeds('daily');
  assert.match(sameName[0].description, /\*\*Nico \(Nico#EUW\)\*\*/, 'pseudos identiques : on affiche le tag');
  assert.match(sameName[0].description, /\*\*Nico \(Nico#OLY\)\*\*/);

  // ─── Un seul compte actif : le nom du membre suffit ───────────────────────
  // Le multi-comptes ne doit pas alourdir le cas courant.
  assert.match(embed.description, /🥇 \*\*Liam\*\* ·/, 'un seul compte actif : pas de parenthèse');

  console.log('valo-recap: un seul embed, classement, rang, frise et rôle validés');
})().catch(error => { console.error(error); process.exit(1); });
