/**
 * Dodge et remake : les deux façons qu'a une partie classée de ne pas compter.
 *
 * - Dodge : quelqu'un quitte la sélection d'agents. La partie ne démarre
 *   jamais, aucun rapport de fin de partie n'existera jamais, et pourtant
 *   Riot applique bien la pénalité de RR au fautif.
 * - Remake : la partie démarre, un joueur ne se connecte pas, l'équipe remake
 *   au premier round. Le rapport de fin de partie existe, mais avec 1 ou 2
 *   rounds joués et aucune équipe à 13.
 *
 * Sans ce module, un remake était publié comme une DÉFAITE (`buildDetailedHistory`
 * lit `team.won`, faux pour tout le monde sur un remake) : carte de défaite
 * dans Discord, pénalité comptée dans le récap RR, et paris tranchés sur une
 * partie qui n'a pas eu lieu.
 */

// Une partie classée qui compte va au moins jusqu'à la reddition, impossible
// avant le round 8. En dessous de 3 rounds, aucune issue normale n'existe.
const MAX_REMAKE_ROUNDS = 2;
// Manches nécessaires pour gagner une classée. Une partie qui les atteint a
// forcément été jouée, quoi que dise le compteur de rounds.
const ROUNDS_TO_WIN = 13;

/**
 * La partie décrite par ce snapshot d'historique est-elle un remake ?
 *
 * `rounds` vient de `details.roundResults.length` : il est absent quand le
 * rapport de fin de partie n'a pas pu être récupéré. On ne devine pas dans ce
 * cas — un rapport manquant n'est pas une preuve de remake.
 */
function isRemakeMatch(game) {
  // Le deathmatch et les modes sans équipes n'ont pas de manches comparables :
  // deux "rounds" y sont normaux, ce n'est pas pour autant un remake.
  if (String(game?.modeFamily || '') === 'free-for-all') return false;
  const rounds = Number(game?.rounds);
  // Au moins une manche : un remake se vote au premier round, il en reste
  // toujours la trace. Zéro manche ne veut pas dire « remake » mais « rapport
  // incomplet » — Riot a répondu sans roundResults — et on ne requalifie pas
  // une partie sur une absence de données.
  if (!(rounds >= 1 && rounds <= MAX_REMAKE_ROUNDS)) return false;
  const blue = Number(game?.score?.blue) || 0;
  const red = Number(game?.score?.red) || 0;
  if (blue >= ROUNDS_TO_WIN || red >= ROUNDS_TO_WIN) return false;
  return true;
}

/**
 * Résumé de fin de partie publié pour le bot quand la partie est annulée.
 *
 * `result: 'remake'` plutôt que win/loss : le bot doit pouvoir dire « annulée »
 * sans avoir à deviner, et surtout ne pas compter la pénalité comme une
 * défaite. `cancelled` reste la clé lue en premier côté bot, pour qu'une
 * valeur de `result` inattendue ne fasse pas retomber dans le cas normal.
 */
function cancelledResult({ kind, matchId, mode, map, rr = null }) {
  return {
    result: 'remake',
    cancelled: true,
    kind: kind === 'dodge' ? 'dodge' : 'remake',
    matchId: matchId || '',
    mode: mode || '',
    map: map || '',
    rr: rr || null,
  };
}

module.exports = { isRemakeMatch, cancelledResult, MAX_REMAKE_ROUNDS, ROUNDS_TO_WIN };
