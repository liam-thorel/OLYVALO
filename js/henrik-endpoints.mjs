/**
 * Choix des endpoints HenrikDev — logique pure.
 *
 * Le PUUID est l'identifiant Riot PERMANENT ; le Riot ID, lui, change dès que
 * le joueur se renomme. Toute la synchronisation partait pourtant du couple
 * `name/tag` déclaré dans `data/roster.json` : un compte renommé répondait 404
 * et la carte restait vide pour toujours, sans que rien n'explique pourquoi.
 * C'est arrivé à « Wong Chi Ming#2046 », devenu « FakePlasticTrees#1706 ».
 *
 * On passe donc par `by-puuid` partout où le PUUID est connu. Le Riot ID
 * déclaré ne sert plus qu'à AMORCER : on l'utilise une fois pour obtenir le
 * PUUID d'un compte qui n'en a pas encore, jamais pour l'interroger ensuite.
 *
 * Bénéfice secondaire, et c'est celui qui se voit : la réponse porte le nom
 * COURANT du compte. L'écran cesse d'afficher un pseudo qui n'existe plus.
 */

const clean = value => String(value ?? '').trim();

/** Riot ID d'un couple nom/tag, ou chaîne vide si le nom manque. */
export function joinRiotId(name, tag) {
  const base = clean(name);
  if (!base) return '';
  const suffix = clean(tag);
  return suffix ? `${base}#${suffix}` : base;
}

/**
 * Chemins d'API à interroger pour un compte.
 *
 * `byPuuid` dit laquelle des deux voies a été prise : c'est ce qui distingue
 * une synchro qui survit à un renommage d'une synchro qui n'y survit pas, et
 * l'appelant doit pouvoir le rapporter.
 */
export function syncEndpoints({ puuid = '', name = '', tag = '', region = 'eu', platform = 'pc' } = {}) {
  const id = clean(puuid);
  const zone = clean(region) || 'eu';
  if (id) {
    const encoded = encodeURIComponent(id);
    return {
      byPuuid: true,
      account: `/v1/by-puuid/account/${encoded}`,
      mmr: `/v3/by-puuid/mmr/${zone}/${platform}/${encoded}`,
      matches: `/v4/by-puuid/matches/${zone}/${platform}/${encoded}`,
    };
  }
  const who = clean(name);
  const label = clean(tag);
  if (!who || !label) return null;
  const encodedName = encodeURIComponent(who);
  const encodedTag = encodeURIComponent(label);
  return {
    byPuuid: false,
    account: `/v1/account/${encodedName}/${encodedTag}`,
    mmr: `/v3/mmr/${zone}/${platform}/${encodedName}/${encodedTag}`,
    matches: `/v4/matches/${zone}/${platform}/${encodedName}/${encodedTag}`,
  };
}

/**
 * Riot ID COURANT d'un compte, tel que Riot le connaît aujourd'hui.
 *
 * La réponse MMR porte déjà le compte interrogé : quand elle suffit, on évite
 * un appel de plus — la clé HenrikDev est limitée en débit, et une synchro
 * complète en consomme déjà plusieurs par joueur.
 *
 * Le Riot ID déclaré dans le dépôt n'est qu'un DERNIER recours : s'y rabattre
 * quand l'API a répondu reviendrait à réafficher le pseudo périmé qu'on
 * cherche précisément à remplacer.
 */
export function currentRiotId({ mmr = null, account = null, fallback = '' } = {}) {
  const fromMmr = joinRiotId(mmr?.data?.account?.name, mmr?.data?.account?.tag);
  if (fromMmr) return fromMmr;
  const fromAccount = joinRiotId(account?.data?.name, account?.data?.tag);
  if (fromAccount) return fromAccount;
  return clean(fallback);
}

/** PUUID observé, quelle que soit la réponse qui le porte. */
export function observedPuuid({ mmr = null, account = null, fallback = '' } = {}) {
  return clean(mmr?.data?.account?.puuid) || clean(account?.data?.puuid) || clean(fallback);
}

/**
 * Le compte a-t-il été renommé depuis ce que déclare le dépôt ?
 *
 * Comparaison insensible à la casse : Riot laisse changer la casse d'un
 * pseudo sans que ce soit un renommage, et signaler « RayBaz → raybaz »
 * apprendrait à ignorer le signal.
 */
export function wasRenamed(declared, observed) {
  const before = clean(declared).toLowerCase();
  const after = clean(observed).toLowerCase();
  return Boolean(before && after && before !== after);
}
