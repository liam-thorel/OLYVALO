export function historyReports(game) {
  if (!game || typeof game !== 'object') return [];
  const nested = Array.isArray(game.reports)
    ? game.reports
    : game.reports && typeof game.reports === 'object'
      ? Object.values(game.reports)
      : [];
  if (nested.length) return nested.filter(report => report && typeof report === 'object' && report.map);
  return game.map || game.player || game.playerPuuid ? [game] : [];
}

export function normalizeHistoryEntries(data = {}) {
  return Object.entries(data || {}).map(([historyId, value]) => {
    if (!value || typeof value !== 'object') return null;
    const nested = value.reports && typeof value.reports === 'object'
      ? Object.values(value.reports).filter(report => report && typeof report === 'object' && report.map)
      : [];
    const legacy = value.map ? [{ ...value, reports: undefined }] : [];
    const byOwner = new Map();
    [...legacy, ...nested].forEach(report => {
      const owner = String(report.playerPuuid || report.player || `unknown-${byOwner.size}`).toLowerCase();
      byOwner.set(owner, report);
    });
    const reports = [...byOwner.values()];
    if (!reports.length) return null;
    const representative = [...reports].sort((a, b) => {
      const detailedA = (a.players || []).filter(player => player?.stats).length;
      const detailedB = (b.players || []).filter(player => player?.stats).length;
      return detailedB - detailedA || (b.endTs || b.ts || 0) - (a.endTs || a.ts || 0);
    })[0];
    return { ...representative, historyId, reports };
  }).filter(Boolean);
}

export function historyMode(game) {
  const mode = String(game?.mode || '').toLowerCase();
  if (mode.includes('deathmatch')) return 'deathmatch';
  if (mode.includes('competitive') || mode === 'comp') return 'competitive';
  return 'other';
}

export function isOpaquePlayerName(name) {
  const value = String(name || '').trim();
  return /^[0-9a-f]{8}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)
    || /^player[-_ ]?[0-9a-f]{6,}$/i.test(value);
}

export function isHistorySelf(game, player) {
  if (!game || !player) return false;
  return historyReports(game).some(report => {
    if (report.playerPuuid && player.puuid) return report.playerPuuid === player.puuid;
    return Boolean(report.player && player.name && report.player === player.name);
  });
}

export function historyPlayerName(game, player, index = 0) {
  const raw = String(player?.name || '').trim();
  if (isHistorySelf(game, player)) {
    const matchingReport = historyReports(game).find(report =>
      (report.playerPuuid && player?.puuid && report.playerPuuid === player.puuid)
      || (report.player && player?.name && report.player === player.name)
    ) || historyReports(game)[0];
    const owner = String(matchingReport?.player || '').trim();
    if (owner && !isOpaquePlayerName(owner)) return owner.split('#')[0];
    if (!isOpaquePlayerName(raw)) return raw.split('#')[0];
    return 'Vous';
  }
  if (!raw || isOpaquePlayerName(raw)) return `Joueur ${index + 1}`;
  return raw.split('#')[0];
}

export function historyOwnerKey(game) {
  const report = historyReports(game)[0] || game;
  return String(report?.player || 'Inconnu').split('#')[0].trim().toLowerCase();
}

export function historyOwnerKeys(game) {
  return [...new Set(historyReports(game).map(report => historyOwnerKey(report)))];
}

export function historyOwnerLabel(game, roster = []) {
  return historyReports(game).map(report => {
    const account = historyOwnerKey(report);
    const member = roster.find(player => [player.riot, ...(player.smurfs || [])]
      .some(riot => String(riot?.name || '').trim().toLowerCase() === account));
    return member?.name || String(report?.player || 'Inconnu').split('#')[0];
  }).filter((label, index, labels) => labels.indexOf(label) === index).join(' & ') || 'Inconnu';
}

export function historyGameForOwner(game, owner) {
  if (!game || owner === 'all') return game;
  const report = historyReports(game).find(candidate => historyOwnerKey(candidate) === owner);
  return report ? { ...report, historyId: game.historyId, reports: [report] } : game;
}

export function filterHistoryGames(games, filters, now = Date.now()) {
  const dayKey = timestamp => {
    const date = new Date(timestamp || 0);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  return games.filter(game => {
    if (filters.owner !== 'all' && !historyOwnerKeys(game).includes(filters.owner)) return false;
    if (filters.period === 'today' && dayKey(game.ts) !== dayKey(now)) return false;
    if (filters.period === '7d' && (game.ts || 0) < now - 7 * 86400000) return false;
    if (filters.view === 'matches' && filters.mode !== 'all' && historyMode(game) !== filters.mode) return false;
    return true;
  });
}

export function historyRankedPlayers(game) {
  const players = (game?.players || []).filter(player => player?.stats);
  const deathmatch = historyMode(game) === 'deathmatch';
  return [...players].sort((a, b) => {
    if (deathmatch) {
      const killDiff = (b.stats?.kills || 0) - (a.stats?.kills || 0);
      if (killDiff) return killDiff;
    }
    return (b.stats?.score || 0) - (a.stats?.score || 0);
  });
}

export function historyPlayerPerformance(game, owner = null) {
  const report = owner
    ? historyReports(game).find(candidate => historyOwnerKey(candidate) === owner) || historyReports(game)[0] || game
    : historyReports(game)[0] || game;
  const rankedPlayers = historyRankedPlayers(report);
  const self = rankedPlayers.find(player => isHistorySelf(report, player)) || null;
  const deaths = self?.stats?.deaths || 0;
  return {
    report,
    self,
    mvp: rankedPlayers[0] || null,
    placement: self ? rankedPlayers.indexOf(self) + 1 : null,
    playerCount: rankedPlayers.length,
    kd: self ? (self.stats?.kills || 0) / Math.max(1, deaths) : null,
  };
}

export function historyPlayerPerformances(game) {
  return historyReports(game).map(report => historyPlayerPerformance(report));
}

export function historyDailyPerformances(games, roster = []) {
  const byOwner = new Map();
  games.forEach(game => {
    historyReports(game).forEach(report => {
      const performance = historyPlayerPerformance(report);
      const self = performance.self;
      if (!self?.stats) return;

      const key = historyOwnerKey(report);
      if (!byOwner.has(key)) {
        byOwner.set(key, {
          key,
          name: historyOwnerLabel(report, roster),
          games: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          mvps: 0,
          best: null,
        });
      }

      const entry = byOwner.get(key);
      const kills = self.stats.kills || 0;
      const deaths = self.stats.deaths || 0;
      const assists = self.stats.assists || 0;
      const kd = kills / Math.max(1, deaths);
      entry.games++;
      entry.kills += kills;
      entry.deaths += deaths;
      entry.assists += assists;
      if (performance.mvp === self) entry.mvps++;

      if (!entry.best || kd > entry.best.kd || (kd === entry.best.kd && kills > entry.best.kills)) {
        entry.best = {
          map: report.map || '?',
          mode: historyMode(report),
          agent: self.agent || '?',
          kills,
          deaths,
          assists,
          kd,
          placement: performance.placement,
          playerCount: performance.playerCount,
        };
      }
    });
  });

  return [...byOwner.values()].map(entry => ({
    ...entry,
    kd: entry.kills / Math.max(1, entry.deaths),
  })).sort((a, b) => b.kd - a.kd || b.kills - a.kills || a.name.localeCompare(b.name, 'fr'));
}
