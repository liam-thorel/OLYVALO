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

/**
 * Chemin Firebase d'un compte. Les clés RTDB interdisent . # $ [ ] / — or une
 * clé de repli contient un « # » (`riot:nom#tag`).
 *
 * La transformation n'est pas réversible, d'où la clé canonique recopiée DANS
 * l'enregistrement : c'est elle qui sert à ranger les stats au retour, pas le
 * nom du nœud.
 */
export function firebasePath(key) {
  return String(key || '').replace(/[.#$[\]/]/g, '_');
}

/**
 * Enregistrement à publier : les stats, plus la clé qui permet de les
 * reclasser, plus le compte qu'elles décrivent — lisible à l'œil nu dans la
 * console Firebase, ce qui n'est pas rien pour déboguer.
 */
export function publishable(account, stats) {
  const key = statsKey(account);
  if (!key || !stats?.syncedAt) return null;
  return { ...stats, key, riotId: stats.riotId || account?.riotId || '' };
}

/**
 * Stats venues de Firebase, indexées par leur clé canonique.
 *
 * La base est ouverte en écriture : tout ce qui en sort est suspect. Un
 * enregistrement sans clé ou sans date de synchro est écarté — il ne pourrait
 * ni se ranger, ni se comparer à ce qu'on a déjà.
 */
export function remoteStats(raw) {
  const store = {};
  Object.values(raw || {}).forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!key || !Number.isFinite(Number(entry.syncedAt))) return;
    store[key] = entry;
  });
  return store;
}

/**
 * Fusionne le magasin local et celui de Firebase — la plus FRAÎCHE gagne,
 * compte par compte.
 *
 * Deux copies existaient sans jamais se parler : le navigateur et l'overlay,
 * chacun avec son localStorage. L'overlay affichait des stats vieilles de
 * cinq jours et un pseudo périmé, sans rien qui l'explique, et ne pouvait pas
 * se rattraper faute de clé API.
 *
 * Comparer les dates plutôt que préférer une source par principe : le local
 * peut être plus récent (on vient de synchroniser hors ligne), et le distant
 * aussi (quelqu'un d'autre a synchronisé).
 */
export function mergeStores(local = {}, remote = {}) {
  const merged = { ...local };
  Object.entries(remote).forEach(([key, distant]) => {
    const ici = merged[key];
    if (!ici || Number(distant?.syncedAt || 0) > Number(ici?.syncedAt || 0)) merged[key] = distant;
  });
  return merged;
}
