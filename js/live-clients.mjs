export const LIVE_CLIENT_STALE_MS = 30000;

export function freshLiveClients(clients = {}, sessions = {}, now = Date.now()) {
  return Object.entries(clients)
    .filter(([, client]) => client && typeof client === 'object')
    .map(([puuid, client]) => {
      const session = sessions?.[puuid] || {};
      const ts = Number(client.ts) || 0;
      return {
        puuid,
        ...client,
        playerName: client.playerName || session.playerName || '',
        age: ts ? Math.max(0, now - ts) : Infinity,
      };
    })
    .filter(client => client.online && client.age < LIVE_CLIENT_STALE_MS)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function liveClientSummary(clients = []) {
  const counts = clients.reduce((result, client) => {
    const state = client.state || 'online';
    result[state] = (result[state] || 0) + 1;
    return result;
  }, {});
  return {
    total: clients.length,
    inGame: counts['in-game'] || 0,
    agentSelect: counts['agent-select'] || 0,
    ready: (counts.idle || 0) + (counts.online || 0),
    issues: (counts.error || 0) + (counts['riot-offline'] || 0),
  };
}
