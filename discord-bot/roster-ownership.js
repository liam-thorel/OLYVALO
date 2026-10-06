/**
 * À qui appartient un compte Riot ? Même règle que js/roster-ownership.mjs
 * côté site — les deux doivent rester d'accord, sinon le bot et le site
 * attribueraient la même partie à deux membres différents.
 *
 * data/roster.json fait foi : un compte qu'il déclare sous un membre n'est
 * jamais attribué à un autre, même si le script Live l'a enregistré sous le
 * membre qui l'a JOUÉ (compte prêté ou partagé).
 */

const normalize = value => String(value || '').trim().toLowerCase();
const riotIdOf = account => {
  if (!account?.name) return String(account?.playerName || account?.riotId || '');
  return account.tag ? `${account.name}#${account.tag}` : String(account.name);
};

/** Comptes déclarés par un membre : principal, smurfs, et principal LoL. */
function declaredAccounts(player) {
  return [player?.riot, ...(player?.smurfs || []), player?.lol].filter(account => account?.name);
}

function declaredOwners(roster = [], keyOf) {
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

function declaredElsewhere(memberKey, account, owners) {
  if (!owners || !account) return false;
  const puuid = String(account.puuid || '').trim();
  const owner = (puuid && owners.byPuuid.get(puuid)) || owners.byRiotId.get(normalize(riotIdOf(account)));
  return Boolean(owner) && owner !== memberKey;
}

module.exports = { declaredAccounts, declaredOwners, declaredElsewhere };
