/**
 * Cartes du roster Valorant — logique pure.
 *
 * Deux manques que l'écran traînait depuis le début :
 *
 * 1. Le RIOT ID n'apparaissait nulle part. C'est pourtant la première chose
 *    qu'on vient y chercher — pour add quelqu'un, ou pour vérifier quel compte
 *    est suivi. Seul le bouton Tracker le portait, caché dans une URL. La
 *    carte LoL, elle, l'affiche depuis toujours.
 *
 * 2. Les SMURFS étaient invisibles. `data/roster.json` en déclare, l'admin en
 *    enregistre d'autres dans `rosterOverlay/accounts` — et aucun des deux
 *    n'arrivait jusqu'à l'écran. Un joueur avec trois comptes n'en montrait
 *    qu'un, sans que rien ne le laisse deviner.
 *
 * S'y ajoute la raison pour laquelle une carte est muette : sans rang ni
 * stats, elle n'affichait qu'un trou, et rien ne disait s'il fallait
 * synchroniser, renseigner une clé API ou jouer une classée.
 */

const lower = value => String(value || '').trim().toLowerCase();

/** `name#tag`, ou le nom seul si le tag manque. */
export function riotIdOf(account) {
  const name = String(account?.name || '').trim();
  if (!name) return '';
  const tag = String(account?.tag || '').trim();
  return tag ? `${name}#${tag}` : name;
}

/** Identifiant de membre — même translittération que member-profiles.mjs. */
export function memberKey(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/**
 * Tous les comptes d'un joueur : ceux de `roster.json` ET ceux enregistrés
 * depuis l'admin.
 *
 * Mêmes règles que discord-bot/roster.js et que les courbes, sciemment :
 * `hidden` retire un compte du roster vivant (on ne peut pas effacer une ligne
 * du dépôt depuis le site), et `role: 'main'` le fait passer en tête — sinon
 * le réglage de l'admin resterait sans effet sur l'écran.
 */
export function rosterAccounts(player, overlay = null) {
  const declared = [player?.riot, ...(player?.smurfs || [])]
    .filter(account => account?.name)
    .map(account => ({ riotId: riotIdOf(account), puuid: String(account.puuid || '').trim(), source: 'roster' }));

  const stored = Object.values(overlay?.accounts?.[memberKey(player?.name)] || {});
  const hidden = new Set();
  let explicitMain = '';

  stored.forEach(account => {
    if (!account?.name) return;
    const riotId = riotIdOf(account);
    if (account.hidden === true) { hidden.add(lower(riotId)); return; }
    if (lower(account.role) === 'main') explicitMain = lower(riotId);
    const known = declared.find(entry => lower(entry.riotId) === lower(riotId));
    if (known) {
      // Le puuid renseigné depuis l'admin complète une ligne du dépôt qui n'en
      // avait pas : c'est le cas de tous les comptes d'avant la migration.
      if (!known.puuid && account.puuid) known.puuid = String(account.puuid).trim();
      return;
    }
    declared.push({ riotId, puuid: String(account.puuid || '').trim(), source: 'admin' });
  });

  const visible = declared.filter(account => !hidden.has(lower(account.riotId)));
  if (explicitMain) {
    const index = visible.findIndex(account => lower(account.riotId) === explicitMain);
    if (index > 0) visible.unshift(...visible.splice(index, 1));
  }
  return visible.map((account, position) => ({ ...account, isMain: position === 0 }));
}

/**
 * Pourquoi cette carte n'affiche ni rang ni statistiques.
 *
 * Quatre causes distinctes, qui ne se corrigent pas de la même façon — les
 * confondre sous un trou silencieux envoie chercher au mauvais endroit. Rien
 * n'est renvoyé quand la carte a de quoi se remplir : un bandeau permanent
 * finirait par ne plus être lu.
 */
export function cardStatus(stats = {}, { hasApiKey = true, hasRiot = true } = {}) {
  if (!hasRiot) {
    return { kind: 'unlinked', label: 'Aucun compte Riot', hint: 'À renseigner depuis Admin · Attribution des comptes.' };
  }
  if (!stats?.syncedAt) {
    return hasApiKey
      ? { kind: 'never-synced', label: 'Jamais synchronisé', hint: 'Sync récupère le rang et les stats de l’acte.' }
      : { kind: 'no-key', label: 'Clé API manquante', hint: 'Renseigne ta clé HenrikDev (🔑) pour actualiser.' };
  }
  if (!stats.rank) {
    return { kind: 'unranked', label: 'Rang introuvable', hint: 'Aucune classée sur l’acte en cours, ou profil masqué.' };
  }
  return null;
}

/** Fraîcheur de la dernière synchro — au-delà d'une semaine, les stats mentent. */
export function isStale(syncedAt, now = Date.now(), maxAgeMs = 7 * 86_400_000) {
  const ts = Number(syncedAt || 0);
  return ts > 0 && now - ts > maxAgeMs;
}
