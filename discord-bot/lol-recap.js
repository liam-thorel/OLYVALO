/**
 * Récap LoL par file classée (SoloQ / Flex) ET par cadence (quotidien 7h,
 * hebdo tous les lundis à minuit, mensuel le 1er du mois à minuit). Posté
 * automatiquement dans le salon défini via /recap-channel (s'il y en a un) ;
 * chaque /recap-lol-solo(-weekly|-monthly) ou /recap-lol-flex(-weekly|-monthly)
 * permet aussi de l'afficher à la demande, dans le salon où la commande est
 * invoquée (voir buildQueueRecapEmbeds). Dans les deux cas, le passage du
 * récap remet à zéro l'accumulateur LP de rank-tracking.js pour cette
 * cadence.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut } = require('./firebase.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, aggregateKDA, averageCs, winrateLabel } = require('./stats.js');
const { formatLolRank, mostPlayedPosition, formatPosition } = require('./lol-rank.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');
const { getRecapChannelId } = require('./recap-channel.js');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_HOUR = 7; // heure locale Europe/Paris

const QUEUES = {
  solo: { queueId: 420, rankBucket: 'lol-solo', title: 'SoloQ', emoji: '🔵', dailyMinute: 15 },
  flex: { queueId: 440, rankBucket: 'lol-flex', title: 'Flex', emoji: '🟣', dailyMinute: 20 },
};

const PERIOD_LABELS = { daily: 'quotidien', weekly: 'hebdo', monthly: 'mensuel' };
const PERIOD_WHEN = { daily: 'aujourd’hui', weekly: 'cette semaine', monthly: 'ce mois-ci' };
const MEDALS = ['🥇', '🥈', '🥉'];
const COLOR_UP = 0x3fcf6b;
const COLOR_DOWN = 0xff5f6d;
const COLOR_NEUTRAL = 0x8b94a3;

const sign = value => `${value >= 0 ? '+' : ''}${value}`;

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

// Le rang atteint le plus récemment sur la période, lu sur le rapport de fin
// de game (rankAfter) plutôt que recalculé depuis le delta de LP.
function latestRank(entries = []) {
  const withRank = [...entries]
    .filter(entry => entry.rankAfter?.tier)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return withRank.length ? formatLolRank(withRank[0].rankAfter) : null;
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

function statePath(queueKey, period) {
  return `rankTracking/schedule/${queueKey}-${period}`;
}

// Quotidien : fenêtre horaire fixe (7h+dailyMinute). Hebdo : tous les lundis
// à partir de minuit. Mensuel : le 1er du mois à partir de minuit. Le garde-
// fou `lastRecapDate` (une seule fois par date déclenchante) suffit dans les
// 3 cas puisque chacune de ces dates ne revient qu'une fois par cycle.
function isDue(period, cfg, parts) {
  if (period === 'daily') return parts.hour === DAILY_HOUR && parts.minute >= cfg.dailyMinute;
  if (period === 'weekly') return parts.weekday === 1 && parts.hour === 0 && parts.minute < 10;
  return parts.day === 1 && parts.hour === 0 && parts.minute < 10; // monthly
}

// sinceTs=null → tout l'historique connu (commande manuelle) ; sinon ne garde
// que les games postérieures (fenêtre "depuis le dernier reset DE CETTE CADENCE").
async function buildQueueRecapEmbeds(queueKey, period, sinceTs = null) {
  const cfg = QUEUES[queueKey];
  const [gains, members] = await Promise.all([allRankGains(cfg.rankBucket, period), ensureRoster()]);

  // Même refonte que le récap Valorant : le LP et les stats sortaient dans deux
  // messages distincts pour les mêmes joueurs. On les réunit par membre, car un
  // joueur peut n'avoir que l'un des deux signaux.
  const deltaByMember = new Map();
  gains.forEach(gain => {
    deltaByMember.set(gain.memberName, (deltaByMember.get(gain.memberName) || 0) + gain.delta);
  });

  const rows = await Promise.all(members.map(async member => {
    const entries = (await historyFor('lol', member.riotIds)).filter(entry => entry.queueId === cfg.queueId);
    const recent = sinceTs ? entries.filter(entry => (entry.ts || 0) > sinceTs) : entries;
    const withResult = recent.filter(entry => typeof entry.win === 'boolean');
    const wins = withResult.filter(entry => entry.win).length;
    return {
      name: member.name,
      delta: deltaByMember.get(member.name) ?? null,
      games: recent.length,
      kda: aggregateKDA(recent),
      cs: averageCs(recent),
      rank: latestRank(recent),
      position: formatPosition(mostPlayedPosition(recent)),
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
      row.delta != null ? `\`${sign(row.delta)} LP\`` : null,
      row.rank,
    ].filter(Boolean).join(' · ');

    const detail = [
      row.strip || null,
      winrateLabel(row.wins, row.entriesWithResult),
      row.kda != null ? `${row.kda.toFixed(2)} KDA` : null,
      row.cs != null ? `${Math.round(row.cs)} CS` : null,
      row.position,
    ].filter(Boolean).join(' · ');

    return detail ? `${head}\n${detail}` : head;
  });

  return [new EmbedBuilder()
    .setColor(colorFor(totalDelta))
    .setAuthor({ name: `${cfg.emoji} Récap ${cfg.title} · ${sign(totalDelta)} LP ${PERIOD_WHEN[period] || PERIOD_LABELS[period]}` })
    .setDescription([collective ? `\`${collective}\`` : null, blocks.join('\n\n')].filter(Boolean).join('\n\n'))
    .setTimestamp()];
}

async function runQueueRecap(client, queueKey, period, dateKey = null) {
  const cfg = QUEUES[queueKey];
  const path = statePath(queueKey, period);
  const state = await fbGet(path).catch(() => null) || {};
  const since = state.lastRecapTs || 0;

  const channelId = await getRecapChannelId();
  if (channelId) {
    const embeds = await buildQueueRecapEmbeds(queueKey, period, since);
    if (embeds.length > 0) {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds });
      } catch (error) {
        console.error(`[lol-recap:${queueKey}:${period}:announce]`, error.message);
      }
    }
  }

  await resetRankGains(cfg.rankBucket, period);
  const nextState = { ...state, lastRecapTs: Date.now() };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(path, nextState);
}

function startQueueRecapScheduler(client, queueKey, period) {
  const cfg = QUEUES[queueKey];
  const path = statePath(queueKey, period);

  const checkSchedule = async () => {
    const parts = parisParts();
    if (!isDue(period, cfg, parts)) return;
    const state = await fbGet(path).catch(() => null) || {};
    if (state.lastRecapDate === parts.dateKey) return;
    await runQueueRecap(client, queueKey, period, parts.dateKey);
  };

  checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:${period}:schedule]`, error.message));
  setInterval(() => checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:${period}:schedule]`, error.message)), CHECK_INTERVAL_MS);
}

function startLolSoloRecapScheduler(client) { startQueueRecapScheduler(client, 'solo', 'daily'); }
function startLolFlexRecapScheduler(client) { startQueueRecapScheduler(client, 'flex', 'daily'); }
function startLolSoloWeeklyRecapScheduler(client) { startQueueRecapScheduler(client, 'solo', 'weekly'); }
function startLolFlexWeeklyRecapScheduler(client) { startQueueRecapScheduler(client, 'flex', 'weekly'); }
function startLolSoloMonthlyRecapScheduler(client) { startQueueRecapScheduler(client, 'solo', 'monthly'); }
function startLolFlexMonthlyRecapScheduler(client) { startQueueRecapScheduler(client, 'flex', 'monthly'); }

module.exports = {
  startLolSoloRecapScheduler, startLolFlexRecapScheduler,
  startLolSoloWeeklyRecapScheduler, startLolFlexWeeklyRecapScheduler,
  startLolSoloMonthlyRecapScheduler, startLolFlexMonthlyRecapScheduler,
  buildQueueRecapEmbeds,
};
