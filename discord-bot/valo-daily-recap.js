/**
 * Récap Valorant Compétitif du roster — quotidien (7h30), hebdo (tous les
 * lundis à minuit) et mensuel (le 1er du mois à minuit). Posté
 * automatiquement dans le salon défini via /recap-channel (s'il y en a un) ;
 * /recap-valo(-weekly|-monthly) permet aussi de l'afficher à la demande,
 * dans le salon où la commande est invoquée (voir buildValoRecapEmbeds).
 * Dans les deux cas, le passage du récap remet à zéro l'accumulateur RR de
 * rank-tracking.js pour cette cadence.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut } = require('./firebase.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, aggregateKDA, averageHsPercent, averageAcs, rankedOnly, winrateLabel } = require('./stats.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');
const { getRecapChannelId } = require('./recap-channel.js');
const { ensureAgentRoles, mostPlayedRole, formatRole } = require('./agent-roles.js');
const { formatValorantRank } = require('./valorant-rank.js');

const DAILY_HOUR = 7; // heure locale Europe/Paris
const DAILY_MINUTE = 30;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const PERIOD_LABELS = { daily: 'quotidien', weekly: 'hebdo', monthly: 'mensuel' };
const PERIOD_WHEN = { daily: 'aujourd’hui', weekly: 'cette semaine', monthly: 'ce mois-ci' };
const MEDALS = ['🥇', '🥈', '🥉'];
const COLOR_UP = 0x3fcf6b;
const COLOR_DOWN = 0xff5f6d;
const COLOR_NEUTRAL = 0x8b94a3;

const sign = value => `${value >= 0 ? '+' : ''}${value}`;

// Frise des résultats, dans l'ordre chronologique — le déroulé de la journée
// se lit d'un coup d'œil, ce qu'un simple pourcentage ne montre pas.
function resultStrip(entries = []) {
  return [...entries]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map(entry => (entry.win === true ? '🟩' : entry.win === false ? '🟥' : '⬜'))
    .join('');
}

function colorFor(delta) {
  if (delta > 0) return COLOR_UP;
  if (delta < 0) return COLOR_DOWN;
  return COLOR_NEUTRAL;
}

// Le rang le plus récent connu sur la période. Seules les games dont le joueur
// est lui-même le rapporteur portent tier/rr (voir stats.js), d'où le filtre.
function latestRank(entries = []) {
  const withRank = entries.filter(entry => entry.tier != null).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return withRank.length ? formatValorantRank(withRank[0].tier, withRank[0].rr) : null;
}

function parisParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  // 0=dimanche, 1=lundi... calculé sur la date locale Paris plutôt que via un
  // libellé de jour localisé (fragile selon la locale/plateforme).
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { hour: Number(parts.hour), minute: Number(parts.minute), day, weekday, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

function statePath(period) {
  return period === 'daily' ? 'betting/valoDaily' : `betting/valo${period[0].toUpperCase()}${period.slice(1)}`;
}

// Quotidien : fenêtre horaire fixe (7h30). Hebdo : tous les lundis à partir
// de minuit. Mensuel : le 1er du mois à partir de minuit. Le garde-fou
// `lastRecapDate` (une seule fois par date déclenchante) suffit dans les 3
// cas puisque chacune de ces dates ne revient qu'une fois par cycle.
function isDue(period, parts) {
  if (period === 'daily') return parts.hour === DAILY_HOUR && parts.minute >= DAILY_MINUTE;
  if (period === 'weekly') return parts.weekday === 1 && parts.hour === 0 && parts.minute < 10;
  return parts.day === 1 && parts.hour === 0 && parts.minute < 10; // monthly
}

// sinceTs=null → tout l'historique connu (commande manuelle) ; sinon ne garde
// que les games postérieures (fenêtre "depuis le dernier reset DE CETTE CADENCE").
async function buildValoRecapEmbeds(period, sinceTs = null) {
  const [gains, members, roleTable] = await Promise.all([
    allRankGains('valorant', period),
    ensureRoster(),
    ensureAgentRoles(),
  ]);

  // Le RR (rank-tracking, accumulé à chaque fin de game) et les stats
  // (historique des games) étaient présentés dans deux messages distincts pour
  // les mêmes joueurs et la même période. On les réunit par membre : un joueur
  // peut n'avoir que l'un des deux (RR sans stats si le rapport de fin de game
  // a manqué, stats sans RR si aucune game classée n'a bougé le rang).
  const deltaByMember = new Map();
  gains.forEach(gain => {
    deltaByMember.set(gain.memberName, (deltaByMember.get(gain.memberName) || 0) + gain.delta);
  });

  const rows = await Promise.all(members.map(async member => {
    const entries = rankedOnly('valorant', await historyFor('valorant', member.riotIds));
    const recent = sinceTs ? entries.filter(entry => (entry.ts || 0) > sinceTs) : entries;
    const withResult = recent.filter(entry => typeof entry.win === 'boolean');
    const wins = withResult.filter(entry => entry.win).length;
    return {
      name: member.name,
      delta: deltaByMember.get(member.name) ?? null,
      games: recent.length,
      winRatePct: withResult.length ? Math.round((wins / withResult.length) * 100) : null,
      kda: aggregateKDA(recent),
      acs: averageAcs(recent),
      hs: averageHsPercent(recent),
      rank: latestRank(recent),
      role: formatRole(mostPlayedRole(recent, roleTable)),
      strip: resultStrip(withResult),
      entriesWithResult: withResult.length,
      wins,
    };
  }));

  const active = rows
    .filter(row => row.games > 0 || row.delta != null)
    .sort((left, right) => (right.delta ?? 0) - (left.delta ?? 0));

  if (active.length === 0) return [];

  const totalDelta = active.reduce((sum, row) => sum + (row.delta ?? 0), 0);
  const totalGames = active.reduce((sum, row) => sum + row.games, 0);
  const totalDecided = active.reduce((sum, row) => sum + row.entriesWithResult, 0);
  const totalWins = active.reduce((sum, row) => sum + row.wins, 0);

  const collective = [
    totalGames ? `${totalGames} game${totalGames > 1 ? 's' : ''}` : null,
    totalDecided ? `${Math.round((totalWins / totalDecided) * 100)}% WR collectif` : null,
  ].filter(Boolean).join(' · ');

  const blocks = active.map((row, index) => {
    const head = [
      `${MEDALS[index] || '▫️'} **${row.name}**`,
      row.delta != null ? `\`${sign(row.delta)} RR\`` : null,
      row.rank,
    ].filter(Boolean).join(' · ');

    const detail = [
      row.strip || null,
      winrateLabel(row.wins, row.entriesWithResult),
      row.kda != null ? `${row.kda.toFixed(2)} KDA` : null,
      row.acs != null ? `${Math.round(row.acs)} ACS` : null,
      row.hs != null ? `${Math.round(row.hs)}% HS` : null,
      row.role,
    ].filter(Boolean).join(' · ');

    return detail ? `${head}\n${detail}` : head;
  });

  return [new EmbedBuilder()
    .setColor(colorFor(totalDelta))
    .setAuthor({ name: `Récap OLYCITY · ${sign(totalDelta)} RR ${PERIOD_WHEN[period] || PERIOD_LABELS[period]}` })
    .setDescription([collective ? `\`${collective}\`` : null, blocks.join('\n\n')].filter(Boolean).join('\n\n'))
    .setTimestamp()];
}

async function runValoRecap(client, period, dateKey = null) {
  const path = statePath(period);
  const state = await fbGet(path).catch(() => null) || {};
  const since = state.lastRecapTs || 0;

  const channelId = await getRecapChannelId();
  if (channelId) {
    const embeds = await buildValoRecapEmbeds(period, since);
    if (embeds.length > 0) {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds });
      } catch (error) {
        console.error(`[valo-recap:${period}:announce]`, error.message);
      }
    }
  }

  await resetRankGains('valorant', period);
  const nextState = { ...state, lastRecapTs: Date.now() };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(path, nextState);
}

function startRecapScheduler(client, period) {
  const path = statePath(period);

  const checkSchedule = async () => {
    const parts = parisParts();
    if (!isDue(period, parts)) return;
    const state = await fbGet(path).catch(() => null) || {};
    if (state.lastRecapDate === parts.dateKey) return;
    await runValoRecap(client, period, parts.dateKey);
  };

  checkSchedule().catch(error => console.error(`[valo-recap:${period}:schedule]`, error.message));
  setInterval(() => checkSchedule().catch(error => console.error(`[valo-recap:${period}:schedule]`, error.message)), CHECK_INTERVAL_MS);
}

function startValoDailyRecapScheduler(client) { startRecapScheduler(client, 'daily'); }
function startValoWeeklyRecapScheduler(client) { startRecapScheduler(client, 'weekly'); }
function startValoMonthlyRecapScheduler(client) { startRecapScheduler(client, 'monthly'); }

module.exports = { startValoDailyRecapScheduler, startValoWeeklyRecapScheduler, startValoMonthlyRecapScheduler, buildValoRecapEmbeds };
