/**
 * Mode d'affichage du jeu, et ce qu'il faut en dire.
 *
 * Une fenêtre « toujours au-dessus » ne peut pas s'afficher par-dessus un jeu
 * en PLEIN ÉCRAN EXCLUSIF : le raccourci fonctionne, l'overlay s'affiche… sous
 * le jeu. Valorant doit être en « Plein écran fenêtré », LoL en « Sans
 * bordure ». La barre du haut ne parlait que de Valorant : un joueur LoL en
 * plein écran voyait son raccourci « ne rien faire », sans explication.
 *
 * LoL écrit son réglage dans Config/game.cfg : WindowMode=0 (plein écran),
 * 1 (fenêtré) ou 2 (sans bordure). On le lit au lancement du jeu.
 */

const path = require('path');

const LOL_WINDOW_MODES = { 0: 'fullscreen', 1: 'windowed', 2: 'borderless' };

/** Emplacements usuels de game.cfg — les mêmes dossiers que le script Live. */
function lolConfigPaths(env = process.env) {
  return [
    path.join('C:', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
    path.join(env['ProgramFiles(x86)'] || '', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
    path.join(env.ProgramFiles || '', 'Riot Games', 'League of Legends', 'Config', 'game.cfg'),
  ];
}

/** 'fullscreen' | 'windowed' | 'borderless' | null (inconnu). */
function lolWindowMode(cfgText) {
  const match = String(cfgText || '').match(/^\s*WindowMode\s*=\s*(\d+)\s*$/mi);
  return match ? (LOL_WINDOW_MODES[Number(match[1])] || null) : null;
}

/** Texte de la barre du haut, et s'il faut le mettre en avant. */
function displayHint(running = {}, lolMode = null) {
  if (running.lol && lolMode === 'fullscreen') {
    return { text: 'LoL est en plein écran : passe-le en « Sans bordure » (Options › Vidéo)', warn: true };
  }
  if (running.lol && !running.valorant) return { text: 'LoL doit être en « Sans bordure »', warn: false };
  return { text: 'Valorant doit être en « Plein écran fenêtré »', warn: false };
}

module.exports = { lolConfigPaths, lolWindowMode, displayHint, LOL_WINDOW_MODES };
