/**
 * Clés des nœuds LoL dans Firebase.
 *
 * Elles étaient dérivées du RIOT ID. Un renommage produisait donc une nouvelle
 * clé, et l'ancienne restait en place pour toujours : deux entrées pour un
 * seul compte, dont une figée à son état d'avant. La lecture rapproche les
 * entrées par PUUID — les deux portent le même — et pouvait retenir la
 * périmée : rang d'il y a des mois, top champions obsolète, sans rien qui le
 * signale.
 *
 * La clé est donc le PUUID, identifiant Riot permanent. Un renommage écrit
 * désormais AU MÊME ENDROIT, et il n'y a plus de seconde entrée à départager.
 *
 * Trois nœuds sont concernés — `lolSessions`, `lolClients`, `lolProfiles` —
 * et tous trois sont éphémères ou reconstruits à chaque passage : les
 * re-cléter ne perd rien.
 *
 * `lolHistory` garde délibérément ses clés. Ses entrées sont IMMUABLES : une
 * fois écrite, une partie ne change plus, et un renommage ultérieur ne la
 * touche pas. Il n'y a donc aucun doublon à éviter, et changer le format
 * risquerait au contraire d'écrire deux fois la même partie pendant la
 * transition. Le champ `puuid` à l'intérieur fait déjà l'identification.
 */

// Les clés Firebase RTDB interdisent . # $ [ ] / — putFB ne fait aucun
// encodage d'URL, donc il faut substituer ces caractères directement.
function safeFirebaseKey(str) {
  return String(str).replace(/[.#$[\]/]/g, '_');
}

/**
 * Clé d'un compte LoL.
 *
 * Le repli sur le Riot ID n'est pas décoratif : le LCU peut répondre sans
 * PUUID pendant les toutes premières secondes après le lancement du client.
 * Écrire sous une clé vide écraserait l'entrée d'un autre joueur.
 */
function lolAccountKey({ puuid = '', playerName = '' } = {}) {
  const id = String(puuid || '').trim();
  if (id) return safeFirebaseKey(id);
  const name = String(playerName || '').trim();
  return name ? safeFirebaseKey(name) : '';
}

/**
 * Ancienne clé à effacer après avoir écrit sous la nouvelle.
 *
 * Sans ce ménage, l'entrée indexée sur le pseudo resterait indéfiniment :
 * un client « connecté » fantôme dans le tableau de bord admin, et un profil
 * périmé que la lecture pourrait préférer au bon.
 *
 * Rien n'est renvoyé quand les deux clés coïncident — c'est le cas d'un compte
 * sans PUUID — sinon le script effacerait ce qu'il vient d'écrire.
 */
function legacyKeyToDrop({ puuid = '', playerName = '' } = {}) {
  if (!String(puuid || '').trim()) return '';
  const legacy = lolAccountKey({ playerName });
  const current = lolAccountKey({ puuid, playerName });
  return legacy && legacy !== current ? legacy : '';
}

module.exports = { safeFirebaseKey, lolAccountKey, legacyKeyToDrop };
