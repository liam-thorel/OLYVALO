const DEFAULT_GAME_END_GRACE_MS = 20_000;

function gameAbsenceTransition({
  wasInGame = false,
  lastConfirmedAt = 0,
  now = Date.now(),
  graceMs = DEFAULT_GAME_END_GRACE_MS,
} = {}) {
  if (!wasInGame) return { action: 'idle', remainingMs: 0 };

  const elapsedMs = Math.max(0, now - Number(lastConfirmedAt || 0));
  if (lastConfirmedAt > 0 && elapsedMs < graceMs) {
    return { action: 'keep-game', remainingMs: graceMs - elapsedMs };
  }

  return { action: 'end-game', remainingMs: 0 };
}

module.exports = { DEFAULT_GAME_END_GRACE_MS, gameAbsenceTransition };
