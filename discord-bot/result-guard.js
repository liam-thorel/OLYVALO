/**
 * Un résultat de fin de partie supprimé revient.
 *
 * Certains suppriment la carte d'une partie ratée. Le bot s'en aperçoit et la
 * reposte telle quelle, avec « Bien essayé @… » — puis (x2), (x3)… à
 * chaque nouvelle suppression du même résultat.
 *
 * Qui a supprimé ? Discord ne le dit pas dans l'évènement de suppression. Le
 * seul témoin est le JOURNAL D'AUDIT du serveur (permission « Voir les logs
 * du serveur » pour le bot) : il note qui a supprimé un message d'autrui. Il
 * regroupe les suppressions rapprochées d'un même auteur dans une seule
 * entrée dont le compteur augmente — d'où la mémoire des compteurs déjà vus.
 * Sans accès au journal, le résultat revient quand même, sans nommer
 * personne : mieux vaut ne pas accuser au hasard.
 *
 * Mémoire : les résultats des dernières 48 h, bornée. Un redémarrage du bot
 * l'efface — les résultats d'avant ne sont alors plus surveillés.
 */

const { createBoundedMap } = require('./bounded-memory.js');

const TRACK_TTL_MS = 48 * 60 * 60 * 1000;
// Le journal d'audit est écrit juste après la suppression : on lui laisse un
// instant avant de le lire.
const AUDIT_DELAY_MS = 1500;
// Une entrée vue pour la première fois compte comme cette suppression si elle
// est toute récente.
const AUDIT_FRESH_MS = 30_000;
// Discord.js : AuditLogEvent.MessageDelete.
const AUDIT_MESSAGE_DELETE = 72;

function tauntLine(deleterId, count) {
  const who = deleterId ? `<@${deleterId}>` : '';
  const times = count > 1 ? ` (x${count})` : '';
  return `😏 Bien essayé${who ? ` ${who}` : ''}${times} — ce résultat ne disparaît pas si facilement.`;
}

/** Contenu du message reposté : la pique, puis le contenu d'origine. */
function repostContent(baseContent, deleterId, count) {
  return [tauntLine(deleterId, count), baseContent].filter(Boolean).join('\n');
}

/**
 * Auteur de la suppression, d'après les entrées du journal (les plus récentes
 * d'abord). `seen` garde le compteur de chaque entrée déjà observée : une
 * entrée regroupée dont le compteur a augmenté, c'est cette suppression.
 */
function deleterFromAuditLog(entries, { botId, channelId, now = Date.now(), seen = new Map() }) {
  const relevant = (entries || []).filter(entry =>
    String(entry?.targetId || '') === String(botId) && String(entry?.channelId || '') === String(channelId));
  let deleter = null;
  for (const entry of relevant) {
    const previous = seen.get(entry.id);
    const count = Number(entry.count) || 1;
    const fresh = now - Number(entry.createdTimestamp || 0) < AUDIT_FRESH_MS;
    const matches = previous == null ? fresh : count > previous;
    if (!deleter && matches) deleter = String(entry.executorId || '') || null;
  }
  relevant.forEach(entry => seen.set(entry.id, Number(entry.count) || 1));
  return deleter;
}

/** Entrées du journal ramenées à ce dont on a besoin (discord.js → données). */
function auditEntries(logs) {
  const list = logs?.entries ? [...logs.entries.values()] : [];
  return list.map(entry => ({
    id: entry.id,
    executorId: entry.executorId || entry.executor?.id || '',
    targetId: entry.targetId || entry.target?.id || '',
    channelId: entry.extra?.channel?.id || entry.extra?.channelId || '',
    count: Number(entry.extra?.count) || 1,
    createdTimestamp: Number(entry.createdTimestamp) || 0,
  }));
}

function createResultGuard({
  client,
  log = console.log,
  allowList = [],
  now = () => Date.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  limit = 300,
} = {}) {
  const tracked = createBoundedMap(limit); // messageId -> { channelId, guildId, payload, baseContent, count, at }
  const seenAudit = new Map();             // entrée du journal -> compteur déjà vu
  const primedGuilds = new Set();
  const allowed = new Set(allowList.map(String).filter(Boolean));

  async function readAudit(guild) {
    if (!guild?.fetchAuditLogs) return null;
    try {
      return auditEntries(await guild.fetchAuditLogs({ type: AUDIT_MESSAGE_DELETE, limit: 25 }));
    } catch (error) {
      // Permission absente le plus souvent : on le dit une fois par serveur.
      if (!primedGuilds.has(`denied:${guild.id}`)) {
        primedGuilds.add(`denied:${guild.id}`);
        log(`[résultats] journal d'audit illisible (${error.message}) — les résultats supprimés reviendront sans nommer personne`);
      }
      return null;
    }
  }

  // Avant toute suppression à surveiller, on relève les compteurs existants :
  // sans ce relevé, une entrée regroupée déjà ancienne ne se distinguerait
  // pas d'une nouvelle suppression.
  async function prime(guild) {
    if (!guild || primedGuilds.has(guild.id)) return;
    primedGuilds.add(guild.id);
    const entries = await readAudit(guild);
    (entries || []).forEach(entry => seenAudit.set(entry.id, entry.count));
  }

  /** À appeler après chaque envoi de résultat. */
  function remember(message, payload, { baseContent = payload?.content || '', count = 0 } = {}) {
    if (!message?.id) return;
    tracked.set(message.id, {
      channelId: message.channelId || message.channel?.id || '',
      guildId: message.guildId || message.guild?.id || '',
      payload,
      baseContent,
      count,
      at: now(),
    });
    prime(message.guild).catch(() => {});
  }

  /** Branché sur l'évènement `messageDelete` du client. */
  async function handleDelete(message) {
    const entry = message?.id ? tracked.get(message.id) : null;
    if (!entry) return null;
    tracked.delete(message.id);
    if (now() - entry.at > TRACK_TTL_MS) return null;

    await wait(AUDIT_DELAY_MS);
    const guild = message.guild || (entry.guildId ? await client.guilds?.fetch?.(entry.guildId).catch(() => null) : null);
    const entries = await readAudit(guild);
    const deleterId = entries ? deleterFromAuditLog(entries, {
      botId: client.user?.id, channelId: entry.channelId, now: now(), seen: seenAudit,
    }) : null;

    if (deleterId && allowed.has(deleterId)) {
      log(`[résultats] suppression par ${deleterId}, autorisé : pas de repost`);
      return null;
    }

    const count = entry.count + 1;
    const channel = message.channel || await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel?.send) return null;
    const sent = await channel.send({
      ...entry.payload,
      content: repostContent(entry.baseContent, deleterId, count),
      // Seul l'auteur de la suppression est mentionné : la carte d'origine ne
      // doit pas notifier toute la partie à chaque repost.
      allowedMentions: { users: deleterId ? [deleterId] : [] },
    });
    log(`[résultats] résultat supprimé${deleterId ? ` par ${deleterId}` : ''} — reposté (x${count})`);
    remember(sent, entry.payload, { baseContent: entry.baseContent, count });
    return { deleterId, count, messageId: sent?.id || null };
  }

  return { remember, handleDelete, tracked };
}

module.exports = {
  createResultGuard, deleterFromAuditLog, auditEntries, repostContent, tauntLine,
  AUDIT_MESSAGE_DELETE, AUDIT_FRESH_MS, TRACK_TTL_MS,
};
