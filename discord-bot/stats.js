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
        hsPercent: self.stats?.hsPercent ?? null,
        map: report.map || '',
        mode: report.mode || '',
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

// KDA agrégé : (somme des kills + somme des assists) / somme des morts sur
// toutes les games — pas une moyenne des KDA individuels, qui pondérerait
// chaque game de façon égale peu importe combien de kills/morts elle contient.
function aggregateKDA(entries) {
  const withStats = entries.filter(e => e.kills != null && e.deaths != null);
  if (!withStats.length) return null;
  const totalKills = withStats.reduce((sum, e) => sum + (e.kills || 0), 0);
  const totalAssists = withStats.reduce((sum, e) => sum + (e.assists || 0), 0);
  const totalDeaths = withStats.reduce((sum, e) => sum + (e.deaths || 0), 0);
  if (totalDeaths === 0) return totalKills + totalAssists;
  return (totalKills + totalAssists) / totalDeaths;
}

// % de headshots moyen sur les games où la donnée est disponible.
function averageHsPercent(entries) {
  const withHs = entries.filter(e => typeof e.hsPercent === 'number');
  if (!withHs.length) return null;
  return withHs.reduce((sum, e) => sum + e.hsPercent, 0) / withHs.length;
}

// CS moyen (LoL) sur les games où la donnée est disponible.
function averageCs(entries) {
  const withCs = entries.filter(e => typeof e.cs === 'number');
  if (!withCs.length) return null;
  return withCs.reduce((sum, e) => sum + e.cs, 0) / withCs.length;
}

// Ne garde que les games en file classée : Compétitif pour Valorant (les
// autres modes — Swift Play, Deathmatch, Spike Rush... — faussent le
// winrate/KDA d'un récap censé refléter le classé). Aucun filtre nécessaire
// côté LoL : live/index.js ne track déjà que les queues classées (420/440).
const RANKED_VALORANT_MODE = 'competitive';
function rankedOnly(game, entries) {
  return game === 'valorant' ? entries.filter(e => e.mode === RANKED_VALORANT_MODE) : entries;
}

module.exports = {
  historyFor, winrateFor, mostPlayed, recentForm, killDeathRatio, aggregateKDA, averageHsPercent, averageCs, HISTORY_SAMPLE_SIZE,
  rankedOnly, RANKED_VALORANT_MODE,
};
