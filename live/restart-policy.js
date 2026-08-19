/**
 * Politique de redémarrage du script après un crash.
 *
 * Le script tourne sans supervision (tâche Windows ONLOGON uniquement, pas de
 * relance en cours de session). L'ancien garde-fou anti-boucle faisait
 * `process.exit(1)` sans relancer dès deux crashs en moins de 30 s : le script
 * restait alors mort jusqu'au prochain démarrage Windows — potentiellement des
 * heures, en pleine partie. C'est ce qui laissait un joueur « en ligne puis
 * silencieux » sans jamais revenir.
 *
 * Nouvelle règle : on relance TOUJOURS. Pour ne pas transformer un crash
 * persistant en boucle qui sature le CPU et les logs, les crashs rapprochés
 * espacent progressivement la relance (0s, 5s, 10s… plafonnée à 60s). Un crash
 * isolé (plus de 30 s après le précédent) repart immédiatement et remet le
 * compteur à zéro.
 */

const RAPID_CRASH_WINDOW_MS = 30_000;
const BACKOFF_STEP_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

function planRestart(now, lastCrashTs = 0, streak = 0) {
  const rapid = lastCrashTs > 0 && now - lastCrashTs < RAPID_CRASH_WINDOW_MS;
  const nextStreak = rapid ? streak + 1 : 0;
  const delayMs = Math.min(nextStreak * BACKOFF_STEP_MS, MAX_BACKOFF_MS);
  return { delayMs, streak: nextStreak, crashTs: now };
}

module.exports = { planRestart, RAPID_CRASH_WINDOW_MS, BACKOFF_STEP_MS, MAX_BACKOFF_MS };
