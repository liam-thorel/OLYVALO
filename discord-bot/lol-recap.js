/**
 * Récap LoL par file classée (SoloQ / Flex) ET par cadence (quotidien 7h,
 * hebdo tous les lundis à minuit, mensuel le 1er du mois à minuit) — 6 récaps
 * indépendants au total, chacun avec son propre scheduler, son propre
 * déclencheur manuel et sa propre commande Discord. Combine deux embeds : LP
 * gagnés/perdus (accumulateur remis à zéro à chaque récap DE CETTE CADENCE —
 * voir rank-tracking.js, qui maintient 3 fenêtres d'accumulation indépendantes
 * par queue) et winrate/KDA/CS moyens sur les games de cette file uniquement.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');
const { filterRecapChannels } = require('./recap-settings.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, aggregateKDA, averageCs } = require('./stats.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_HOUR = 7; // heure locale Europe/Paris

const QUEUES = {
  solo: { queueId: 420, rankBucket: 'lol-solo', title: 'SoloQ', emoji: '🔵', dailyMinute: 15 },
  flex: { queueId: 440, rankBucket: 'lol-flex', title: 'Flex', emoji: '🟣', dailyMinute: 20 },
};

const PERIOD_LABELS = { daily: 'quotidien', weekly: 'hebdo', monthly: 'mensuel' };

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

function triggerPath(queueKey, period) {
  const queueLabel = queueKey === 'solo' ? 'Solo' : 'Flex';
  const periodSuffix = period === 'daily' ? '' : period[0].toUpperCase() + period.slice(1);
  return `adminActions/lol${queueLabel}${periodSuffix}RecapTrigger`;
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
// que les games postérieures (récap planifié, fenêtre "depuis le dernier récap DE CETTE CADENCE").
async function buildQueueRecapEmbeds(queueKey, period, sinceTs = null) {
  const cfg = QUEUES[queueKey];
  const [gains, members] = await Promise.all([allRankGains(cfg.rankBucket, period), ensureRoster()]);

  const embeds = [];
  if (gains.length > 0) {
    const lines = [...gains].sort((a, b) => b.delta - a.delta)
      .map(g => `${cfg.emoji} **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} LP`);
    embeds.push(new EmbedBuilder()
      .setColor(0x0ac8b9)
      .setAuthor({ name: `📈 LP ${cfg.title} (${PERIOD_LABELS[period]})` })
      .setDescription(lines.join('\n'))
      .setTimestamp());
  }

  const rows = await Promise.all(members.map(async member => {
    const entries = (await historyFor('lol', member.riotIds)).filter(e => e.queueId === cfg.queueId);
    const recent = sinceTs ? entries.filter(e => (e.ts || 0) > sinceTs) : entries;
    const withResult = recent.filter(e => typeof e.win === 'boolean');
    const wins = withResult.filter(e => e.win).length;
    return {
      name: member.name,
      games: recent.length,
      winRatePct: withResult.length ? Math.round((wins / withResult.length) * 100) : null,
      kda: aggregateKDA(recent),
      cs: averageCs(recent),
    };
  }));

  const lines = rows
    .filter(row => row.games > 0)
    .sort((a, b) => b.games - a.games)
    .map(row => {
      const parts = [
        `${row.games} game(s)`,
        row.winRatePct != null ? `${row.winRatePct}% WR` : null,
        row.kda != null ? `${row.kda.toFixed(2)} KDA` : null,
        row.cs != null ? `${Math.round(row.cs)} cs` : null,
      ].filter(Boolean).join(' · ');
      return `**${row.name}** — ${parts}`;
    });
  if (lines.length > 0) {
    embeds.push(new EmbedBuilder()
      .setColor(0x0ac8b9)
      .setAuthor({ name: `📊 Stats ${cfg.title} (${PERIOD_LABELS[period]})` })
      .setDescription(lines.join('\n'))
      .setTimestamp());
  }

  return embeds;
}

async function runQueueRecap(client, queueKey, period, dateKey = null) {
  const cfg = QUEUES[queueKey];
  const path = statePath(queueKey, period);
  const state = await fbGet(path).catch(() => null) || {};
  const since = state.lastRecapTs || 0;
  const now = Date.now();

  const embeds = await buildQueueRecapEmbeds(queueKey, period, since);
  if (embeds.length > 0) {
    const channelIds = await filterRecapChannels(allTrackedChannelIds());
    await Promise.all(channelIds.map(async channelId => {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds });
      } catch (error) {
        console.error(`[lol-recap:${queueKey}:${period}:announce]`, error.message);
      }
    }));
  }

  await resetRankGains(cfg.rankBucket, period);
  const nextState = { ...state, lastRecapTs: now };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(path, nextState);
}

function startQueueRecapScheduler(client, queueKey, period) {
  const cfg = QUEUES[queueKey];
  const path = statePath(queueKey, period);
  const trigger = triggerPath(queueKey, period);

  const checkSchedule = async () => {
    const parts = parisParts();
    if (!isDue(period, cfg, parts)) return;
    const state = await fbGet(path).catch(() => null) || {};
    if (state.lastRecapDate === parts.dateKey) return;
    await runQueueRecap(client, queueKey, period, parts.dateKey);
  };

  checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:${period}:schedule]`, error.message));
  setInterval(() => checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:${period}:schedule]`, error.message)), CHECK_INTERVAL_MS);

  // Déclenchement manuel depuis le panel admin du site (bouton "tester") ou
  // via /recap-*. Le tout premier événement reçu à la connexion reflète juste
  // l'état déjà existant (pas un nouveau clic) — on l'ignore.
  let lastTriggerTs = null;
  let isFirstTriggerSnapshot = true;
  watchNode(trigger, data => {
    const ts = data?.ts || null;
    if (isFirstTriggerSnapshot) { isFirstTriggerSnapshot = false; lastTriggerTs = ts; return; }
    if (!ts || ts === lastTriggerTs) return;
    lastTriggerTs = ts;
    runQueueRecap(client, queueKey, period).catch(error => console.error(`[lol-recap:${queueKey}:${period}:manual]`, error.message));
  }, error => console.error(`[lol-recap:${queueKey}:${period}:trigger-watch]`, error.message));
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
