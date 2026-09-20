import { liveTimestamp } from './live-data-store.mjs?v=20260920-live-resilience';

// Deux ou trois requêtes Riot locales peuvent ponctuellement prendre plus de
// 30 s. Le site garde donc le dernier état fiable une minute ; le script reste
// la source de vérité et continue d'actualiser son heartbeat toutes les 2 s.
export const LIVE_CLIENT_STALE_MS = 60000;
export const LIVE_SESSION_STALE_MS = 60000;
export const LIVE_RECOVERY_MS = 180000;

export function liveSessionSignal(session, now = Date.now()) {
  if (!session?.active) return 'ended';
  if (!session.mapClean && !session.map) return 'invalid';
  const lastSeen = Math.max(liveTimestamp(session, now) || 0, Number(session.heartbeatAt) || 0);
  if (!lastSeen) return 'expired';
  const age = Math.max(0, now - lastSeen);
  if (age < LIVE_SESSION_STALE_MS) return 'live';
  return age < LIVE_RECOVERY_MS ? 'recovering' : 'expired';
}

export function chooseLiveSession(sessions = {}, selectedSession = null, lastConfirmed = null, now = Date.now()) {
  const active = Object.entries(sessions)
    .filter(([, session]) => ['live', 'recovering'].includes(liveSessionSignal(session, now)));
  const activeMap = Object.fromEntries(active);
  const selectedEnded = sessions[selectedSession]?.active === false;
  const cachedSignal = liveSessionSignal(lastConfirmed?.data, now);
  const canRecoverSelection = selectedSession && !selectedEnded
    && lastConfirmed?.key === selectedSession
    && now - lastConfirmed.confirmedAt < LIVE_RECOVERY_MS
    && (cachedSignal === 'live' || cachedSignal === 'recovering');

  if (!selectedSession || (!activeMap[selectedSession] && !canRecoverSelection)) {
    selectedSession = active[0]?.[0] || null;
  }
  const recoveredFromCache = Boolean(selectedSession && !activeMap[selectedSession] && canRecoverSelection);
  const data = activeMap[selectedSession] || (recoveredFromCache ? lastConfirmed.data : null);
  return { active, selectedSession, data, recoveredFromCache, selectedEnded };
}

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

function liveClientsWithAge(clients = {}, sessions = {}, now = Date.now()) {
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
    // Heartbeats arrive at slightly different times every few seconds. Sorting
    // by timestamp made every chip jump to the front after its own heartbeat.
    // The PUUID is stable for the lifetime of an account, so the visual order
    // now remains deterministic while status and details keep updating.
    .sort((a, b) => a.puuid.localeCompare(b.puuid));
}

export function freshLiveClients(clients = {}, sessions = {}, now = Date.now()) {
  return liveClientsWithAge(clients, sessions, now)
    .filter(client => client.online && client.age < LIVE_CLIENT_STALE_MS);
}

export function recoveringLiveClients(clients = {}, sessions = {}, now = Date.now()) {
  return liveClientsWithAge(clients, sessions, now)
    .filter(client => client.online && client.age >= LIVE_CLIENT_STALE_MS && client.age < LIVE_RECOVERY_MS);
}

export function retainRecentLiveClients(previous = {}, incoming = {}, now = Date.now()) {
  const retained = Object.fromEntries(Object.entries(previous).filter(([key, client]) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key) || !client?.online) return false;
    const timestamp = liveTimestamp(client, now);
    return timestamp > 0 && now - timestamp < LIVE_RECOVERY_MS;
  }));
  return { ...retained, ...incoming };
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
