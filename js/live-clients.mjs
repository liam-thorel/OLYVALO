import { liveTimestamp } from './live-data-store.mjs?v=20260810-firebase-connection-fix';

// Deux ou trois requêtes Riot locales peuvent ponctuellement prendre plus de
// 30 s. Le site garde donc le dernier état fiable une minute ; le script reste
// la source de vérité et continue d'actualiser son heartbeat toutes les 2 s.
export const LIVE_CLIENT_STALE_MS = 60000;
export const LIVE_SESSION_STALE_MS = 60000;

export function normalizeLiveClientState(client = {}) {
  const presenceUnavailable = client.riotClient === true
    && client.state === 'error'
    && /^Presence:\s*HTTP 404$/i.test(String(client.error || '').trim());
  return presenceUnavailable
    ? { ...client, state:'idle', standby:true, error:'' }
    : client;
}

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
      const ts = liveTimestamp(client, now);
      return normalizeLiveClientState({
        puuid,
        ...client,
        matchId: client.matchId || session.matchId || '',
        playerName: client.playerName || session.playerName || '',
        age: ts ? Math.max(0, now - ts) : Infinity,
      });
    })
    .filter(client => client.online && client.age < LIVE_CLIENT_STALE_MS)
    // Heartbeats arrive at slightly different times every few seconds. Sorting
    // by timestamp made every chip jump to the front after its own heartbeat.
    // The PUUID is stable for the lifetime of an account, so the visual order
    // now remains deterministic while status and details keep updating.
    .sort((a, b) => a.puuid.localeCompare(b.puuid));
}

const STATE_PRIORITY = { 'in-game': 0, 'agent-select': 1, idle: 2, online: 2, error: 3, 'riot-offline': 3 };

export function groupLiveClients(clients = []) {
  const groups = new Map();
  clients.forEach(client => {
    const sharedMatch = client.matchId && ['in-game', 'agent-select'].includes(client.state);
    const key = sharedMatch ? `match:${client.matchId}` : `client:${client.puuid}`;
    if (!groups.has(key)) groups.set(key, { key, matchId: sharedMatch ? client.matchId : '', clients: [] });
    groups.get(key).clients.push(client);
  });
  return [...groups.values()].sort((left, right) => {
    const leftPriority = Math.min(...left.clients.map(client => STATE_PRIORITY[client.state] ?? 4));
    const rightPriority = Math.min(...right.clients.map(client => STATE_PRIORITY[client.state] ?? 4));
    return leftPriority - rightPriority || left.key.localeCompare(right.key);
  });
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
