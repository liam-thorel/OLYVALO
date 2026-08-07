/**
 * Récap quotidien LoL par file classée — SoloQ et Flex ont chacune leur
 * propre récap et leur propre commande (leur progression n'a rien à voir).
 * Chaque récap combine deux embeds envoyés ensemble : LP gagnés/perdus (par
 * personne et par compte) et winrate/KDA/CS moyens sur les games de cette
 * file uniquement, depuis le dernier récap.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');
const { filterRecapChannels } = require('./recap-settings.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, averageKDA, averageCs } = require('./stats.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');

const RECAP_HOUR = 7; // heure locale Europe/Paris
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const QUEUES = {
  solo: {
    queueId: 420, rankBucket: 'lol-solo', title: 'SoloQ', emoji: '🔵',
    recapMinute: 15, statePath: 'rankTracking/soloSchedulerState', triggerPath: 'adminActions/lolSoloRecapTrigger',
  },
  flex: {
    queueId: 440, rankBucket: 'lol-flex', title: 'Flex', emoji: '🟣',
    recapMinute: 20, statePath: 'rankTracking/flexSchedulerState', triggerPath: 'adminActions/lolFlexRecapTrigger',
  },
};

function parisParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute), dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

// sinceTs=null → tout l'historique connu (commande manuelle) ; sinon ne garde
// que les games postérieures (récap planifié, fenêtre "depuis le dernier récap").
async function buildQueueRecapEmbeds(queueKey, sinceTs = null) {
  const cfg = QUEUES[queueKey];
  const [gains, members] = await Promise.all([allRankGains(cfg.rankBucket), ensureRoster()]);

  const embeds = [];
  if (gains.length > 0) {
    const lines = [...gains].sort((a, b) => b.delta - a.delta)
      .map(g => `${cfg.emoji} **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} LP`);
    embeds.push(new EmbedBuilder()
      .setColor(0x0ac8b9)
      .setAuthor({ name: `📈 LP ${cfg.title}` })
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
      kda: averageKDA(recent),
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
      .setAuthor({ name: `📊 Stats ${cfg.title}` })
      .setDescription(lines.join('\n'))
      .setTimestamp());
  }

  return embeds;
}

async function runQueueRecap(client, queueKey, dateKey = null) {
  const cfg = QUEUES[queueKey];
  const state = await fbGet(cfg.statePath).catch(() => null) || {};
  const since = state.lastRecapTs || 0;
  const now = Date.now();

  const embeds = await buildQueueRecapEmbeds(queueKey, since);
  if (embeds.length > 0) {
    const channelIds = await filterRecapChannels(allTrackedChannelIds());
    await Promise.all(channelIds.map(async channelId => {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds });
      } catch (error) {
        console.error(`[lol-recap:${queueKey}:announce]`, error.message);
      }
    }));
  }

  await resetRankGains(cfg.rankBucket);
  const nextState = { ...state, lastRecapTs: now };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(cfg.statePath, nextState);
}

function startQueueRecapScheduler(client, queueKey) {
  const cfg = QUEUES[queueKey];
  const checkSchedule = async () => {
    const { hour, minute, dateKey } = parisParts();
    const state = await fbGet(cfg.statePath).catch(() => null) || {};
    if (hour !== RECAP_HOUR || minute < cfg.recapMinute || state.lastRecapDate === dateKey) return;
    await runQueueRecap(client, queueKey, dateKey);
  };

  checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:schedule]`, error.message));
  setInterval(() => checkSchedule().catch(error => console.error(`[lol-recap:${queueKey}:schedule]`, error.message)), CHECK_INTERVAL_MS);

  // Déclenchement manuel depuis le panel admin du site (bouton "tester"). Le
  // tout premier événement reçu à la connexion reflète l'état déjà existant
  // (pas un nouveau clic) — on l'ignore pour ne pas redéclencher au démarrage.
  let lastTriggerTs = null;
  let isFirstTriggerSnapshot = true;
  watchNode(cfg.triggerPath, data => {
    const ts = data?.ts || null;
    if (isFirstTriggerSnapshot) { isFirstTriggerSnapshot = false; lastTriggerTs = ts; return; }
    if (!ts || ts === lastTriggerTs) return;
    lastTriggerTs = ts;
    runQueueRecap(client, queueKey).catch(error => console.error(`[lol-recap:${queueKey}:manual]`, error.message));
  }, error => console.error(`[lol-recap:${queueKey}:trigger-watch]`, error.message));
}

function startLolSoloRecapScheduler(client) { startQueueRecapScheduler(client, 'solo'); }
function startLolFlexRecapScheduler(client) { startQueueRecapScheduler(client, 'flex'); }

module.exports = { startLolSoloRecapScheduler, startLolFlexRecapScheduler, buildQueueRecapEmbeds };
