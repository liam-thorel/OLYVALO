/**
 * Quand la fenêtre doit-elle être visible ?
 *
 * Trois sources la commandent : le lancement du jeu, le raccourci clavier, et
 * l'épingle. Elles se contredisent facilement — c'est ce qui rend ce genre
 * d'overlay agaçant quand c'est mal fait : une fenêtre qui revient alors qu'on
 * vient de la fermer, ou qui reste collée à l'écran après la game.
 *
 * La règle tient en une phrase : le jeu décide par défaut, l'utilisateur peut
 * toujours le contredire pour la session en cours, et son choix est oublié à
 * la transition suivante du jeu.
 */

function createOverlayState({ autoShow = true, visible = false } = {}) {
  return {
    autoShow,
    visible,
    // Vrai quand l'utilisateur a explicitement montré ou caché la fenêtre
    // depuis la dernière transition du jeu. Tant que c'est vrai, l'automatisme
    // se tait.
    manualOverride: false,
    gameRunning: false,
  };
}

/**
 * Applique un évènement et retourne le nouvel état. Fonction pure : l'appelant
 * compare `visible` avant/après pour décider d'afficher ou de masquer.
 *
 * Évènements : 'game-launched', 'game-closed', 'hotkey', 'show', 'hide',
 * 'set-auto-show'.
 */
function reduce(state, event, payload) {
  const next = { ...state };

  switch (event) {
    case 'game-launched':
      next.gameRunning = true;
      // Nouvelle partie = nouvelle donne : ce que l'utilisateur avait décidé
      // pour la précédente ne le suit pas.
      next.manualOverride = false;
      if (next.autoShow) next.visible = true;
      return next;

    case 'game-closed':
      next.gameRunning = false;
      next.manualOverride = false;
      // On masque toujours à la fermeture du jeu, même si la fenêtre avait été
      // ouverte à la main : la laisser au-dessus du bureau n'a pas de sens.
      next.visible = false;
      return next;

    case 'hotkey':
      next.visible = !next.visible;
      next.manualOverride = true;
      return next;

    case 'show':
      next.visible = true;
      next.manualOverride = true;
      return next;

    case 'hide':
      next.visible = false;
      next.manualOverride = true;
      return next;

    case 'set-auto-show':
      next.autoShow = !!payload;
      // Activer l'option pendant une partie déjà en cours doit avoir un effet
      // visible tout de suite, sinon on croit que le réglage ne marche pas.
      if (next.autoShow && next.gameRunning && !next.manualOverride) next.visible = true;
      return next;

    default:
      return next;
  }
}

module.exports = { createOverlayState, reduce };
