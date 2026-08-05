export const LIVE_CLIENT_STALE_MS = 30000;

export function isVersionAtLeast(version, minimum) {
  const parts = value => String(value || '')
    .replace(/^v/i, '')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const current = parts(version);
  const required = parts(minimum);
  const length = Math.max(current.length, required.length);
  for (let index = 0; index < length; index += 1) {
    if ((current[index] || 0) > (required[index] || 0)) return true;
    if ((current[index] || 0) < (required[index] || 0)) return false;
  }
  return true;
}

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
    // Heartbeats arrive at slightly different times every few seconds. Sorting
    // by timestamp made every chip jump to the front after its own heartbeat.
    // The PUUID is stable for the lifetime of an account, so the visual order
    // now remains deterministic while status and details keep updating.
    .sort((a, b) => a.puuid.localeCompare(b.puuid));
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
