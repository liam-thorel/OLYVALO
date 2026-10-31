/**
 * Chiffres de la page Historique, dans l'esprit des profils tracker.gg :
 * vue d'ensemble (victoires, K/D, ACS, HS %…), agents, maps, joueurs du
 * groupe et parties regroupées par jour.
 *
 * Une partie jouée à plusieurs contient un rapport par membre suivi : les
 * statistiques individuelles (K/D, ACS…) comptent chaque membre, les
 * victoires comptent la partie une seule fois.
 */
import { historyMode, historyOwnerKey, historyPlayerPerformance, historyReports } from './history-utils.mjs?v=20261005-sites-history';
import { ladderLabel, valorantLadderPoint } from './rr-curve-utils.mjs?v=20261006-proprietaire';

// Jeu de paliers compétitifs actuel de valorant-api.com (depuis l'épisode 5).
const TIERS_UUID = '03621f52-342b-cf4e-4f86-9350a49c6d04';
const VALORANT_RANKS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'];

export function valorantTierIcon(tier) {
  const value = Number(tier);
  return Number.isInteger(value) && value >= 3 && value <= 27
    ? `https://media.valorant-api.com/competitivetiers/${TIERS_UUID}/${value}/smallicon.png`
    : '';
}

/** « Or 2 », ou « Or 2 · 45 RR » avec les RR. */
export function valorantTierLabel(tier, rr = null) {
  const value = Number(tier);
  if (!Number.isInteger(value) || value < 3) return '';
  const point = valorantLadderPoint(value, rr);
  if (point !== null) return ladderLabel('valorant', point);
  const index = value >= 27 ? 8 : Math.floor((value - 3) / 3);
  return index >= 8 ? VALORANT_RANKS[8] : `${VALORANT_RANKS[index]} ${(value - 3) % 3 + 1}`;
}

export const gameDurationMs = game => game?.durationMs || Math.max(0, (game?.endTs || 0) - (game?.ts || 0));

const isDecided = game => game?.result === 'win' || game?.result === 'loss';

/** Ce que chaque membre suivi a fait dans la partie (rapports sans stats exclus). */
export function trackedPerformances(game) {
  return historyReports(game)
    .map(report => ({ report, ...historyPlayerPerformance(report) }))
    .filter(entry => entry.self?.stats);
}

/** Performance mise en avant sur la ligne d'une partie : le meilleur ACS (ou score en DM). */
export function featuredPerformance(game) {
  const deathmatch = historyMode(game) === 'deathmatch';
  const metric = entry => (deathmatch ? entry.self.stats.kills : entry.self.stats.acs ?? entry.self.stats.score) || 0;
  return trackedPerformances(game).sort((a, b) => metric(b) - metric(a))[0] || null;
}

function emptyTotals() {
  return { performances: 0, kills: 0, deaths: 0, assists: 0, acsSum: 0, acsCount: 0, hsSum: 0, hsCount: 0, mvps: 0, maxKills: 0 };
}

function addPerformance(totals, entry) {
  const stats = entry.self.stats;
  totals.performances += 1;
  totals.kills += stats.kills || 0;
  totals.deaths += stats.deaths || 0;
  totals.assists += stats.assists || 0;
  totals.maxKills = Math.max(totals.maxKills, stats.kills || 0);
  if (Number.isFinite(stats.acs) && stats.acs > 0) { totals.acsSum += stats.acs; totals.acsCount += 1; }
  if (Number.isFinite(stats.hsPercent)) { totals.hsSum += stats.hsPercent; totals.hsCount += 1; }
  if (entry.placement === 1 && entry.playerCount > 1) totals.mvps += 1;
}

function ratios(totals) {
  return {
    kd: totals.performances ? totals.kills / Math.max(1, totals.deaths) : null,
    kda: totals.performances ? (totals.kills + totals.assists) / Math.max(1, totals.deaths) : null,
    acs: totals.acsCount ? Math.round(totals.acsSum / totals.acsCount) : null,
    hs: totals.hsCount ? Math.round(totals.hsSum / totals.hsCount) : null,
    killsPerGame: totals.performances ? totals.kills / totals.performances : null,
  };
}

const winrate = (wins, decided) => (decided ? Math.round(wins / decided * 100) : null);

/** Vue d'ensemble des parties affichées. */
export function historyOverview(games = []) {
  const totals = emptyTotals();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let rrNet = 0;
  let rrGames = 0;
  let durationMs = 0;
  const recent = [];
  games.forEach(game => {
    durationMs += gameDurationMs(game);
    trackedPerformances(game).forEach(entry => addPerformance(totals, entry));
    if (historyMode(game) !== 'competitive') return;
    if (game.result === 'win') wins += 1;
    else if (game.result === 'loss') losses += 1;
    else if (game.result === 'draw') draws += 1;
    if (isDecided(game) || game.result === 'draw') recent.push(game.result);
    historyReports(game).forEach(report => {
      if (Number.isFinite(report?.rr?.delta)) { rrNet += report.rr.delta; rrGames += 1; }
    });
  });
  return {
    games: games.length,
    competitive: games.filter(game => historyMode(game) === 'competitive').length,
    deathmatch: games.filter(game => historyMode(game) === 'deathmatch').length,
    wins, losses, draws,
    winrate: winrate(wins, wins + losses),
    rrNet: rrGames ? rrNet : null,
    durationMs,
    ...totals,
    ...ratios(totals),
    // Les plus récentes d'abord : les parties arrivent triées.
    recent: recent.slice(0, 10),
  };
}

function groupStats(games, keyOf, labelOf) {
  const groups = new Map();
  games.forEach(game => {
    const mode = historyMode(game);
    trackedPerformances(game).forEach(entry => {
      const key = keyOf(entry, game);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, label: labelOf(entry, game), games: 0, wins: 0, losses: 0, totals: emptyTotals(), last: null });
      const group = groups.get(key);
      group.games += 1;
      if (mode === 'competitive' && game.result === 'win') group.wins += 1;
      if (mode === 'competitive' && game.result === 'loss') group.losses += 1;
      addPerformance(group.totals, entry);
      if (!group.last) group.last = entry.report;
    });
  });
  return [...groups.values()].map(({ totals, ...group }) => ({
    ...group,
    ...ratios(totals),
    mvps: totals.mvps,
    winrate: winrate(group.wins, group.wins + group.losses),
  })).sort((a, b) => b.games - a.games || (b.winrate ?? -1) - (a.winrate ?? -1) || a.label.localeCompare(b.label, 'fr'));
}

/** Agents joués par les membres suivis. */
export function historyAgentStats(games = []) {
  return groupStats(games, entry => entry.self.agent && entry.self.agent !== '?' ? entry.self.agent : null, entry => entry.self.agent);
}

/** Maps, en compétitif seulement (les victoires n'ont de sens qu'en équipe). */
export function historyMapStats(games = []) {
  const byMap = new Map();
  games.filter(game => historyMode(game) === 'competitive' && game.map).forEach(game => {
    if (!byMap.has(game.map)) byMap.set(game.map, { map: game.map, games: 0, wins: 0, losses: 0, totals: emptyTotals() });
    const entry = byMap.get(game.map);
    entry.games += 1;
    if (game.result === 'win') entry.wins += 1;
    if (game.result === 'loss') entry.losses += 1;
    trackedPerformances(game).forEach(performance => addPerformance(entry.totals, performance));
  });
  return [...byMap.values()].map(({ totals, ...entry }) => ({
    ...entry,
    ...ratios(totals),
    winrate: winrate(entry.wins, entry.wins + entry.losses),
  })).sort((a, b) => b.games - a.games || (b.winrate ?? -1) - (a.winrate ?? -1) || a.map.localeCompare(b.map, 'fr'));
}

/** Membre du roster derrière un rapport (compte principal ou smurf). */
export function historyRosterMember(report, roster = []) {
  const name = String(report?.player || '').split('#')[0].trim().toLowerCase();
  const puuid = String(report?.playerPuuid || '').trim().toLowerCase();
  return roster.find(member => [member.riot, ...(member.smurfs || [])].some(account => {
    const accountPuuid = String(account?.puuid || '').trim().toLowerCase();
    if (puuid && accountPuuid) return puuid === accountPuuid;
    return Boolean(name) && String(account?.name || '').trim().toLowerCase() === name;
  })) || null;
}

/**
 * Joueurs du groupe : un par compte suivi, avec son dernier rang connu. Les
 * parties arrivent de la plus récente à la plus ancienne.
 */
export function historyMemberStats(games = [], roster = []) {
  const members = groupStats(games, entry => historyOwnerKey(entry.report), entry => {
    const member = historyRosterMember(entry.report, roster);
    return member?.name || String(entry.report.player || 'Inconnu').split('#')[0];
  });
  return members.map(entry => {
    const ranked = games.flatMap(game => historyReports(game))
      .find(report => historyOwnerKey(report) === entry.key && Number.isInteger(Number(report?.rr?.tier)) && report.rr.tier !== null);
    const member = historyRosterMember(entry.last, roster);
    return {
      ...entry,
      avatar: member?.avatar || '',
      riotId: String(entry.last?.player || ''),
      tier: ranked ? Number(ranked.rr.tier) : null,
      rr: ranked?.rr?.after ?? null,
    };
  });
}

const localDayKey = ts => {
  const date = new Date(ts || 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Parties regroupées par jour, avec le bilan de chaque journée. */
export function historyDayGroups(games = [], now = Date.now()) {
  const today = localDayKey(now);
  const yesterday = localDayKey(now - 86_400_000);
  const days = new Map();
  games.forEach(game => {
    const key = localDayKey(game.ts);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(game);
  });
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, dayGames]) => {
    const overview = historyOverview(dayGames);
    const label = key === today ? "Aujourd'hui" : key === yesterday ? 'Hier'
      : new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return { key, label, ...overview, count: overview.games, games: dayGames };
  });
}
