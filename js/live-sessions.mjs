export function groupLiveSessions(activeSessions) {
  const groups = {};

  activeSessions.forEach(([puuid, session]) => {
    const matchId = session.matchId || null;

    if (matchId) {
      const sameMatch = Object.values(groups).find(group => group[0]?.matchId === matchId);
      if (sameMatch) {
        sameMatch.push({ puuid, ...session });
        return;
      }
    }

    const playerPuuids = new Set((session.players || []).map(player => player.puuid).filter(Boolean));
    if (playerPuuids.size > 0) {
      const overlapping = Object.values(groups).find(group => {
        const groupedPuuids = group.flatMap(item => (item.players || []).map(player => player.puuid));
        return groupedPuuids.some(playerPuuid => playerPuuids.has(playerPuuid));
      });
      if (overlapping) {
        overlapping.push({ puuid, ...session });
        return;
      }
    }

    groups[matchId || puuid] = [{ puuid, ...session }];
  });

  return groups;
}

export function mergeSelectedSessionData(liveData, selectedSession, groups) {
  if (!liveData || liveData.players?.length) return liveData;

  const selectedGroup = Object.values(groups).find(group =>
    group.some(session => session.puuid === selectedSession)
  );
  const sibling = selectedGroup?.find(session =>
    session.puuid !== selectedSession && session.players?.length > 0
  );

  if (!sibling) return liveData;
  return {
    ...liveData,
    players: sibling.players,
    score: sibling.score || liveData.score,
    mapClean: sibling.mapClean || liveData.mapClean,
    mapInternal: sibling.mapInternal || liveData.mapInternal,
    mode: sibling.mode || liveData.mode,
  };
}

export function stablePlayersForSession(session, rosterCache) {
  const players = Array.isArray(session?.players) ? session.players : [];
  const matchId = String(session?.matchId || '');
  const isPregame = session?.phase === 'pregame' || session?.mode === 'agent-select';

  if (!session?.active || isPregame || !matchId) return players;

  if (players.length > 0) {
    rosterCache.set(matchId, players);
    return players;
  }

  return rosterCache.get(matchId) || players;
}
