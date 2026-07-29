function pregameTransition(pregameState, coreMatchId, missedPolls = 0, gracePolls = 5) {
  if (!pregameState) return { action: 'none', missedPolls: 0 };
  if (coreMatchId) return { action: 'game-started', missedPolls: 0 };

  const nextMissedPolls = missedPolls + 1;
  if (nextMissedPolls <= gracePolls) {
    return { action: 'keep-pregame', missedPolls: nextMissedPolls };
  }

  return { action: 'clear-pregame', missedPolls: 0 };
}

module.exports = { pregameTransition };
