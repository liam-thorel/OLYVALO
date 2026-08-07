/**
 * Récap Valorant Compétitif du roster — quotidien (7h30), hebdo (tous les
 * lundis à minuit) et mensuel (le 1er du mois à minuit). Combine deux embeds
 * envoyés ensemble : RR gagnés/perdus (par personne et par compte) et
 * winrate/KDA/HS% moyens, uniquement sur les games en file Compétitif
 * (Swift Play/Deathmatch/etc. exclus).
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');
const { filterRecapChannels } = require('./recap-settings.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, aggregateKDA, averageHsPercent, rankedOnly } = require('./stats.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_HOUR = 7; // heure locale Europe/Paris
const DAILY_MINUTE = 30;

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

function statePath(period) {
  return period === 'daily' ? 'betting/valoDaily' : `betting/valo${period[0].toUpperCase()}${period.slice(1)}`;
}

function triggerPath(period) {
  const periodSuffix = period === 'daily' ? '' : period[0].toUpperCase() + period.slice(1);
  return `adminActions/valo${periodSuffix}RecapTrigger`;
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
// que les games postérieures (récap planifié, fenêtre "depuis le dernier récap DE CETTE CADENCE").
async function buildValoRecapEmbeds(period, sinceTs = null) {
  const [gains, members] = await Promise.all([allRankGains('valorant', period), ensureRoster()]);

  const embeds = [];
  if (gains.length > 0) {
    const lines = [...gains].sort((a, b) => b.delta - a.delta)
      .map(g => `🔴 **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} RR`);
    embeds.push(new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: `📈 RR Valorant (${PERIOD_LABELS[period]})` })
      .setDescription(lines.join('\n'))
      .setTimestamp());
  }

  const rows = await Promise.all(members.map(async member => {
    const entries = rankedOnly('valorant', await historyFor('valorant', member.riotIds));
    const recent = sinceTs ? entries.filter(e => (e.ts || 0) > sinceTs) : entries;
    const withResult = recent.filter(e => typeof e.win === 'boolean');
    const wins = withResult.filter(e => e.win).length;
    return {
      name: member.name,
      games: recent.length,
      winRatePct: withResult.length ? Math.round((wins / withResult.length) * 100) : null,
      kda: aggregateKDA(recent),
      hs: averageHsPercent(recent),
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
        row.hs != null ? `${Math.round(row.hs)}% HS` : null,
      ].filter(Boolean).join(' · ');
      return `**${row.name}** — ${parts}`;
    });
  if (lines.length > 0) {
    embeds.push(new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: `📊 Stats Valorant Compétitif (${PERIOD_LABELS[period]})` })
      .setDescription(lines.join('\n'))
      .setTimestamp());
  }

  return embeds;
}

async function runValoRecap(client, period, dateKey = null) {
  const path = statePath(period);
  const state = await fbGet(path).catch(() => null) || {};
  const since = state.lastRecapTs || 0;
  const now = Date.now();

  const embeds = await buildValoRecapEmbeds(period, since);
  if (embeds.length > 0) {
    const channelIds = await filterRecapChannels(allTrackedChannelIds());
    await Promise.all(channelIds.map(async channelId => {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds });
      } catch (error) {
        console.error(`[valo-recap:${period}:announce]`, error.message);
      }
    }));
  }

  await resetRankGains('valorant', period);
  const nextState = { ...state, lastRecapTs: now };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(path, nextState);
}

function startRecapScheduler(client, period) {
  const path = statePath(period);
  const trigger = triggerPath(period);

  const checkSchedule = async () => {
    const parts = parisParts();
    if (!isDue(period, parts)) return;
    const state = await fbGet(path).catch(() => null) || {};
    if (state.lastRecapDate === parts.dateKey) return;
    await runValoRecap(client, period, parts.dateKey);
  };

  checkSchedule().catch(error => console.error(`[valo-recap:${period}:schedule]`, error.message));
  setInterval(() => checkSchedule().catch(error => console.error(`[valo-recap:${period}:schedule]`, error.message)), CHECK_INTERVAL_MS);

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
    runValoRecap(client, period).catch(error => console.error(`[valo-recap:${period}:manual]`, error.message));
  }, error => console.error(`[valo-recap:${period}:trigger-watch]`, error.message));
}

function startValoDailyRecapScheduler(client) { startRecapScheduler(client, 'daily'); }
function startValoWeeklyRecapScheduler(client) { startRecapScheduler(client, 'weekly'); }
function startValoMonthlyRecapScheduler(client) { startRecapScheduler(client, 'monthly'); }

module.exports = { startValoDailyRecapScheduler, startValoWeeklyRecapScheduler, startValoMonthlyRecapScheduler, buildValoRecapEmbeds };
