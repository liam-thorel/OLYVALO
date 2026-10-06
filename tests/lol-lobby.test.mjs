import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { formatMasteryPoints, tierLabel, soloWinrate, lobbyTeams, lobbyHTML, lobbyOf, championIcons, championIconById } from '../js/lol-live-utils.mjs';

const require = createRequire(import.meta.url);
const { participantsFromGameflow, masteryFor, collectLobby } = require('../live/lol-lobby.js');

const MOI = 'p-moi';
const session = {
  gameData: {
    teamOne: [
      { puuid: 'p-a', championId: 1, selectedPosition: 'MIDDLE' },
      { puuid: 'p-b', championId: 2, selectedPosition: 'TOP' },
    ],
    teamTwo: [
      { puuid: MOI, championId: 0, selectedPosition: 'UTILITY' }, // champion dans les sélections
      { puuid: '', championId: 4 }, // joueur masqué
    ],
    playerChampionSelections: [{ puuid: MOI, championId: 3 }],
  },
};

test('participants : équipes, alliés, champion et poste', () => {
  const players = participantsFromGameflow(session, MOI);
  assert.equal(players.length, 4);
  const moi = players.find(player => player.puuid === MOI);
  assert.equal(moi.championId, 3, 'champion repris des sélections');
  assert.equal(moi.self, true);
  assert.equal(moi.ally, true);
  assert.equal(moi.team, 'CHAOS');
  assert.equal(moi.position, 'support');
  assert.equal(players.find(player => player.puuid === 'p-a').ally, false);
  assert.equal(players.find(player => player.puuid === 'p-a').position, 'mid');
  assert.ok(players.some(player => !player.puuid && player.championId === 4), 'un joueur masqué garde son champion');
  // Sans PUUID local, on ne sait pas quelle équipe est la nôtre : on ne devine pas.
  assert.equal(participantsFromGameflow(session, '').every(player => player.ally === null), true);
});

test('maîtrise : points du champion joué, quelle que soit la forme de la réponse', () => {
  const list = [{ championId: 3, championPoints: 245678, championLevel: 31 }, { championId: 9, championPoints: 10 }];
  assert.deepEqual(masteryFor(list, 3), { points: 245678, level: 31 });
  assert.deepEqual(masteryFor({ masteries: list }, 3), { points: 245678, level: 31 });
  assert.equal(masteryFor(list, 42), null, 'jamais joué : rien plutôt que zéro');
  assert.equal(masteryFor(null, 3), null);
});

test('collecte : rang, maîtrise, rôle principal, et repli d’un endpoint à l’autre', async () => {
  const calls = [];
  const soloGame = role => ({ queueId: 420, participants: [{ championId: 3, timeline: { lane: role, role: 'SOLO' }, stats: { win: true } }] });
  const responses = {
    [`/lol-summoner/v2/summoners/puuid/${MOI}`]: { gameName: 'Liam', tagLine: 'OLY', summonerId: 77 },
    [`/lol-ranked/v1/ranked-stats/${MOI}`]: { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'CHALLENGER', division: 'I', leaguePoints: 2728, wins: 669, losses: 592 }] },
    // L'endpoint par PUUID ne répond pas : repli sur l'inventaire.
    '/lol-collections/v1/inventories/77/champion-mastery': [{ championId: 3, championPoints: 245678, championLevel: 31 }],
    [`/lol-match-history/v1/products/lol/${MOI}/matches?begIndex=0&endIndex=19`]: { games: { games: [soloGame('JUNGLE'), soloGame('JUNGLE'), soloGame('TOP')] } },
  };
  const lcu = async endpoint => {
    calls.push(endpoint);
    return endpoint in responses ? { ok: true, data: responses[endpoint] } : { ok: false };
  };
  const onlyMe = { gameData: { teamTwo: [{ puuid: MOI, championId: 3 }] } };
  const [moi] = await collectLobby({ lcu, session: onlyMe, myPuuid: MOI, champions: { 3: { name: 'Quinn', image: 'https://ddragon/quinn.png' } } });

  assert.equal(moi.riotId, 'Liam#OLY');
  assert.equal(moi.championId, 3, 'le numéro du champion part toujours');
  assert.deepEqual(moi.champion, { name: 'Quinn', image: 'https://ddragon/quinn.png' });
  assert.equal(moi.rank.tier, 'CHALLENGER');
  assert.equal(moi.rank.lp, 2728);
  assert.equal(moi.rank.games, 1261);
  assert.equal(moi.rank.winRate, 53);
  assert.deepEqual(moi.mastery, { points: 245678, level: 31 });
  assert.equal(moi.mainRole, 'jungle', 'le rôle le plus joué en SoloQ');
  assert.ok(calls.includes(`/lol-champion-mastery/v1/${MOI}/champion-mastery`), 'l’endpoint par PUUID est tenté d’abord');
});

test('collecte : si le client n’expose pas la maîtrise, on n’insiste pas pour les neuf autres', async () => {
  const calls = [];
  const lcu = async endpoint => { calls.push(endpoint); return { ok: false }; };
  const ten = { gameData: { teamOne: Array.from({ length: 5 }, (_, i) => ({ puuid: `a${i}`, championId: 1 })),
    teamTwo: Array.from({ length: 5 }, (_, i) => ({ puuid: `b${i}`, championId: 2 })) } };
  const players = await collectLobby({ lcu, session: ten, myPuuid: 'a0' });
  assert.equal(players.length, 10, 'les dix joueurs restent affichés, même sans données');
  assert.equal(calls.filter(endpoint => endpoint.includes('champion-mastery')).length, 1);
});

test('affichage : maîtrise en points, rang, winrate', () => {
  assert.equal(formatMasteryPoints(950), '950');
  assert.equal(formatMasteryPoints(245678), '246k');
  assert.equal(formatMasteryPoints(1234567), '1,2M');
  assert.equal(formatMasteryPoints(999700), '1M', 'pas de « 1000k »');
  assert.equal(formatMasteryPoints(undefined), '');
  assert.equal(tierLabel({ tier: 'CHALLENGER', division: 'I' }), 'Challenger', 'pas de division au-dessus de Master');
  assert.equal(tierLabel({ tier: 'GOLD', division: 'II' }), 'Gold II');
  assert.equal(tierLabel({ tier: 'NONE' }), null);
  assert.equal(tierLabel(null), null);
  assert.deepEqual(soloWinrate({ wins: 669, losses: 592 }), { percent: 53, games: 1261 });
  assert.equal(soloWinrate({ wins: 0, losses: 0 }), null);
});

test('affichage : notre équipe d’abord, dans l’ordre des postes', () => {
  const players = [
    { puuid: 'e1', ally: false, position: 'top' },
    { puuid: 'm2', ally: true, position: 'support' },
    { puuid: 'm1', ally: true, position: 'top' },
    { puuid: 'm3', ally: true, position: '' },
  ];
  const [nous, eux] = lobbyTeams(players);
  assert.equal(nous.label, 'Ton équipe');
  assert.deepEqual(nous.players.map(player => player.puuid), ['m1', 'm2', 'm3']);
  assert.equal(eux.label, 'Adversaires');
  // Équipe inconnue : bleue et rouge, sans prétendre savoir laquelle est la nôtre.
  const [bleue, rouge] = lobbyTeams([{ team: 'ORDER' }, { team: 'CHAOS' }]);
  assert.equal(bleue.label, 'Équipe bleue');
  assert.equal(rouge.label, 'Équipe rouge');
});

test('affichage : membres OLYCITY repérés, et rien d’injecté depuis Firebase', () => {
  const group = {
    players: [{
      puuid: 'p-moi',
      lobby: { players: [
        { puuid: 'p-moi', self: true, ally: true, riotId: 'Liam#OLY', champion: { name: 'Quinn', image: 'https://x/q.png' },
          rank: { tier: 'GOLD', division: 'II', lp: 45, wins: 30, losses: 20 }, mastery: { points: 245678 }, mainRole: 'jungle' },
        { puuid: 'p-x', ally: false, riotId: '<img src=x onerror=alert(1)>#EUW', champion: { name: 'Ahri' } },
      ] },
    }],
  };
  assert.equal(lobbyOf(group).length, 2);
  const html = lobbyHTML(group);
  assert.match(html, /class="lol-lobby-player is-olycity is-self"/);
  assert.match(html, /<b class="lol-mastery">246k<\/b>/);
  assert.match(html, /title="Maîtrise sur Quinn : 245 678 points"|title="Maîtrise sur Quinn : 245[\s  ]678 points"/);
  assert.match(html, /Gold II/);
  assert.match(html, /45 LP/);
  assert.match(html, /60%/);
  assert.match(html, /Jungle/);
  assert.match(html, /<small>Quinn<span class="lol-lobby-role-inline"> · Jungle<\/span><\/small>/, 'champion et rôle sous le pseudo');
  assert.doesNotMatch(html, /<img src=x/, 'un pseudo piégé ne devient pas du HTML');
  assert.match(html, /Non classé/, 'un joueur sans rang le dit');
  assert.equal(lobbyHTML({ players: [{ puuid: 'p' }] }), '', 'rien tant que la collecte n’est pas arrivée');
});

test('câblage : le script publie le lobby, la page Live l’affiche', () => {
  const watcher = readFileSync(new URL('../live/lol-watcher.js', import.meta.url), 'utf8');
  assert.match(watcher, /if \(metadata\.gameFamily !== 'tft'\) ensureLobby\(sessionRes\.data, myPuuid, champions\);/);
  assert.match(watcher, /lobby: metadata\.gameFamily !== 'tft' && lobbyPlayers\?\.length \? \{ players: lobbyPlayers \} : null,/);
  assert.match(watcher, /lobbyMatchId = '';\n\s*lobbyPlayers = null;/, 'remis à zéro entre deux parties');
  const pages = readFileSync(new URL('../js/lol-pages.mjs', import.meta.url), 'utf8');
  assert.match(pages, /\$\{lobbyHTML\(group\)\}/);
  const manifest = JSON.parse(readFileSync(new URL('../live/update-manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('lol-lobby.js'), 'le module part avec la mise à jour');
});

test('icônes : Data Dragon d’abord, le numéro du champion en secours', () => {
  const cdragon = id => `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;
  assert.equal(championIconById(133), cdragon(133));
  assert.equal(championIconById(0), '');
  assert.equal(championIconById('abc'), '');

  assert.deepEqual(championIcons({ championId: 133, champion: { image: 'https://ddragon/quinn.png' } }),
    { src: 'https://ddragon/quinn.png', fallback: cdragon(133) }, 'si Data Dragon ne charge pas, on bascule');
  assert.deepEqual(championIcons({ championId: 133, champion: null }),
    { src: cdragon(133), fallback: '' }, 'liste des champions indisponible côté script : l’icône vient du numéro');
  assert.deepEqual(championIcons({ champion: { image: 'https://ddragon/x.png' } }), { src: 'https://ddragon/x.png', fallback: '' });
  assert.deepEqual(championIcons({}), { src: '', fallback: '' });

  const html = lobbyHTML({ players: [{ puuid: 'p', lobby: { players: [{ puuid: 'p', ally: true, championId: 133, champion: null }] } }] });
  assert.match(html, new RegExp(`<img src="${cdragon(133).replace(/[.?]/g, '\\$&')}"`), 'icône même sans liste Data Dragon');
  const withBoth = lobbyHTML({ players: [{ puuid: 'p', lobby: { players: [{ puuid: 'p', ally: true, championId: 133, champion: { name: 'Quinn', image: 'https://ddragon/quinn.png' } }] } }] });
  assert.match(withBoth, /data-fallback="https:\/\/raw\.communitydragon\.org\//);

  const pages = readFileSync(new URL('../js/lol-pages.mjs', import.meta.url), 'utf8');
  assert.match(pages, /container\.addEventListener\('error', event => \{/, 'erreurs d’image écoutées');
  assert.match(pages, /\}, true\);/, 'en phase de capture : elles ne remontent pas');
  assert.match(pages, /bindChampionIconFallback\(el\);/);
});
