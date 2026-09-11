/**
 * Détection « le jeu est lancé ». Même approche que live/index.js : on
 * interroge tasklist.exe directement (execFile, pas de shell visible) plutôt
 * que de passer par un cmd.exe qui ferait clignoter une fenêtre noire.
 *
 * Le rythme est volontairement lâche quand rien ne tourne : cette application
 * démarre avec Windows et vit en fond toute la journée. Sonder toutes les
 * trois secondes, c'est 28 800 processus par jour pour rien — la leçon a déjà
 * été apprise sur le script Live.
 */

const IDLE_POLL_MS = 15_000;   // aucun jeu détecté
const ACTIVE_POLL_MS = 5_000;  // un jeu tourne : on veut voir sa fermeture vite

// Le processus de rendu, pas le launcher : c'est lui qui existe pendant la
// partie. VALORANT.exe reste en vie dans le menu, ce qui n'est pas ce qu'on
// veut savoir ici.
const GAME_PROCESSES = {
  valorant: 'valorant-win64-shipping.exe',
  lol: 'league of legends.exe',
};

/**
 * Analyse la sortie de tasklist. Séparé de l'exécution pour être testable :
 * c'est cette lecture qui décide si l'overlay s'affiche ou non.
 */
function detectGames(tasklistOutput) {
  const haystack = String(tasklistOutput || '').toLowerCase();
  const running = {};
  for (const [game, processName] of Object.entries(GAME_PROCESSES)) {
    running[game] = haystack.includes(processName);
  }
  return running;
}

/** Un jeu, n'importe lequel, tourne-t-il ? */
function anyGameRunning(running) {
  return Object.values(running || {}).some(Boolean);
}

/**
 * Compare deux relevés et dit ce qui vient de changer. C'est la transition qui
 * pilote l'overlay, pas l'état : on ne veut ré-afficher la fenêtre qu'au
 * lancement du jeu, pas à chaque sondage pendant qu'il tourne.
 */
function gameTransition(previous, current) {
  const was = anyGameRunning(previous);
  const now = anyGameRunning(current);
  if (!was && now) return 'launched';
  if (was && !now) return 'closed';
  return 'none';
}

function nextPollDelay(running) {
  return anyGameRunning(running) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

module.exports = {
  detectGames, anyGameRunning, gameTransition, nextPollDelay,
  GAME_PROCESSES, IDLE_POLL_MS, ACTIVE_POLL_MS,
};
