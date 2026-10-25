/**
 * Liens vidéo du livechat : YouTube, clips Twitch, X, Reddit, TikTok…
 *
 * Le Live ne télécharge jamais une adresse arbitraire : Firebase est ouvert en
 * écriture, et une URL libre ferait contacter n'importe quel serveur par tous
 * les PC du groupe (leur adresse IP avec). Seuls ces sites sont acceptés, et
 * c'est yt-dlp qui en extrait la vidéo.
 *
 * Ce fichier est copié à l'identique dans discord-bot/ et extension/ (le bot
 * est déployé seul, l'extension n'a pas accès au reste) ; le Worker en a sa
 * version ESM. Un test vérifie que tout concorde.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OlyVideoLinks = api; // extension navigateur
}(typeof self !== 'undefined' ? self : this, () => {
  const VIDEO_LINK_HOSTS = [
    'youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'twitch.tv',
    'x.com',
    'twitter.com',
    'reddit.com',
    'redd.it',
    'tiktok.com',
    'instagram.com',
    'streamable.com',
    'vimeo.com',
    'dailymotion.com',
    'dai.ly',
    'kick.com',
    'medal.tv',
  ];

  const MAX_LINK_LENGTH = 500;

  function hostAllowed(hostname) {
    const host = String(hostname || '').toLowerCase();
    return VIDEO_LINK_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
  }

  /** Identifiant d'une vidéo YouTube, quelle que soit la forme du lien. */
  function youtubeId(parsed) {
    const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = parsed.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
      else id = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] || null;
    }
    return /^[A-Za-z0-9_-]{11}$/.test(String(id || '')) ? id : null;
  }

  /** « 1h2m3s », « 83 », « 1:23 » → millisecondes, ou null. */
  function parseTimecode(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
    const units = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    if (units && (units[1] || units[2] || units[3])) {
      return Math.round(((Number(units[1] || 0) * 60 + Number(units[2] || 0)) * 60 + Number(units[3] || 0)) * 1000);
    }
    const clock = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (clock) return Math.round(((Number(clock[1] || 0) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000);
    return null;
  }

  /**
   * Lien vidéo accepté, sous forme canonique, ou null. YouTube est ramené à
   * https://www.youtube.com/watch?v=ID (sans playlist ni suivi), et le moment
   * indiqué par « t= » est rendu à part : c'est un début d'extrait.
   */
  function normalizeVideoLink(input) {
    const raw = String(input || '').trim();
    if (!raw || raw.length > MAX_LINK_LENGTH) return null;
    let parsed;
    try { parsed = new URL(raw); } catch { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return null;
    if (!hostAllowed(parsed.hostname)) return null;

    const id = youtubeId(parsed);
    if (/youtu/.test(parsed.hostname)) {
      if (!id) return null; // chaîne, playlist, page d'accueil : rien à lire
      const startMs = parseTimecode(parsed.searchParams.get('t') || parsed.searchParams.get('start'));
      return { url: `https://www.youtube.com/watch?v=${id}`, site: 'youtube', startMs };
    }
    parsed.protocol = 'https:';
    parsed.hash = '';
    return { url: parsed.toString(), site: parsed.hostname.toLowerCase().replace(/^www\./, ''), startMs: null };
  }

  return { VIDEO_LINK_HOSTS, MAX_LINK_LENGTH, hostAllowed, normalizeVideoLink, parseTimecode, youtubeId };
}));
