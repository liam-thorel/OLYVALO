/**
 * Historique perso partagé — utilisé par le moteur de cotes (odds.js) et par
 * la commande /stats. Source de vérité : live/lolHistory (LoL) et
 * live/history/*\/reports (Valorant), alimentés par les scripts locaux à
 * chaque fin de game.
 */
const { fbGet } = require('./firebase.js');

const HISTORY_SAMPLE_SIZE = 20;

async function lolHistoryFor(riotIds) {
  const history = await fbGet('live/lolHistory').catch(() => null);
  return Object.values(history || {})
    .filter(entry => riotIds.some(id => id.toLowerCase() === String(entry.playerName || '').toLowerCase()))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

async function valorantHistoryFor(riotIds) {
  const historyRoot = await fbGet('live/history').catch(() => null);
  const allReports = [];
  Object.values(historyRoot || {}).forEach(match => {
    Object.values(match?.reports || {}).forEach(report => allReports.push(report));
  });

  return allReports
    .map(report => {
      const self = (report.players || []).find(p => riotIds.some(id => id.toLowerCase() === String(p.name || '').toLowerCase()));
      if (!self) return null;
      return {
        win: report.result === 'win' ? true : report.result === 'loss' ? false : null,
        champion: self.agent ? { name: self.agent } : null,
        kills: self.stats?.kills ?? null,
        deaths: self.stats?.deaths ?? null,
        assists: self.stats?.assists ?? null,
        map: report.map || '',
        ts: report.ts || report.endTs || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts - a.ts);
}

async function historyFor(game, riotIds) {
  return game === 'lol' ? lolHistoryFor(riotIds) : valorantHistoryFor(riotIds);
}

async function winrateFor(game, riotIds, championOrAgentName) {
  const entries = await historyFor(game, riotIds);
  const withResult = entries.filter(e => typeof e.win === 'boolean');
  const recent = withResult.slice(0, HISTORY_SAMPLE_SIZE);
  const overall = recent.length ? recent.filter(e => e.win).length / recent.length : null;

  const onChampion = championOrAgentName ? withResult.filter(e => e.champion?.name === championOrAgentName) : [];
  const champion = onChampion.length ? onChampion.filter(e => e.win).length / onChampion.length : null;

  return { overall, champion, sampleSize: recent.length, championSampleSize: onChampion.length };
}

function mostPlayed(entries, limit = 3) {
  const counts = new Map();
  entries.forEach(entry => {
    const name = entry.champion?.name;
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

// Forme récente : tableau de booléens (true = victoire), le plus récent en premier.
function recentForm(entries, limit = 10) {
  return entries.filter(e => typeof e.win === 'boolean').slice(0, limit).map(e => e.win);
}

// Ratio kills/morts agrégé sur l'historique connu (0 si aucune mort ni kill).
function killDeathRatio(entries) {
  const totalKills = entries.reduce((sum, e) => sum + (e.kills || 0), 0);
  const totalDeaths = entries.reduce((sum, e) => sum + (e.deaths || 0), 0);
  if (totalDeaths === 0) return totalKills > 0 ? totalKills : 0;
  return totalKills / totalDeaths;
}

module.exports = { historyFor, winrateFor, mostPlayed, recentForm, killDeathRatio, HISTORY_SAMPLE_SIZE };
