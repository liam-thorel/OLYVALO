const { ROSTER_URL } = require('./config.js');
const { fbGet } = require('./firebase.js');

const REFRESH_MS = 5 * 60 * 1000;

let members = [];       // [{ id, name, avatar, riotIds: ['name#tag', ...], puuids: [...] }]
let riotIdIndex = {};   // 'name#tag' lowercase -> member
let memberIdIndex = {}; // id de membre -> member
let puuidIndex = {};    // puuid -> member
let lastFetch = 0;

// Les avatars du roster pointent vers le CDN Discord (cdn.discordapp.com/avatars/{id}/...) —
// on récupère cet ID pour pouvoir créditer directement le joueur qui vient de jouer.
function extractDiscordId(avatarUrl) {
  const match = String(avatarUrl || '').match(/cdn\.discordapp\.com\/avatars\/(\d+)\//);
  return match ? match[1] : null;
}

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

// L'identité des membres vient de roster.json (les 5 du roster) + de
// rosterOverlay/members (ajoutés depuis l'admin). Les comptes Riot, eux,
// viennent TOUJOURS de rosterOverlay/accounts — y compris pour les 5 du
// roster (migrés une fois depuis riot/smurfs) — donc tous supprimables/
// modifiables de la même façon depuis l'admin, sans compte "principal" figé.
/**
 * Comptes déclarés directement dans roster.json (`riot` + `smurfs`).
 *
 * Le bot ne lisait QUE rosterOverlay/accounts : mettre à jour le Riot ID d'un
 * membre dans roster.json corrigeait l'affichage du site — qui, lui, lit bien
 * ces champs (js/history-utils.mjs) — sans que le bot ne le voie jamais. Un
 * joueur renommé disparaissait donc silencieusement du suivi malgré une
 * correction qui semblait faite.
 */
function riotIdsFromRoster(player) {
  return [player?.riot, ...(player?.smurfs || [])]
    .filter(account => account?.name)
    .map(account => (account.tag ? `${account.name}#${account.tag}` : String(account.name)));
}

function indexRoster(roster, overlay) {
  const overlayMembers = overlay?.members || {};
  const overlayAccounts = overlay?.accounts || {};

  const staticMembers = roster.map(player => ({
    id: slugify(player.name), name: player.name, avatar: player.avatar || null,
    discordId: extractDiscordId(player.avatar), riotIds: riotIdsFromRoster(player), puuids: [],
  }));

  const staticIds = new Set(staticMembers.map(m => m.id));
  const extraMembers = Object.entries(overlayMembers)
    .filter(([id]) => !staticIds.has(id))
    .map(([id, m]) => ({ id, name: m.name, avatar: m.avatar || null, discordId: extractDiscordId(m.avatar), riotIds: [], puuids: [] }));

  members = [...staticMembers, ...extraMembers];

  members.forEach(member => {
    const accounts = overlayAccounts[member.id];
    if (!accounts) return;
    Object.values(accounts).forEach(account => {
      const riotId = `${account.name}#${account.tag}`;
      // rosterOverlay et roster.json peuvent déclarer le même compte.
      if (!member.riotIds.some(known => known.toLowerCase() === riotId.toLowerCase())) {
        member.riotIds.push(riotId);
      }
      if (account.puuid && !member.puuids.includes(String(account.puuid))) {
        member.puuids.push(String(account.puuid));
      }
    });
  });

  riotIdIndex = {};
  memberIdIndex = {};
  puuidIndex = {};
  members.forEach(member => {
    memberIdIndex[member.id] = member;
    member.riotIds.forEach(riotId => { riotIdIndex[riotId.toLowerCase()] = member; });
    member.puuids.forEach(puuid => { puuidIndex[puuid] = member; });
  });
}

async function ensureRoster(force = false) {
  if (!force && members.length && Date.now() - lastFetch < REFRESH_MS) return members;
  const [rosterRes, overlay] = await Promise.all([
    fetch(ROSTER_URL),
    fbGet('rosterOverlay').catch(() => null),
  ]);
  if (!rosterRes.ok) throw new Error(`Impossible de charger le roster (${rosterRes.status})`);
  indexRoster(await rosterRes.json(), overlay);
  lastFetch = Date.now();
  return members;
}

function memberNames() {
  return members.map(member => member.name);
}

function memberByName(name) {
  return members.find(member => member.name.toLowerCase() === String(name || '').toLowerCase()) || null;
}

function memberByRiotId(riotId) {
  return riotIdIndex[String(riotId || '').toLowerCase()] || null;
}

function memberById(memberId) {
  return memberIdIndex[String(memberId || '')] || null;
}

function memberByPuuid(puuid) {
  return puuidIndex[String(puuid || '')] || null;
}

/**
 * Résout le membre OLYCITY derrière une session live, du signal le plus stable
 * au moins stable :
 *   1. memberId — la personne s'est identifiée à l'installation du script
 *      (ask-identity.js). Insensible aux renommages et aux comptes multiples.
 *   2. puuid — identifiant Riot permanent, survit lui aussi aux renommages.
 *   3. Riot ID — dernier recours, casse dès que le joueur se renomme (c'était
 *      l'unique méthode avant la v4.16.0).
 */
function memberByIdentity(session) {
  if (!session) return null;
  return memberById(session.memberId)
    || memberByPuuid(session.puuid)
    || memberByRiotId(session.playerName);
}

module.exports = {
  ensureRoster, memberNames, memberByName, memberByRiotId,
  memberById, memberByPuuid, memberByIdentity,
  // Exposé pour les tests : rejouer l'indexation sans passer par le réseau.
  __test: { indexRoster },
};
