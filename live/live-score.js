/**
 * Score en direct d'une partie Valorant.
 *
 * La source fiable, c'est la PRÉSENCE Riot du joueur local : elle porte le
 * score du point de vue de son équipe (« alliés » / « ennemis »), rafraîchi à
 * chaque manche, et le script la lit déjà à chaque poll.
 *
 * L'ancienne source ne pouvait pas marcher : le script lisait `Teams[].Score`
 * dans la réponse de /core-game/v1/matches, qui ne contient pas d'équipes. Il
 * y trouvait donc 0 partout, et REMETTAIT le score à 0-0 à chaque poll — y
 * compris celui que le websocket avait pu obtenir entre-temps. Conséquences :
 * aucun score sur le site, et le pari de mi-temps du bot, qui attend 12
 * manches jouées, ne s'ouvrait jamais.
 */

function roundCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 100 ? number : null;
}

/**
 * Score lu dans une présence décodée, ou null.
 *
 * Riot a restructuré la présence en 2024 : le score est passé de la racine à
 * `partyPresenceData`. Les deux formes sont lues, la nouvelle d'abord, pour ne
 * pas dépendre de la version du client.
 *
 * Le score est celui du CHEF DE GROUPE. En partie classée ou non classée, un
 * groupe ne peut pas être séparé : son équipe est celle du joueur local.
 */
function presenceScore(decoded) {
  for (const source of [decoded?.partyPresenceData, decoded]) {
    const ally = roundCount(source?.partyOwnerMatchScoreAllyTeam);
    const enemy = roundCount(source?.partyOwnerMatchScoreEnemyTeam);
    if (ally !== null && enemy !== null) return { ally, enemy };
  }
  return null;
}

/**
 * Convertit le score allié/ennemi en score Bleu/Rouge, le format publié.
 *
 * Tout le reste (site, bot, historique) raisonne en Bleu/Rouge avec le camp
 * du joueur à côté. Sans camp connu, on ne devine pas : un score inversé
 * annoncerait une victoire à l'équipe qui perd.
 */
function blueRedScore(score, selfTeam) {
  if (!score) return null;
  if (selfTeam === 'ORDER') return { blue: score.ally, red: score.enemy };
  if (selfTeam === 'CHAOS') return { blue: score.enemy, red: score.ally };
  return null;
}

module.exports = { presenceScore, blueRedScore };
