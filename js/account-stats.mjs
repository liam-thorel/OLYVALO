/**
 * Statistiques PAR COMPTE — logique pure.
 *
 * Elles étaient rangées sous le NOM DU MEMBRE : `{ Liam: {...} }`. Deux
 * conséquences, l'une visible et l'autre pas :
 *
 * - un joueur et son smurf ne peuvent pas coexister, puisqu'ils se disputent
 *   la même case — synchroniser l'un effaçait l'autre ;
 * - un renommage changeait la clé, et la synchro d'avant devenait
 *   inatteignable sans que rien ne la supprime.
 *
 * La clé est désormais le PUUID, identifiant Riot permanent. Les comptes qui
 * n'en ont pas encore (aucun passage par l'admin) retombent sur leur Riot ID :
 * c'est fragile face à un renommage, mais c'est tout ce qu'on a, et ça reste
 * meilleur que de les faire disparaître.
 */

const clean = value => String(value ?? '').trim();

/**
 * Clé de rangement d'un compte.
 *
 * Le préfixe n'est pas décoratif : sans lui, un Riot ID qui ressemblerait à un
 * PUUID irait se ranger sur celui d'un autre compte.
 */
export function statsKey(account) {
  const puuid = clean(account?.puuid);
  if (puuid) return `puuid:${puuid}`;
  const riotId = clean(account?.riotId).toLowerCase();
  return riotId ? `riot:${riotId}` : '';
}

/**
 * Statistiques d'un compte, avec repli sur l'ancien format.
 *
 * Les synchros déjà faites sont rangées sous le nom du membre et décrivent son
 * compte PRINCIPAL. Les jeter obligerait tout le monde à resynchroniser — une
 * requête paginée par joueur sur une clé API limitée en débit. On les lit donc
 * encore, pour le compte principal seulement : les attribuer à un smurf lui
 * prêterait le rang de quelqu'un d'autre.
 */
export function readStats(store = {}, account = null, { legacy = {}, memberName = '' } = {}) {
  const key = statsKey(account);
  const direct = key ? store?.[key] : null;
  if (direct) return direct;
  if (!account?.isMain) return null;
  return legacy?.[clean(memberName)] || null;
}

/** Nouveau magasin, l'ancien laissé intact — il est partagé avec le rendu. */
export function writeStats(store = {}, account = null, stats = null) {
  const key = statsKey(account);
  if (!key) return store;
  return { ...store, [key]: stats };
}

/**
 * Compte actuellement affiché sur la carte.
 *
 * Une sélection qui ne correspond à aucun compte connu — un smurf masqué
 * depuis l'admin entre-temps — retombe sur le principal plutôt que de laisser
 * une carte vide.
 */
export function selectedAccount(accounts = [], selectedKey = '') {
  if (!accounts.length) return null;
  const main = accounts.find(account => account.isMain) || accounts[0];
  if (!selectedKey) return main;
  return accounts.find(account => statsKey(account) === selectedKey) || main;
}

/**
 * Nouvelle sélection après un clic sur un compte.
 *
 * Recliquer sur le compte déjà affiché ramène au principal : c'est le geste
 * attendu pour « revenir », et il évite d'avoir à ajouter un bouton de retour
 * qu'il faudrait ensuite expliquer.
 */
export function toggleSelection(currentKey = '', clickedKey = '') {
  const clicked = clean(clickedKey);
  if (!clicked) return '';
  return clean(currentKey) === clicked ? '' : clicked;
}

/**
 * Faut-il synchroniser ce compte maintenant ?
 *
 * Cliquer sur un smurf doit montrer ses chiffres, pas les chercher à chaque
 * fois : une synchro récente est réutilisée telle quelle, sinon on brûlerait
 * le quota de la clé API à chaque aller-retour entre deux comptes.
 */
export function needsSync(stats, now = Date.now(), maxAgeMs = 10 * 60_000) {
  const ts = Number(stats?.syncedAt || 0);
  return !(ts > 0) || now - ts > maxAgeMs;
}
