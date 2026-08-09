import { liveTimestamp } from './live-data-store.mjs?v=20260810-firebase-lifecycle';

const VALID_GAMES = new Set(['valorant', 'lol']);

export function normalizeGames(account = {}) {
  const requested = Array.isArray(account.games) ? account.games : account.game ? [account.game] : ['valorant'];
  const games = [...new Set(requested.map(value => String(value).toLowerCase()).filter(value => VALID_GAMES.has(value)))];
  return games.length ? games : ['valorant'];
}

export function accountRiotId(account = {}) {
  if (account.playerName) return String(account.playerName).trim();
  const name = String(account.name || '').trim();
  const tag = String(account.tag || '').trim();
  return tag ? `${name}#${tag}` : name;
}

export function sameRiotAccount(left = {}, right = {}) {
  if (left.puuid && right.puuid && String(left.puuid) === String(right.puuid)) return true;
  return accountRiotId(left).toLocaleLowerCase('fr') === accountRiotId(right).toLocaleLowerCase('fr');
}

export function assignedAccounts(overlayAccounts = {}) {
  return Object.entries(overlayAccounts).flatMap(([memberId, accounts]) =>
    Object.entries(accounts || {}).map(([key, account]) => ({ memberId, key, ...account }))
  );
}

export function discoveryRows(discovered = {}, lolClients = {}, overlayAccounts = {}, ignoredAccounts = {}) {
  const assigned = assignedAccounts(overlayAccounts);
  const legacyRows = Object.entries(discovered || {}).map(([key, entry]) => ({
    ...entry, key, sourcePath: `discovered/${key}`, source: entry.game || entry.source || 'valorant',
  }));
  const lolRows = Object.entries(lolClients || {}).map(([key, entry]) => ({
    ...entry, key: `lol:${key}`, sourceKey: key, sourcePath: `live/lolClients/${key}`, source: 'lol', game: 'lol', games: ['lol'],
  }));
  return [...legacyRows, ...lolRows]
    .filter(row => row.playerName)
    .filter(row => !ignoredAccounts[row.sourceKey || row.key])
    .filter(row => !assigned.some(account => sameRiotAccount(account, row)))
    .sort((a, b) => Number(b.lastSeen || b.ts || 0) - Number(a.lastSeen || a.ts || 0));
}

export function accountLiveState(account, { lolClients = {}, lolSessions = {}, valorantClients = {}, valorantSessions = {} } = {}, now = Date.now()) {
  const pools = normalizeGames(account).includes('lol')
    ? [lolSessions, lolClients, valorantSessions, valorantClients]
    : [valorantSessions, valorantClients, lolSessions, lolClients];
  const entries = pools.flatMap(pool => Object.entries(pool || {}).map(([key, entry]) => ({
    ...(entry || {}),
    // Les clients Valorant sont indexés par PUUID dans Firebase, mais les
    // anciennes versions du script ne le répétaient pas dans la valeur.
    puuid: entry?.puuid || key,
  })));
  const match = entries
    .filter(entry => sameRiotAccount(account, entry))
    .sort((left, right) => Number(right.ts || right.lastSeen || 0) - Number(left.ts || left.lastSeen || 0))[0];
  if (!match) return { label: 'Jamais détecté', state: 'unknown', ts: 0 };
  const ts = liveTimestamp(match, now);
  const fresh = ts > 0 && now - ts < 90_000;
  if (match.active && fresh) return { label: 'En partie', state: 'ingame', ts };
  if (fresh) return { label: match.phase === 'ChampSelect' ? 'Champ select' : 'Client connecté', state: 'online', ts };
  return { label: 'Hors ligne', state: 'offline', ts };
}
