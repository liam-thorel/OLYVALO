/**
 * Journal de diagnostic. Cette application n'a pas de console : sans trace
 * écrite, un plantage au démarrage est parfaitement silencieux et il n'y a
 * aucun moyen de savoir ce qui s'est passé sur le poste de quelqu'un d'autre.
 *
 * Plafonné : le fichier vit à côté des réglages et l'application démarre avec
 * Windows. Sans limite il grossirait indéfiniment.
 */

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 256 * 1024;

function createLogger(directory, { now = () => new Date(), fsImpl = fs } = {}) {
  const file = path.join(directory, 'overlay.log');
  let failed = false; // on n'essaie pas indéfiniment si le disque refuse

  function rotateIfNeeded() {
    try {
      if (fsImpl.statSync(file).size > MAX_LOG_BYTES) fsImpl.unlinkSync(file);
    } catch { /* pas encore de fichier : rien à faire */ }
  }

  function log(...parts) {
    const line = `[${now().toISOString()}] ${parts.join(' ')}`;
    // Toujours sur stdout : utile quand on lance l'exe depuis un terminal.
    console.log(line);
    if (failed) return line;
    try {
      fsImpl.mkdirSync(directory, { recursive: true });
      rotateIfNeeded();
      fsImpl.appendFileSync(file, `${line}\n`);
    } catch {
      // Journaliser ne doit jamais empêcher l'application de tourner.
      failed = true;
    }
    return line;
  }

  return { log, file };
}

module.exports = { createLogger, MAX_LOG_BYTES };
