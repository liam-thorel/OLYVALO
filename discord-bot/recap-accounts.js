/**
 * Découpe l'activité d'un membre par COMPTE.
 *
 * Un membre peut jouer sur plusieurs comptes, souvent à des rangs très
 * différents. Les récaps les fondaient en une seule ligne : le rang affiché
 * était celui de la dernière partie jouée, quel que soit le compte, et le
 * winrate mélangeait un Ascendant et un Or. Aucun des deux chiffres
 * n'appartenait à personne.
 *
 * Le suivi de RR, lui, stockait déjà par compte (rank-tracking.js utilise le
 * Riot ID comme clé) — c'était le récap qui additionnait.
 */

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Regroupe les parties par compte et y rattache le RR gagné.
 *
 * Un compte apparaît s'il a joué OU si son rang a bougé : le second cas arrive
 * quand le rapport de fin de partie a manqué mais que le RR, lui, a été
 * enregistré.
 *
 * `deltaByAccount` est indexé par Riot ID en minuscules.
 */
function splitByAccount(member, entries = [], deltaByAccount = new Map()) {
  const byAccount = new Map();

  const ensure = account => {
    const key = normalize(account);
    if (!key) return null;
    if (!byAccount.has(key)) byAccount.set(key, { account, entries: [], delta: null });
    return byAccount.get(key);
  };

  entries.forEach(entry => {
    // Sans compte identifié, on rattache au compte principal plutôt que de
    // perdre la partie : c'est le cas des entrées écrites avant que le champ
    // n'existe.
    const row = ensure(entry.account || member?.riotIds?.[0]);
    if (row) row.entries.push(entry);
  });

  (member?.riotIds || []).forEach(riotId => {
    const delta = deltaByAccount.get(normalize(riotId));
    if (delta == null) return;
    const row = ensure(riotId);
    if (row) row.delta = delta;
  });

  // Rattache aussi le RR aux comptes déjà créés par leurs parties.
  byAccount.forEach((row, key) => {
    if (row.delta == null && deltaByAccount.has(key)) row.delta = deltaByAccount.get(key);
  });

  return [...byAccount.values()].filter(row => row.entries.length > 0 || row.delta != null);
}

/** « RayBaz#OLY » → « RayBaz ». Le tag n'apporte rien à l'œil. */
function shortAccount(account) {
  return String(account || '').split('#')[0] || String(account || '');
}

/**
 * Étiquette d'une ligne de récap.
 *
 * Un seul compte actif : le nom du membre suffit, ajouter le compte ne ferait
 * qu'alourdir. Plusieurs : on précise lequel, sinon deux lignes identiques se
 * suivraient sans qu'on sache laquelle est laquelle.
 *
 * `siblings` est la liste des comptes actifs du membre, pour détecter deux
 * comptes dont seul le tag diffère — auquel cas le tag devient nécessaire.
 */
function accountLabel(memberName, account, siblings = []) {
  if (siblings.length <= 1) return memberName;
  const short = shortAccount(account);
  const ambiguous = siblings.filter(other => shortAccount(other) === short).length > 1;
  return `${memberName} (${ambiguous ? account : short})`;
}

module.exports = { splitByAccount, accountLabel, shortAccount };
