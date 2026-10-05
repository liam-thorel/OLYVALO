/**
 * À qui appartient un compte Riot ?
 *
 * `data/roster.json` est versionné et relu : c'est la déclaration qui fait
 * foi. Les comptes de `rosterOverlay/accounts`, eux, sont écrits par le script
 * Live sous le membre QUI JOUE le compte — un compte prêté ou partagé finit
 * donc rangé chez deux membres à la fois, et le dernier lu l'emportait selon
 * l'ordre des clés Firebase.
 *
 * Règle : un compte déclaré dans roster.json sous un membre n'est jamais
 * attribué à un autre, quoi que dise un enregistrement Firebase. Les comptes
 * non déclarés restent régis par Firebase, comme avant.
 *
 * Même règle dans le bot (discord-bot/roster-ownership.js).
 */

const normalize = value => String(value || '').trim().toLowerCase();
const riotIdOf = account => {
  if (!account?.name) return String(account?.playerName || account?.riotId || '');
  return account.tag ? `${account.name}#${account.tag}` : String(account.name);
};

/** Comptes déclarés par un membre : principal, smurfs, et principal LoL. */
export function declaredAccounts(player) {
  return [player?.riot, ...(player?.smurfs || []), player?.lol].filter(account => account?.name);
}

/** Propriétaire déclaré de chaque compte, par PUUID et par Riot ID. */
export function declaredOwners(roster = [], keyOf) {
  const byPuuid = new Map();
  const byRiotId = new Map();
  (roster || []).forEach(player => {
    const key = keyOf(player?.name);
    declaredAccounts(player).forEach(account => {
      const puuid = String(account.puuid || '').trim();
      if (puuid) byPuuid.set(puuid, key);
      const riotId = normalize(riotIdOf(account));
      if (riotId) byRiotId.set(riotId, key);
    });
  });
  return { byPuuid, byRiotId };
}

/**
 * Ce compte est-il déclaré sous un AUTRE membre que `memberKey` ?
 *
 * Le PUUID d'abord (insensible aux renommages) ; le Riot ID seulement quand
 * le PUUID est absent ou inconnu du roster — certains comptes y sont déclarés
 * sans PUUID.
 */
export function declaredElsewhere(memberKey, account, owners) {
  if (!owners || !account) return false;
  const puuid = String(account.puuid || '').trim();
  const owner = (puuid && owners.byPuuid.get(puuid)) || owners.byRiotId.get(normalize(riotIdOf(account)));
  return Boolean(owner) && owner !== memberKey;
}
