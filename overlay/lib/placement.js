/**
 * Position de la fenêtre quand on la ramène sur un écran donné.
 *
 * Garde la taille actuelle, sauf si elle dépasse la zone utile de l'écran
 * d'arrivée (un portable à côté d'un écran 1440p) : la fenêtre doit tenir
 * entière, barre de titre comprise, sinon on ne peut plus la déplacer.
 */
function centeredBounds(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

module.exports = { centeredBounds };
