/**
 * Livechat : ce qui est posté dans le salon #livechat (ou via /livechat)
 * s'affiche par-dessus l'écran des membres qui ont OLYCITY Live.
 *
 * Le bot écrit dans livechat/queue ; chaque Live écoute ce nœud, télécharge
 * le média et l'affiche (live/livechat.js). Le site olycity.fr/livechat passe
 * par le Worker workers/livechat, qui poste dans le même salon via un webhook
 * et écrit lui-même dans la file : le bot ignore donc les messages de webhook.
 */
const { fbGet, fbPost, fbDelete, fbPut } = require('./firebase.js');
const { normalizeVideoLink, parseTimecode } = require('./video-links.js');

const LIVECHAT_CHANNEL_PATH = 'discordConfig/livechatChannelId';
const LIVECHAT_QUEUE_PATH = 'livechat/queue';
const LIVECHAT_RECEIVERS_PATH = 'livechat/receivers';
const LIVECHAT_CONTROL_PATH = 'livechat/control';
// Extrait d'un lien : 30 s depuis le début choisi quand la fin n'est pas dite.
const DEFAULT_CLIP_MS = 30 * 1000;
const MAX_CLIP_MS = 10 * 60 * 1000;
// Un élément n'est plus affiché après 90 s (live/livechat-utils.js) : la file
// ne garde que de quoi rattraper une reconnexion.
const QUEUE_TTL_MS = 10 * 60 * 1000;
// Le Live signale sa présence toutes les 2 minutes.
const RECEIVER_FRESH_MS = 5 * 60 * 1000;
const MAX_TEXT_LENGTH = 220;

// Même liste que live/livechat-utils.js : le Live refuse tout autre hôte.
const MEDIA_HOSTS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'media.tenor.com',
  'c.tenor.com',
  'media.giphy.com',
  'i.giphy.com',
  'i.imgur.com',
  // Envois du site (Worker workers/livechat, stockage R2).
  'olycity-livechat.olycity.workers.dev',
];

const SIZES = ['grand', 'moyen', 'petit'];
const SIZE_LABELS = { grand: 'Grand', moyen: 'Moyen', petit: 'Petit' };
const PREFIXES = { g: 'grand', grand: 'grand', m: 'moyen', moyen: 'moyen', p: 'petit', petit: 'petit' };

function isAllowedMediaUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return MEDIA_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * « g: texte », « petit : texte »… en tête de message choisit le format.
 * Sans préfixe : moyen.
 */
function parseSizePrefix(content) {
  const match = String(content || '').match(/^\s*(grand|moyen|petit|g|m|p)\s*:\s*/i);
  if (!match) return { size: 'moyen', text: String(content || '').trim() };
  return { size: PREFIXES[match[1].toLowerCase()], text: String(content).slice(match[0].length).trim() };
}

function kindFromAttachment(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  const name = String(attachment?.name || attachment?.url || '').toLowerCase().split('?')[0];
  if (type === 'image/gif' || name.endsWith('.gif')) return 'gif';
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(name)) return 'video';
  return null;
}

function mediaFromAttachments(attachments = []) {
  for (const attachment of attachments) {
    const kind = kindFromAttachment(attachment);
    if (kind && isAllowedMediaUrl(attachment.url)) return { url: attachment.url, kind };
  }
  return null;
}

/**
 * GIF Tenor/Giphy et images collées en lien : Discord les transforme en
 * embed. Un « gifv » est en réalité une courte vidéo MP4 à boucler.
 */
function mediaFromEmbeds(embeds = []) {
  for (const raw of embeds) {
    const embed = raw?.data || raw || {};
    const type = String(embed.type || '').toLowerCase();
    const video = embed.video?.url;
    const image = embed.image?.url || (type === 'image' ? embed.thumbnail?.url : null);
    if (type === 'gifv' && isAllowedMediaUrl(video)) return { url: video, kind: 'gif' };
    if (type === 'video' && isAllowedMediaUrl(video) && /\.(mp4|webm|mov)(\?|$)/i.test(video)) return { url: video, kind: 'video' };
    if (image && isAllowedMediaUrl(image)) return { url: image, kind: /\.gif(\?|$)/i.test(image) ? 'gif' : 'image' };
  }
  return null;
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

/**
 * Extrait d'une vidéo : { startMs, endMs } à partir de deux temps (« 1:20 »,
 * « 80 », « 1m20s »), ou null. Sans fin, 30 s depuis le début.
 */
function clipFromTimes(start, end, fallbackStartMs = null) {
  const startMs = parseTimecode(start) ?? fallbackStartMs;
  if (startMs == null) return null;
  let endMs = parseTimecode(end);
  if (endMs == null || endMs <= startMs) endMs = startMs + DEFAULT_CLIP_MS;
  return { startMs, endMs: Math.min(endMs, startMs + MAX_CLIP_MS) };
}

// « 1:20-1:35 », « 80 → 95 », « 1m20s à 1m35s » dans un message.
const RANGE = /(?:^|\s)(\d+(?::\d{1,2}){0,2}(?:\.\d+)?|\d+h\d*m?\d*s?|\d+m\d*s?|\d+s)\s*(?:-|–|→|->|>|à)\s*(\d+(?::\d{1,2}){0,2}(?:\.\d+)?|\d+h\d*m?\d*s?|\d+m\d*s?|\d+s)(?=\s|$)/i;

/** Premier lien vidéo accepté d'un texte, avec l'extrait indiqué à côté. */
function linkFromText(text) {
  for (const candidate of String(text || '').match(/https?:\/\/\S+/g) || []) {
    const link = normalizeVideoLink(candidate.replace(/[>)\].,!?]+$/, ''));
    if (!link) continue;
    const rest = String(text).replace(candidate, ' ');
    const range = rest.match(RANGE);
    const trim = range ? clipFromTimes(range[1], range[2]) : clipFromTimes(null, null, link.startMs);
    const cleaned = (range ? rest.replace(range[0], ' ') : rest).replace(/\s+/g, ' ').trim();
    return { link, trim, text: cleaned };
  }
  return null;
}

function buildLiveChatItem({ from, text = '', media = null, link = null, trim = null, size = 'moyen', target = null, source = 'discord', discordMessageId = null }) {
  return {
    createdAt: { '.sv': 'timestamp' },
    source,
    from: {
      // Identifiant roster de l'expéditeur : le Live lui affiche aussi ses envois ciblés.
      ...(from?.id ? { id: String(from.id) } : {}),
      name: String(from?.name || 'Anonyme').slice(0, 40),
      avatar: isAllowedMediaUrl(from?.avatar) ? from.avatar : null,
    },
    text: cleanText(text),
    media: media && isAllowedMediaUrl(media.url) ? { url: media.url, kind: media.kind } : null,
    // Lien YouTube, clip… : lu par chaque Live avec yt-dlp.
    ...(!media && link ? { link: { url: link } } : {}),
    ...((media?.kind === 'video' || (!media && link)) && trim ? { trim } : {}),
    size: SIZES.includes(size) ? size : 'moyen',
    target: target || null,
    ...(discordMessageId ? { discordMessageId } : {}),
  };
}

async function publishLiveChatItem(item) {
  return fbPost(LIVECHAT_QUEUE_PATH, item);
}

/** Membres dont le Live tourne et accepte le livechat. */
function onlineReceivers(receivers, now = Date.now()) {
  return Object.entries(receivers || {})
    .filter(([, receiver]) => receiver && receiver.enabled !== false && now - Number(receiver.ts || 0) <= RECEIVER_FRESH_MS)
    .map(([memberId, receiver]) => ({ memberId, name: String(receiver.name || memberId) }));
}

async function fetchOnlineReceivers() {
  return onlineReceivers(await fbGet(LIVECHAT_RECEIVERS_PATH).catch(() => null));
}

/** Membres en ligne qui ont coupé leur livechat. */
function mutedReceivers(receivers, now = Date.now()) {
  return Object.entries(receivers || {})
    .filter(([, receiver]) => receiver && receiver.enabled === false && now - Number(receiver.ts || 0) <= RECEIVER_FRESH_MS)
    .map(([memberId, receiver]) => ({ memberId, name: String(receiver.name || memberId) }));
}

/**
 * Réactive le livechat chez tout le monde ou chez une personne. Chaque Live
 * écoute livechat/control et applique l'ordre s'il est plus récent que le
 * dernier qu'il a suivi.
 */
async function requestReenable(target, by) {
  const path = target ? `${LIVECHAT_CONTROL_PATH}/members/${target}` : `${LIVECHAT_CONTROL_PATH}/all`;
  await fbPut(path, { enableAt: { '.sv': 'timestamp' }, by: String(by || 'Liam').slice(0, 40) });
  return path;
}

function staleQueueKeys(queue, now = Date.now()) {
  return Object.entries(queue || {})
    .filter(([, item]) => !item || !Number(item.createdAt) || now - Number(item.createdAt) > QUEUE_TTL_MS)
    .map(([key]) => key);
}

function startLiveChatCleanup() {
  const run = async () => {
    try {
      const queue = await fbGet(`${LIVECHAT_QUEUE_PATH}`);
      await Promise.all(staleQueueKeys(queue).map(key => fbDelete(`${LIVECHAT_QUEUE_PATH}/${key}`)));
    } catch (error) {
      console.error('[livechat:nettoyage]', error.message);
    }
  };
  run();
  setInterval(run, 60 * 1000).unref?.();
}

// Lu à chaque message du serveur : on garde la valeur une minute plutôt que
// d'interroger Firebase pour chaque message de chaque salon.
let channelCache = { value: null, at: 0 };

async function getLiveChatChannelId() {
  if (Date.now() - channelCache.at < 60 * 1000) return channelCache.value;
  const value = await fbGet(LIVECHAT_CHANNEL_PATH).catch(() => channelCache.value);
  channelCache = { value, at: Date.now() };
  return value;
}

async function setLiveChatChannelId(channelId) {
  await fbPut(LIVECHAT_CHANNEL_PATH, channelId);
  channelCache = { value: channelId, at: Date.now() };
}

/**
 * Résumé d'envoi : à qui le média va réellement s'afficher.
 */
function deliverySummary(receivers, target, targetName, senderId = null) {
  if (target) {
    const online = receivers.some(receiver => receiver.memberId === target);
    const senderOnline = Boolean(senderId) && senderId !== target && receivers.some(receiver => receiver.memberId === senderId);
    if (online) return `sur l'écran de **${targetName}**${senderOnline ? ' (et sur le tien)' : ''}`;
    return `pour **${targetName}**, mais son OLYCITY Live n'est pas en ligne${senderOnline ? ' — tu le vois quand même sur le tien' : ''}`;
  }
  if (!receivers.length) return 'mais aucun OLYCITY Live n\'est en ligne pour l\'instant';
  return `sur ${receivers.length} écran${receivers.length > 1 ? 's' : ''} (${receivers.map(r => r.name).join(', ')})`;
}

/**
 * Message posté dans le salon #livechat. Une mention en tout début de
 * message (après le préfixe de format) vise une seule personne.
 */
function parseLiveChatMessage(message, { memberByDiscordId }) {
  const { size, text: afterPrefix } = parseSizePrefix(message.content);
  let text = afterPrefix;
  let target = null;
  let targetName = null;

  const leading = text.match(/^<@!?(\d+)>\s*/);
  if (leading) {
    const member = memberByDiscordId(leading[1]);
    if (member) {
      target = member.id;
      targetName = member.name;
      text = text.slice(leading[0].length);
    }
  }

  const attached = mediaFromAttachments([...(message.attachments?.values?.() || [])]);
  // Un lien YouTube/Twitch/… passe avant son aperçu Discord (une miniature).
  const linked = attached ? null : linkFromText(text);
  const media = attached || (linked ? null : mediaFromEmbeds(message.embeds || []));
  if (linked) text = linked.text;
  // Le lien d'un GIF collé n'a rien à faire dans la légende.
  if (media && !message.attachments?.size) text = text.replace(/https?:\/\/\S+/g, '');
  // Les autres mentions deviennent des noms lisibles à l'écran.
  text = text.replace(/<@!?(\d+)>/g, (_, id) => {
    const user = message.mentions?.users?.get?.(id);
    return memberByDiscordId(id)?.name || user?.globalName || user?.username || '';
  }).replace(/<a?:(\w+):\d+>/g, ':$1:');

  return { size, text: cleanText(text), media, link: linked?.link.url || null, trim: linked?.trim || null, target, targetName };
}

function senderFor(user, guildMember, memberByDiscordId) {
  const member = memberByDiscordId(user.id);
  return {
    id: member?.id || null,
    name: member?.name || guildMember?.displayName || user.globalName || user.username,
    // La photo Discord du moment passe avant celle du roster, parfois périmée.
    avatar: (user.avatar && user.displayAvatarURL?.({ extension: 'png', size: 128 }))
      || member?.avatar || user.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
  };
}

async function handleLiveChatMessage(message, { memberByDiscordId, ensureRoster }) {
  if (message.author?.bot || message.webhookId || !message.guildId) return false;
  const channelId = await getLiveChatChannelId();
  if (!channelId || message.channelId !== channelId) return false;
  await ensureRoster().catch(() => {});

  // Discord ajoute l'embed d'un lien Tenor quelques instants après l'envoi.
  let parsed = parseLiveChatMessage(message, { memberByDiscordId });
  if (!parsed.media && !parsed.link && /https?:\/\//.test(message.content || '')) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const fresh = await message.fetch().catch(() => message);
    parsed = parseLiveChatMessage(fresh, { memberByDiscordId });
  }
  if (!parsed.media && !parsed.link && !parsed.text) return false;

  const item = buildLiveChatItem({
    from: senderFor(message.author, message.member, memberByDiscordId),
    text: parsed.text,
    media: parsed.media,
    link: parsed.link,
    trim: parsed.trim,
    size: parsed.size,
    target: parsed.target,
    discordMessageId: message.id,
  });
  await publishLiveChatItem(item);
  const receivers = await fetchOnlineReceivers();
  const reached = parsed.target ? receivers.some(r => r.memberId === parsed.target) : receivers.length > 0;
  await message.react(reached ? '📺' : '💤').catch(() => {});
  return true;
}

module.exports = {
  LIVECHAT_CONTROL_PATH,
  clipFromTimes,
  linkFromText,
  mutedReceivers,
  requestReenable,
  LIVECHAT_CHANNEL_PATH,
  LIVECHAT_QUEUE_PATH,
  LIVECHAT_RECEIVERS_PATH,
  MEDIA_HOSTS,
  SIZE_LABELS,
  buildLiveChatItem,
  deliverySummary,
  fetchOnlineReceivers,
  getLiveChatChannelId,
  handleLiveChatMessage,
  isAllowedMediaUrl,
  kindFromAttachment,
  mediaFromAttachments,
  mediaFromEmbeds,
  onlineReceivers,
  parseLiveChatMessage,
  parseSizePrefix,
  publishLiveChatItem,
  senderFor,
  setLiveChatChannelId,
  staleQueueKeys,
  startLiveChatCleanup,
};
