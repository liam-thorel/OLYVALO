/**
 * Chiffres de la page Historique, dans l'esprit des profils tracker.gg :
 * vue d'ensemble (victoires, K/D, ACS, HS %…), agents, maps, joueurs du
 * groupe et parties regroupées par jour.
 *
 * Une partie jouée à plusieurs contient un rapport par membre suivi : les
 * statistiques individuelles (K/D, ACS…) comptent chaque membre, les
 * victoires comptent la partie une seule fois.
 */
import { historyMode, historyOwnerKey, historyPlayerPerformance, historyReports } from './history-utils.mjs?v=20261031-acte';
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
  // En deathmatch, « ACS » vaut le score entier (une seule manche) : il
  // gonflait la moyenne jusqu'à des milliers.
  if (historyMode(entry.report) !== 'deathmatch' && Number.isFinite(stats.acs) && stats.acs > 0) { totals.acsSum += stats.acs; totals.acsCount += 1; }
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

// ─── Tout l'acte, d'après la synchro Henrik (rosterStats) ────────────────────
// OLYCITY Live n'enregistre que les parties jouées pendant qu'il tourne. La
// synchro planifiée (tools/sync-roster-stats.mjs) parcourt, elle, toutes les
// compétitives de l'acte de chaque compte : c'est elle qui fait foi pour les
// statistiques quand elle est disponible.

const RANK_NAMES = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal'];

/** « Immortal 1 » → 24, « Radiant » → 27, sinon null. */
export function valorantTierFromName(name) {
  const [rank, division] = String(name || '').trim().toLowerCase().split(/\s+/);
  if (rank === 'radiant') return 27;
  const index = RANK_NAMES.indexOf(rank);
  const level = Number(division);
  return index >= 0 && level >= 1 && level <= 3 ? 3 + index * 3 + level - 1 : null;
}

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/** Enregistrements de l'acte en cours pour ces clés de compte (puuid:…). */
export function actRecords(store = {}, keys = [], actUuid = null) {
  const byKey = new Map(Object.entries(store || {}).map(([key, record]) => [key.toLowerCase(), record]));
  return [...new Set(keys.map(key => String(key || '').toLowerCase()))]
    .map(key => byKey.get(key))
    .filter(record => record && Number(record.wrGames ?? record.games) > 0)
    .filter(record => !actUuid || !record.seasonId || record.seasonId === actUuid);
}

/**
 * Vue d'ensemble de l'acte sur un ou plusieurs comptes. Les totaux bruts
 * s'additionnent ; les anciens enregistrements, qui n'ont que des ratios,
 * sont pondérés par leur nombre de parties.
 */
export function actOverview(records = []) {
  if (!records.length) return null;
  let wins = 0; let total = 0; let matches = 0;
  let kills = 0; let deaths = 0; let assists = 0; let rawCount = 0;
  let kdWeighted = 0; let kdaWeighted = 0; let kdWeight = 0;
  let score = 0; let rounds = 0; let acsWeighted = 0; let acsWeight = 0;
  let head = 0; let shots = 0; let hsWeighted = 0; let hsWeight = 0;
  let maxKills = 0; let playtimeMs = 0; let rawRecords = 0; let timedRecords = 0; let recordRecords = 0;
  records.forEach(record => {
    const games = Number(record.games) || 0;
    matches += games;
    const recordTotal = finite(record.wrGames) ? Number(record.wrGames) : (Number(record.matchWins) || 0) + (Number(record.matchLosses) || 0);
    total += recordTotal;
    wins += finite(record.wrWins) ? Number(record.wrWins) : Number(record.matchWins) || 0;
    if (finite(record.kills) && finite(record.deaths)) {
      kills += Number(record.kills); deaths += Number(record.deaths); assists += Number(record.assists) || 0; rawCount += games; rawRecords += 1;
    } else if (finite(record.kd)) {
      kdWeighted += Number(record.kd) * games; kdWeight += games;
      if (finite(record.kda)) kdaWeighted += Number(record.kda) * games;
    }
    if (finite(record.rounds) && Number(record.rounds) > 0) { score += Number(record.score) || 0; rounds += Number(record.rounds); }
    else if (finite(record.acs)) { acsWeighted += Number(record.acs) * games; acsWeight += games; }
    const recordShots = (Number(record.headshots) || 0) + (Number(record.bodyshots) || 0) + (Number(record.legshots) || 0);
    if (recordShots) { head += Number(record.headshots) || 0; shots += recordShots; }
    else if (finite(record.hsPercent)) { hsWeighted += Number(record.hsPercent) * games; hsWeight += games; }
    if (finite(record.maxKills)) { maxKills = Math.max(maxKills, Number(record.maxKills)); recordRecords += 1; }
    if (finite(record.playtimeMs) && Number(record.playtimeMs) > 0) { playtimeMs += Number(record.playtimeMs); timedRecords += 1; }
  });
  // Un total qui ne couvre qu'une partie des comptes se lirait comme celui
  // de tous : on ne l'affiche que s'il est complet.
  const complete = count => count === records.length;
  const blend = (exact, exactWeight, approx, approxWeight) => {
    const weight = exactWeight + approxWeight;
    return weight ? ((exact ?? 0) * exactWeight + approx) / weight : null;
  };
  const exactKd = rawCount ? kills / Math.max(1, deaths) : null;
  const exactKda = rawCount ? (kills + assists) / Math.max(1, deaths) : null;
  const exactAcs = rounds ? score / rounds : null;
  const exactHs = shots ? head / shots * 100 : null;
  const acsMatches = rounds ? matches - acsWeight : 0;
  const hsMatches = shots ? matches - hsWeight : 0;
  const acs = blend(exactAcs, acsMatches, acsWeighted, acsWeight);
  const hs = blend(exactHs, hsMatches, hsWeighted, hsWeight);
  return {
    games: total,
    matches,
    wins,
    losses: Math.max(0, total - wins),
    winrate: total ? Math.round(wins / total * 100) : null,
    kills: complete(rawRecords) ? kills : null,
    deaths: complete(rawRecords) ? deaths : null,
    assists: complete(rawRecords) ? assists : null,
    kd: blend(exactKd, rawCount, kdWeighted, kdWeight),
    kda: blend(exactKda, rawCount, kdaWeighted, kdWeight),
    acs: acs === null ? null : Math.round(acs),
    hs: hs === null ? null : Math.round(hs),
    killsPerGame: complete(rawRecords) && rawCount ? kills / rawCount : null,
    maxKills: complete(recordRecords) && maxKills ? maxKills : null,
    durationMs: complete(timedRecords) ? playtimeMs : null,
    recent: records.length === 1 && Array.isArray(records[0].recent) ? records[0].recent.slice(0, 10) : null,
  };
}

function mergeBreakdown(records, field, fallbackField = null) {
  const merged = new Map();
  records.forEach(record => {
    const list = Array.isArray(record[field]) && record[field].length ? record[field]
      : fallbackField && Array.isArray(record[fallbackField]) ? record[fallbackField] : [];
    list.forEach(item => {
      if (!item?.name) return;
      const entry = merged.get(item.name) || { name: item.name, games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, score: 0, rounds: 0, raw: true };
      entry.games += Number(item.games) || 0;
      entry.wins += Number(item.wins) || 0;
      entry.losses += finite(item.losses) ? Number(item.losses) : Math.max(0, (Number(item.games) || 0) - (Number(item.wins) || 0));
      if (finite(item.kills)) { entry.kills += Number(item.kills); entry.deaths += Number(item.deaths) || 0; } else entry.raw = false;
      if (finite(item.rounds) && Number(item.rounds) > 0) { entry.score += Number(item.score) || 0; entry.rounds += Number(item.rounds); }
      merged.set(item.name, entry);
    });
  });
  return [...merged.values()].map(entry => ({
    key: entry.name,
    label: entry.name,
    map: entry.name,
    games: entry.games,
    wins: entry.wins,
    losses: entry.losses,
    winrate: entry.wins + entry.losses ? Math.round(entry.wins / (entry.wins + entry.losses) * 100) : null,
    kd: entry.raw && entry.games ? entry.kills / Math.max(1, entry.deaths) : null,
    acs: entry.rounds ? Math.round(entry.score / entry.rounds) : null,
  })).sort((a, b) => b.games - a.games || (b.winrate ?? -1) - (a.winrate ?? -1) || a.label.localeCompare(b.label, 'fr'));
}

/** Agents de l'acte (les anciens enregistrements n'ont que le top 3). */
export const actAgentStats = records => mergeBreakdown(records, 'agentStats', 'topAgentStats');

/** Maps de l'acte, si la synchro les fournit. */
export const actMapStats = records => mergeBreakdown(records, 'mapStats');
