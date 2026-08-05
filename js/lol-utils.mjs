export const LOL_FRESH_MS = 55_000;

export function isLolSessionActive(session, now = Date.now()) {
  if (!session || session.active === false) return false;
  const ts = Number(session.ts || session.updatedAt || 0);
  return Boolean(session.matchId) && ts > 0 && now - ts <= LOL_FRESH_MS;
}

export function activeLolSessions(raw, now = Date.now()) {
  return Object.entries(raw || {})
    .map(([id, value]) => ({ id, ...(value || {}) }))
    .filter(session => isLolSessionActive(session, now))
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

export function groupLolSessions(raw, now = Date.now()) {
  const groups = new Map();
  for (const session of activeLolSessions(raw, now)) {
    const key = String(session.matchId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  return [...groups.entries()].map(([matchId, players]) => ({ matchId, players }));
}

function looksLikeMatch(value) {
  return value && typeof value === 'object' && (
    'champion' in value || 'kills' in value || 'win' in value || 'gameLengthSeconds' in value
  );
}

export function normalizeLolHistory(raw) {
  const matches = [];
  function visit(value, key = '') {
    if (!value || typeof value !== 'object') return;
    if (looksLikeMatch(value)) {
      matches.push({ id: key || String(value.matchId || value.ts || matches.length), ...value });
      return;
    }
    Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  }
  visit(raw);
  return matches.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

export function lolKda(match) {
  const deaths = Math.max(1, Number(match?.deaths || 0));
  return ((Number(match?.kills || 0) + Number(match?.assists || 0)) / deaths).toFixed(1);
}

export function lolDayKey(ts) {
  return new Date(Number(ts || 0)).toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function summarizeLolDays(matches) {
  const days = new Map();
  for (const match of matches) {
    const key = lolDayKey(match.ts);
    const day = days.get(key) || { date: key, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    day.games += 1;
    day.wins += match.win ? 1 : 0;
    day.kills += Number(match.kills || 0);
    day.deaths += Number(match.deaths || 0);
    day.assists += Number(match.assists || 0);
    days.set(key, day);
  }
  return [...days.values()];
}

export function mergeFirebaseEvent(current, event) {
  if (!event || event.path === '/') return event?.data || {};
  const next = { ...(current || {}) };
  const parts = String(event.path).split('/').filter(Boolean);
  if (!parts.length) return event.data || {};
  let target = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    target[parts[i]] = { ...(target[parts[i]] || {}) };
    target = target[parts[i]];
  }
  const leaf = parts.at(-1);
  if (event.data === null) delete target[leaf];
  else target[leaf] = event.data;
  return next;
}
