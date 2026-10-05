import { declaredOwners, declaredElsewhere } from './roster-ownership.mjs';

function normalize(value = '') {
  return String(value).trim().toLocaleLowerCase('fr');
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function riotId(account = {}) {
  if (account.playerName) return String(account.playerName).trim();
  const name = String(account.name || '').trim();
  const tag = String(account.tag || '').trim();
  return tag ? `${name}#${tag}` : name;
}

export function buildLiveIdentityIndex(roster = [], overlay = {}, knownAccounts = []) {
  const byMemberId = new Map();
  const byMemberName = new Map();
  const byPuuid = new Map();
  const byRiotId = new Map();
  const byAccountName = new Map();
  const owners = declaredOwners(roster, slugify);

  const registerMember = (memberId, member = {}) => {
    const id = memberId || slugify(member.name);
    if (!id) return null;
    const previous = byMemberId.get(id) || {};
    const profile = {
      id,
      member: member.name || previous.member || id,
      avatar: member.avatar || previous.avatar || '',
    };
    byMemberId.set(id, profile);
    byMemberName.set(normalize(profile.member), profile);
    return profile;
  };

  const registerAccount = (profile, account = {}) => {
    if (!profile) return;
    const fullId = normalize(riotId(account));
    if (fullId) byRiotId.set(fullId, profile);
    if (account.puuid) byPuuid.set(String(account.puuid), profile);
    const accountName = normalize(account.name || String(account.playerName || '').split('#')[0]);
    if (!accountName) return;
    const existing = byAccountName.get(accountName);
    byAccountName.set(accountName, existing && existing !== profile ? null : profile);
  };

  roster.forEach(member => {
    const profile = registerMember(slugify(member.name), member);
    registerAccount(profile, member.riot);
    (member.smurfs || []).forEach(account => registerAccount(profile, account));
    // Compte principal LoL, quand il diffère de celui de Valorant.
    registerAccount(profile, member.lol);
  });

  knownAccounts.forEach(account => {
    const memberName = account.member || account.name;
    const profile = byMemberName.get(normalize(memberName)) || byMemberId.get(slugify(memberName));
    registerAccount(profile, {
      playerName: account.playerName || account.riotId,
      puuid: account.puuid,
    });
  });

  Object.entries(overlay?.members || {}).forEach(([memberId, member]) => registerMember(memberId, member));
  Object.entries(overlay?.accounts || {}).forEach(([memberId, accounts]) => {
    const profile = byMemberId.get(memberId) || registerMember(memberId, overlay?.members?.[memberId] || {});
    // Un compte déclaré dans roster.json sous un autre membre lui reste : le
    // script enregistre un compte sous celui qui le JOUE, et un compte prêté
    // finissait chez l'emprunteur. Voir roster-ownership.mjs.
    Object.values(accounts || {})
      .filter(account => !declaredElsewhere(memberId, account, owners))
      .forEach(account => registerAccount(profile, account));
  });

  return { byMemberId, byMemberName, byPuuid, byRiotId, byAccountName };
}

/**
 * Membre derrière une session ou un joueur du Live.
 *
 * L'identité publiée par le script (`memberId`) passe en premier : elle dit
 * qui joue sur CE poste, y compris sur un compte prêté. Le compte (PUUID,
 * puis Riot ID) ne sert que pour les joueurs vus dans la partie, qui n'ont
 * pas de script derrière eux.
 */
export function resolveLiveIdentity(entry = {}, index) {
  if (!index) return null;
  if (entry.memberId && index.byMemberId.has(entry.memberId)) return index.byMemberId.get(entry.memberId);
  if (entry.member && index.byMemberName.has(normalize(entry.member))) return index.byMemberName.get(normalize(entry.member));
  if (entry.puuid && index.byPuuid.has(String(entry.puuid))) return index.byPuuid.get(String(entry.puuid));
  const playerName = normalize(entry.playerName);
  if (playerName && index.byRiotId.has(playerName)) return index.byRiotId.get(playerName);
  return index.byAccountName.get(playerName.split('#')[0]) || null;
}
