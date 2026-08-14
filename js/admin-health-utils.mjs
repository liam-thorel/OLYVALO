import { liveTimestamp } from './live-data-store.mjs?v=20260810-firebase-connection-fix';

export const HEALTH_FRESH_MS = 45_000;
export const HEALTH_RECENT_MS = 120_000;

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('fr');
}

const timestamp = liveTimestamp;

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function sameClientIdentity(row, entry = {}) {
  if (row.memberId && entry.memberId && row.memberId === entry.memberId) return true;
  const playerName = normalize(entry.playerName);
  return Boolean(playerName && row.accounts.some(account => normalize(account) === playerName));
}

function sessionForClient(key, client, sessions = {}) {
  if (sessions[key]) return sessions[key];
  return Object.values(sessions).find(session => sameClientIdentity({
    memberId: client.memberId || '',
    accounts: [client.playerName || ''],
  }, session)) || null;
}

function memberInfo(memberId, memberName, members) {
  const byId = members.find(member => member.id === memberId);
  const byName = members.find(member => normalize(member.name) === normalize(memberName));
  return byId || byName || null;
}

function linkedAccount(entry = {}, accountLinks = []) {
  const puuid = String(entry.puuid || '');
  const playerName = normalize(entry.playerName);
  return accountLinks.find(account =>
    (puuid && account.puuid && puuid === String(account.puuid))
    || (playerName && normalize(account.playerName) === playerName)
  ) || null;
}

function accountsForMember(memberId, accountLinks = []) {
  return accountLinks.filter(account => account.memberId === memberId).map(account => account.playerName).filter(Boolean);
}

function stateLabel(state) {
  return ({
    'in-game': 'En partie',
    'agent-select': 'Agent Select',
    ready: 'Script prêt',
    error: 'À vérifier',
    offline: 'Hors ligne',
  })[state] || 'Hors ligne';
}

function completeRow(row, latestVersion, now) {
  const clients = [row.valorantClient, ...row.lolClients].filter(Boolean);
  const newestClient = [...clients].sort((left, right) => timestamp(right) - timestamp(left))[0] || {};
  const heartbeatAt = timestamp(newestClient, now);
  const age = heartbeatAt ? Math.max(0, now - heartbeatAt) : Infinity;
  const valorantFresh = Boolean(row.valorantClient?.online && now - timestamp(row.valorantClient, now) < HEALTH_FRESH_MS);
  const lolFresh = row.lolClients.some(client => client.connected && now - timestamp(client, now) < HEALTH_FRESH_MS);
  const connected = valorantFresh || lolFresh;
  const valorantSessionFresh = Boolean(row.valorantSession?.active && now - timestamp(row.valorantSession, now) < HEALTH_RECENT_MS);
  const lolSessionFresh = Boolean(row.lolSession?.active && now - timestamp(row.lolSession, now) < HEALTH_RECENT_MS);
  const rawState = row.valorantClient?.state || '';
  const lolPhase = newestClient.phase || '';
  const error = String(row.valorantClient?.error || '').trim();

  let state = 'offline';
  if (valorantSessionFresh || lolSessionFresh || rawState === 'in-game') state = 'in-game';
  else if (rawState === 'agent-select' || lolPhase === 'ChampSelect') state = 'agent-select';
  else if (rawState === 'error' || rawState === 'riot-offline' || error) state = 'error';
  else if (connected) state = 'ready';

  const version = String(newestClient.version || newestClient.scriptVersion || '');
  const outdated = Boolean(version && latestVersion && compareVersions(version, latestVersion) < 0);
  const currentSession = valorantSessionFresh ? row.valorantSession : lolSessionFresh ? row.lolSession : null;
  const account = row.valorantClient?.playerName || newestClient.playerName || row.accounts[0] || '';
  const issues = [];
  if (connected && !row.memberId) issues.push('Identité OLYCITY non associée');
  if (outdated) issues.push(`Mise à jour ${latestVersion} disponible`);
  if (error) issues.push(error);
  if (rawState === 'riot-offline') issues.push('Client Riot non détecté');
  if (newestClient.online && age >= HEALTH_FRESH_MS) issues.push('Signal interrompu');

  return {
    ...row,
    member: memberInfo(row.memberId, row.memberName, row.members),
    account,
    age,
    heartbeatAt,
    connected,
    state,
    stateLabel: stateLabel(state),
    version,
    latestVersion,
    outdated,
    issues,
    currentSession,
    map: currentSession?.mapClean || currentSession?.map || row.valorantClient?.map || '',
    server: currentSession?.server || row.valorantClient?.server || '',
    mode: currentSession?.mode || '',
    riotClient: row.valorantClient ? Boolean(row.valorantClient.riotClient) : null,
    autoStart: connected && version && compareVersions(version, '4.15.16') >= 0 ? 'managed' : 'unknown',
  };
}

export function buildScriptHealth({
  members = [],
  valorantClients = {},
  valorantSessions = {},
  lolClients = {},
  lolSessions = {},
  accountLinks = [],
  latestVersion = '',
  now = Date.now(),
} = {}) {
  const rows = Object.entries(valorantClients || {}).map(([key, client]) => {
    const link = linkedAccount(client, accountLinks);
    const memberId = client?.memberId || link?.memberId || '';
    return {
      id: `valorant:${key}`,
      valorantKey: key,
      valorantClient: client || {},
      valorantSession: sessionForClient(key, client || {}, valorantSessions),
      lolKeys: [],
      lolClients: [],
      lolSession: null,
      memberId,
      memberName: client?.member || '',
      accounts: [...new Set([client?.playerName || '', ...accountsForMember(memberId, accountLinks)].filter(Boolean))],
      members,
    };
  });

  Object.entries(lolClients || {}).forEach(([key, client]) => {
    const link = linkedAccount(client, accountLinks);
    const linkedMemberId = client?.memberId || link?.memberId || '';
    const linkedClient = { ...client, memberId: linkedMemberId };
    let row = rows.find(candidate => sameClientIdentity(candidate, linkedClient));
    if (!row) {
      row = {
        id: `lol:${key}`,
        valorantKey: '',
        valorantClient: null,
        valorantSession: null,
        lolKeys: [],
        lolClients: [],
        lolSession: null,
        memberId: linkedMemberId,
        memberName: client?.member || '',
        accounts: accountsForMember(linkedMemberId, accountLinks),
        members,
      };
      rows.push(row);
    }
    row.lolKeys.push(key);
    row.lolClients.push(client || {});
    if (client?.playerName && !row.accounts.includes(client.playerName)) row.accounts.push(client.playerName);
    if (!row.memberId && linkedMemberId) row.memberId = linkedMemberId;
    if (!row.memberName && client?.member) row.memberName = client.member;
    const session = sessionForClient(key, client || {}, lolSessions);
    if (session && (!row.lolSession || timestamp(session) > timestamp(row.lolSession))) row.lolSession = session;
  });

  members.forEach(member => {
    const exists = rows.some(row => row.memberId === member.id || normalize(row.memberName) === normalize(member.name));
    if (exists) return;
    rows.push({
      id: `member:${member.id}`,
      valorantKey: '', valorantClient: null, valorantSession: null,
      lolKeys: [], lolClients: [], lolSession: null,
      memberId: member.id, memberName: member.name, accounts: accountsForMember(member.id, accountLinks), members,
    });
  });

  const completed = rows.map(row => completeRow(row, latestVersion, now));
  const rowsByMember = new Map();
  completed.forEach(row => {
    if (!row.memberId) return;
    if (!rowsByMember.has(row.memberId)) rowsByMember.set(row.memberId, []);
    rowsByMember.get(row.memberId).push(row);
  });

  // Un changement de compte ou un arrêt Windows brutal peut laisser une
  // ancienne présence pendant quelques heures. Dès qu'une installation du
  // même membre émet de nouveau, cette fiche périmée ne doit plus passer avant
  // la fiche actuelle. En revanche, plusieurs installations réellement
  // connectées restent visibles afin de signaler un vrai doublon.
  const visibleRows = completed.filter(row => {
    if (!row.memberId) return true;
    const siblings = rowsByMember.get(row.memberId) || [];
    const connected = siblings.filter(candidate => candidate.connected);
    if (connected.length) return row.connected;
    const newest = [...siblings].sort((left, right) => right.heartbeatAt - left.heartbeatAt)[0];
    return row === newest;
  });

  const connectedByMember = visibleRows.reduce((counts, row) => {
    if (row.connected && row.memberId) counts[row.memberId] = (counts[row.memberId] || 0) + 1;
    return counts;
  }, {});
  visibleRows.forEach(row => {
    row.duplicateCount = row.memberId ? connectedByMember[row.memberId] || 0 : 0;
    if (row.duplicateCount > 1) row.issues.push(`${row.duplicateCount} scripts actifs pour ce membre`);
  });

  const memberOrder = new Map(members.map((member, index) => [member.id, index]));
  const priority = { error: 0, 'in-game': 1, 'agent-select': 2, ready: 3, offline: 4 };
  return visibleRows.sort((left, right) =>
    (priority[left.state] ?? 5) - (priority[right.state] ?? 5)
    || (memberOrder.get(left.memberId) ?? 999) - (memberOrder.get(right.memberId) ?? 999)
    || left.id.localeCompare(right.id)
  );
}

export function scriptHealthSummary(rows = []) {
  return {
    total: rows.length,
    connected: rows.filter(row => row.connected).length,
    playing: rows.filter(row => ['in-game', 'agent-select'].includes(row.state)).length,
    issues: rows.filter(row => row.issues.length > 0).length,
    offline: rows.filter(row => row.state === 'offline').length,
  };
}

export function scriptDiagnosticText(row, now = Date.now()) {
  const ageSeconds = Number.isFinite(row.age) ? Math.round(row.age / 1000) : null;
  return [
    `Membre: ${row.member?.name || row.memberName || row.memberId || 'Non associé'}`,
    `Compte: ${row.account || 'Inconnu'}`,
    `État: ${row.stateLabel}`,
    `Version: ${row.version || 'Inconnue'}${row.outdated ? ` (dernière: ${row.latestVersion})` : ''}`,
    `Dernier signal: ${ageSeconds === null ? 'jamais' : `${ageSeconds}s`}`,
    `Client Riot: ${row.riotClient === null ? 'non observé' : row.riotClient ? 'détecté' : 'absent'}`,
    `Partie: ${[row.map, row.mode, row.server].filter(Boolean).join(' · ') || 'aucune'}`,
    `Problèmes: ${row.issues.join(' · ') || 'aucun'}`,
    `Diagnostic généré: ${new Date(now).toISOString()}`,
  ].join('\n');
}
