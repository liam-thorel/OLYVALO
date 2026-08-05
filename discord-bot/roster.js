const { ROSTER_URL } = require('./config.js');
const { fbGet } = require('./firebase.js');

const REFRESH_MS = 5 * 60 * 1000;

let members = [];       // [{ id, name, avatar, riotIds: ['name#tag', ...] }]
let riotIdIndex = {};   // 'name#tag' lowercase -> member
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
function indexRoster(roster, overlay) {
  const overlayMembers = overlay?.members || {};
  const overlayAccounts = overlay?.accounts || {};

  const staticMembers = roster.map(player => ({
    id: slugify(player.name), name: player.name, avatar: player.avatar || null,
    discordId: extractDiscordId(player.avatar), riotIds: [],
  }));

  const staticIds = new Set(staticMembers.map(m => m.id));
  const extraMembers = Object.entries(overlayMembers)
    .filter(([id]) => !staticIds.has(id))
    .map(([id, m]) => ({ id, name: m.name, avatar: m.avatar || null, discordId: extractDiscordId(m.avatar), riotIds: [] }));

  members = [...staticMembers, ...extraMembers];

  members.forEach(member => {
    const accounts = overlayAccounts[member.id];
    if (!accounts) return;
    Object.values(accounts).forEach(account => member.riotIds.push(`${account.name}#${account.tag}`));
  });

  riotIdIndex = {};
  members.forEach(member => {
    member.riotIds.forEach(riotId => { riotIdIndex[riotId.toLowerCase()] = member; });
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

module.exports = { ensureRoster, memberNames, memberByName, memberByRiotId };
