/**
 * Récap quotidien Valorant du roster (winrate, KDA moyen, % headshots),
 * envoyé chaque jour à 7h30 heure de Paris dans tous les salons trackés —
 * 30 minutes après le récap des gains de paris (daily-recap.js).
 *
 * Contrairement aux récaps points/LP-RR (accumulateurs remis à zéro), ici on
 * filtre directement l'historique connu par horodatage : chaque game dans
 * live/history porte déjà un `ts`, pas besoin d'accumuler au fil de l'eau.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');
const { filterRecapChannels } = require('./recap-settings.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, averageKDA, averageHsPercent } = require('./stats.js');

const RECAP_HOUR = 7; // heure locale Europe/Paris
const RECAP_MINUTE = 30;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STATE_PATH = 'betting/valoDaily';
const TRIGGER_PATH = 'adminActions/valoRecapTrigger';

function parisParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute), dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

// dateKey n'est fourni que par le planificateur automatique — un test manuel
// depuis le panel admin recalcule bien la fenêtre "depuis la dernière fois"
// mais ne doit pas marquer la journée comme déjà traitée, sinon le vrai récap
// du lendemain matin serait sauté.
async function runValoDailyRecap(client, dateKey = null) {
  const state = await fbGet(STATE_PATH).catch(() => null) || {};
  const since = state.lastRecapTs || 0;
  const now = Date.now();

  const members = await ensureRoster();
  const rows = await Promise.all(members.map(async member => {
    const entries = await historyFor('valorant', member.riotIds);
    const recent = since ? entries.filter(e => (e.ts || 0) > since) : entries;
    const withResult = recent.filter(e => typeof e.win === 'boolean');
    const wins = withResult.filter(e => e.win).length;
    return {
      name: member.name,
      games: recent.length,
      winRatePct: withResult.length ? Math.round((wins / withResult.length) * 100) : null,
      kda: averageKDA(recent),
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
    const channelIds = await filterRecapChannels(allTrackedChannelIds());
    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: '🔴 Récap quotidien (Valorant)' })
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Games jouées depuis hier 7h30' })
      .setTimestamp();

    await Promise.all(channelIds.map(async channelId => {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [embed] });
      } catch (error) {
        console.error('[valo-daily-recap:announce]', error.message);
      }
    }));
  }

  const nextState = { ...state, lastRecapTs: now };
  if (dateKey) nextState.lastRecapDate = dateKey;
  await fbPut(STATE_PATH, nextState);
}

function startValoDailyRecapScheduler(client) {
  const checkSchedule = async () => {
    const { hour, minute, dateKey } = parisParts();
    const state = await fbGet(STATE_PATH).catch(() => null) || {};
    if (hour !== RECAP_HOUR || minute < RECAP_MINUTE || state.lastRecapDate === dateKey) return;
    await runValoDailyRecap(client, dateKey);
  };

  checkSchedule().catch(error => console.error('[valo-daily-recap:schedule]', error.message));
  setInterval(() => checkSchedule().catch(error => console.error('[valo-daily-recap:schedule]', error.message)), CHECK_INTERVAL_MS);

  // Déclenchement manuel depuis le panel admin du site (bouton "tester"). Le
  // tout premier événement reçu à la connexion reflète l'état déjà existant
  // (pas un nouveau clic) — on l'ignore pour ne pas redéclencher au démarrage.
  let lastTriggerTs = null;
  let isFirstTriggerSnapshot = true;
  watchNode(TRIGGER_PATH, data => {
    const ts = data?.ts || null;
    if (isFirstTriggerSnapshot) { isFirstTriggerSnapshot = false; lastTriggerTs = ts; return; }
    if (!ts || ts === lastTriggerTs) return;
    lastTriggerTs = ts;
    runValoDailyRecap(client).catch(error => console.error('[valo-daily-recap:manual]', error.message));
  }, error => console.error('[valo-daily-recap:trigger-watch]', error.message));
}

module.exports = { startValoDailyRecapScheduler };
