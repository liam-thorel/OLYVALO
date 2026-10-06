const { ROSTER_URL } = require('./config.js');
const { fbGet } = require('./firebase.js');
const { declaredAccounts, declaredOwners, declaredElsewhere } = require('./roster-ownership.js');

const REFRESH_MS = 5 * 60 * 1000;

let members = [];       // [{ id, name, avatar, riotIds, mainRiotId, mainPuuid, lolMainRiotId, lolMainPuuid, puuids }]
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
function formatRosterAccount(account) {
  if (!account?.name) return null;
  return account.tag ? `${account.name}#${account.tag}` : String(account.name);
}

// Principal, smurfs ET principal LoL : un compte LoL déclaré doit être
// reconnu comme celui du membre, même avant que le script ne l'enregistre.
const rosterAccounts = declaredAccounts;

function riotIdsFromRoster(player) {
  return rosterAccounts(player).map(formatRosterAccount).filter(Boolean);
}

/**
 * PUUID déclarés dans roster.json.
 *
 * Le fichier ne portait que des pseudos : l'identité d'un membre dépendait
 * donc d'un nom, qui change. Le PUUID y est désormais lu au même titre que
 * ceux enregistrés depuis l'admin — même liste, même priorité.
 */
function puuidsFromRoster(player) {
  return rosterAccounts(player)
    .map(account => String(account.puuid || '').trim())
    .filter(Boolean);
}

/**
 * Compte principal déclaré, quand il l'est.
 *
 * roster.json est la SEULE source qui distingue le compte principal des
 * smurfs (`riot` d'un côté, `smurfs` de l'autre). Les comptes ajoutés depuis
 * l'admin n'ont pas cette notion — on renvoie alors `null` plutôt que de
 * désigner le premier venu, ce qui reviendrait à inventer.
 */
function mainRiotIdFromRoster(player) {
  return formatRosterAccount(player?.riot);
}

/**
 * Compte principal en LoL, quand il diffère de celui de Valorant.
 *
 * Plusieurs membres ne jouent pas à LoL sur leur compte Valorant (Nico,
 * Liam, Noé, Mathis). Avec un seul principal par membre, leur vrai compte LoL
 * s'affichait « (smurf) » dans chaque notification LoL.
 */
function lolMainRiotIdFromRoster(player) {
  return formatRosterAccount(player?.lol);
}

function indexRoster(roster, overlay) {
  const overlayMembers = overlay?.members || {};
  const overlayAccounts = overlay?.accounts || {};
  const owners = declaredOwners(roster, slugify);

  const staticMembers = roster.map(player => ({
    id: slugify(player.name), name: player.name, avatar: player.avatar || null,
    discordId: extractDiscordId(player.avatar), riotIds: riotIdsFromRoster(player),
    mainRiotId: mainRiotIdFromRoster(player), lolMainRiotId: lolMainRiotIdFromRoster(player),
    // Le PUUID fait foi pour désigner le principal : un compte renommé garde
    // le sien, alors que son Riot ID dans roster.json devient périmé.
    mainPuuid: String(player?.riot?.puuid || '').trim() || null,
    lolMainPuuid: String(player?.lol?.puuid || '').trim() || null,
    puuids: puuidsFromRoster(player),
  }));

  const staticIds = new Set(staticMembers.map(m => m.id));
  const extraMembers = Object.entries(overlayMembers)
    .filter(([id]) => !staticIds.has(id))
    .map(([id, m]) => ({ id, name: m.name, avatar: m.avatar || null, discordId: extractDiscordId(m.avatar), riotIds: [], mainRiotId: null, lolMainRiotId: null, mainPuuid: null, lolMainPuuid: null, puuids: [] }));

  members = [...staticMembers, ...extraMembers];

  members.forEach(member => {
    const accounts = overlayAccounts[member.id];
    if (!accounts) return;
    Object.values(accounts).forEach(account => {
      // Compte déclaré dans roster.json sous un AUTRE membre : il lui reste.
      // Le script enregistre un compte sous celui qui le joue, et un compte
      // prêté finissait chez l'emprunteur. Voir roster-ownership.js.
      if (declaredElsewhere(member.id, account, owners)) return;
      const riotId = `${account.name}#${account.tag}`;
      // Compte retiré depuis l'admin. Un compte déclaré dans roster.json ne
      // peut pas être effacé d'ici — le fichier est versionné — mais il peut
      // être masqué : il disparaît partout sans qu'un commit soit nécessaire.
      if (account.hidden === true) {
        member.riotIds = member.riotIds.filter(known => known.toLowerCase() !== riotId.toLowerCase());
        if (account.puuid) member.puuids = member.puuids.filter(puuid => puuid !== String(account.puuid));
        if (member.mainRiotId && member.mainRiotId.toLowerCase() === riotId.toLowerCase()) member.mainRiotId = null;
        if (account.puuid && member.mainPuuid === String(account.puuid)) member.mainPuuid = null;
        return;
      }
      // Rôle choisi à la main dans l'admin : il l'emporte sur la position
      // dans roster.json, qui n'était qu'une convention d'écriture.
      if (String(account.role || '').toLowerCase() === 'main') {
        member.mainRiotId = riotId;
        member.mainPuuid = String(account.puuid || '').trim() || null;
      }
      // Principal LoL déclaré sans PUUID : l'enregistrement du script, lui,
      // en porte un. Le nom ne sert qu'à faire ce rapprochement, une fois.
      if (!member.lolMainPuuid && account.puuid && member.lolMainRiotId
        && member.lolMainRiotId.toLowerCase() === riotId.toLowerCase()) {
        member.lolMainPuuid = String(account.puuid).trim();
      }
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
    // L'index par nom ne sert plus qu'aux comptes SANS puuid connu : dès
    // qu'un compte est identifié, son pseudo cesse d'être une clé — c'est
    // précisément ce qui cassait à chaque renommage.
    if (member.puuids.length === 0) {
      member.riotIds.forEach(riotId => { riotIdIndex[riotId.toLowerCase()] = member; });
    }
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
