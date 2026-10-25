/**
 * OLYCITY Livechat — logo sur les vidéos et panneau d'envoi.
 *
 * Au survol d'une vidéo envoyable, un petit logo apparaît en haut à droite.
 * Un clic ouvre le panneau : début et fin de l'extrait pris sur la vidéo
 * elle-même (on la fait défiler, on clique « maintenant »), légende, taille,
 * destinataire. L'envoi passe par le service worker (background.js).
 *
 * Envoyable :
 *   - une page d'un site connu (YouTube, Twitch, X, Reddit…) : on envoie le
 *     LIEN, que chaque Live lit avec yt-dlp ;
 *   - ailleurs, une vidéo dont la source est un vrai fichier (pas un flux
 *     « blob: ») : l'extension la télécharge et la dépose sur le Worker.
 * Le reste (flux protégés) n'affiche pas de logo.
 */
(() => {
  if (window.top !== window || window.__olyLivechat) return;
  window.__olyLivechat = true;

  const links = self.OlyVideoLinks;
  const MIN_W = 200;
  const MIN_H = 112;
  const DEFAULT_CLIP_S = 15;
  const BADGE = 34;

  // ─── Quelle vidéo, quelle source ─────────────────────────────────────────

  function visibleVideos() {
    return [...document.querySelectorAll('video')].filter(video => {
      const r = video.getBoundingClientRect();
      return r.width >= MIN_W && r.height >= MIN_H && r.bottom > 0 && r.top < innerHeight;
    });
  }

  function videoAt(x, y) {
    return visibleVideos()
      .filter(video => { const r = frameRect(video); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; })
      .sort((a, b) => area(b) - area(a))[0] || null;
  }

  const area = video => { const r = video.getBoundingClientRect(); return r.width * r.height; };

  // Le cadre visible du lecteur : sur YouTube, le conteneur du lecteur (la
  // vidéo elle-même est parfois plus petite, avec des bandes noires).
  function frameRect(video) {
    const player = video.closest('#movie_player, .html5-video-player');
    return (player || video).getBoundingClientRect();
  }

  function pageLink(video) {
    const host = location.hostname.toLowerCase();
    if (!links.hostAllowed(host)) return null;
    // X : sur un fil, le lien du tweet qui contient la vidéo.
    if (/(^|\.)(x|twitter)\.com$/.test(host)) {
      const time = video.closest('article')?.querySelector('a[href*="/status/"] time');
      const href = time?.closest('a')?.href || (/\/status\//.test(location.pathname) ? location.href : null);
      return href ? links.normalizeVideoLink(href) : null;
    }
    // Reddit : le permalien du post.
    if (/(^|\.)reddit\.com$/.test(host)) {
      const permalink = video.closest('shreddit-post')?.getAttribute('permalink');
      return links.normalizeVideoLink(permalink ? new URL(permalink, location.origin).href : location.href);
    }
    // Twitch, Kick : un direct ne se termine jamais, seuls clips et rediffusions.
    if (/(^|\.)(twitch\.tv|kick\.com)$/.test(host)) {
      const clipOrVod = host.startsWith('clips.') || /\/clips?\/|\/videos?\//.test(location.pathname) || /[?&]clip=/.test(location.search);
      if (!clipOrVod) return null;
    }
    return links.normalizeVideoLink(location.href);
  }

  /** { link } ou { fileUrl } ou null. */
  function sourceFor(video) {
    const link = pageLink(video);
    if (link) return { link: link.url, site: link.site };
    const src = video.currentSrc || video.src || '';
    if (/^https?:\/\//.test(src)) return { fileUrl: src, site: location.hostname.replace(/^www\./, '') };
    return null;
  }

  // ─── Interface (Shadow DOM : le style de la page ne la touche pas) ───────

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
      .badge {
        position: fixed; width: ${BADGE}px; height: ${BADGE}px; border-radius: 50%; border: 0; padding: 0;
        background: #ff4655; color: #fff; cursor: pointer; display: grid; place-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,.45); opacity: 0; transform: scale(.85);
        transition: opacity .15s, transform .15s; pointer-events: none;
      }
      .badge.show { opacity: 1; transform: scale(1); pointer-events: auto; }
      .badge:hover { background: #ff2d40; transform: scale(1.08); }
      .badge svg { width: 22px; height: 22px; }
      .panel {
        position: fixed; width: 320px; max-height: calc(100vh - 24px); overflow: auto;
        background: #12151c; color: #e8e8ee; border: 1px solid rgba(255,255,255,.12); border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,.6); padding: 14px; font-size: 13px; display: none;
      }
      .panel.open { display: block; }
      .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .head strong { font-size: 14px; letter-spacing: .3px; }
      .x { background: none; border: 0; color: #9aa0ad; font-size: 20px; cursor: pointer; line-height: 1; }
      .row { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
      .row label { min-width: 46px; color: #9aa0ad; }
      .account { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: rgba(255,255,255,.04); }
      .account img { width: 26px; height: 26px; border-radius: 50%; }
      .src { color: #9aa0ad; font-size: 12px; margin-top: 6px; }
      input[type=text], select {
        flex: 1; min-width: 0; background: #1b1f29; color: inherit; border: 1px solid rgba(255,255,255,.14);
        border-radius: 6px; padding: 6px 8px; font-size: 13px;
      }
      input.time { flex: 0 0 72px; text-align: center; font-variant-numeric: tabular-nums; }
      button.small, .seg button {
        background: #1b1f29; color: inherit; border: 1px solid rgba(255,255,255,.14); border-radius: 6px;
        padding: 6px 8px; font-size: 12px; cursor: pointer;
      }
      button.small:hover, .seg button:hover { border-color: rgba(255,255,255,.35); }
      .seg { display: flex; gap: 4px; flex: 1; }
      .seg button { flex: 1; }
      .seg button.on { background: #ff4655; border-color: #ff4655; color: #fff; }
      .discord { width: 100%; background: #5865f2; color: #fff; border: 0; border-radius: 6px; padding: 9px; font-weight: 600; cursor: pointer; }
      .send { width: 100%; margin-top: 10px; background: #ff4655; color: #fff; border: 0; border-radius: 6px; padding: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
      .send:disabled { opacity: .55; cursor: default; }
      .status { min-height: 18px; margin-top: 8px; font-size: 12px; color: #9aa0ad; }
      .status.err { color: #ff8a95; }
      .status.ok { color: #6bd990; }
      .dur { color: #9aa0ad; font-size: 12px; margin-left: auto; }
      .check { display: flex; align-items: center; gap: 6px; color: #c8cad2; cursor: pointer; }
    </style>
    <button class="badge" type="button" title="Envoyer sur le livechat OLYCITY" aria-label="Envoyer sur le livechat OLYCITY">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="10.5" r="7"/><circle cx="12" cy="10.5" r="1.6" fill="currentColor"/>
        <path d="M12 3.5v14M5 10.5h14M7 5.6l10 9.8M17 5.6 7 15.4"/><path d="M12 17.5 8.5 22h7Z" fill="currentColor" stroke-width="1"/>
      </svg>
    </button>
    <div class="panel" role="dialog" aria-label="Livechat OLYCITY">
      <div class="head"><strong>📺 Livechat OLYCITY</strong><button class="x" type="button" aria-label="Fermer">×</button></div>
      <div class="account"></div>
      <div class="src"></div>
      <div class="trim">
        <div class="row"><label class="check"><input type="checkbox" class="whole"> Vidéo entière</label><span class="dur"></span></div>
        <div class="row"><label>Début</label><input class="time start" type="text" inputmode="numeric"><button class="small now-start" type="button">⟲ maintenant</button></div>
        <div class="row"><label>Fin</label><input class="time end" type="text" inputmode="numeric"><button class="small now-end" type="button">⟲ maintenant</button></div>
        <div class="row"><button class="small preview" type="button">▶ Aperçu de l’extrait</button></div>
      </div>
      <div class="row"><input class="text" type="text" maxlength="220" placeholder="Légende (facultatif)"></div>
      <div class="row"><label>Taille</label><div class="seg size"><button type="button" data-size="grand">Grand</button><button type="button" data-size="moyen" class="on">Moyen</button><button type="button" data-size="petit">Petit</button></div></div>
      <div class="row"><label>Pour</label><select class="target"><option value="">Tout le monde</option></select></div>
      <div class="row"><label class="check"><input type="checkbox" class="muted"> Sans le son</label></div>
      <button class="send" type="button">Envoyer</button>
      <div class="status" aria-live="polite"></div>
    </div>`;

  const $ = selector => root.querySelector(selector);
  const badge = $('.badge');
  const panel = $('.panel');
  const status = (text, kind = '') => { const el = $('.status'); el.textContent = text; el.className = `status ${kind}`; };

  // Les raccourcis de la page (k, j, l, espace… sur YouTube) ne doivent pas
  // réagir pendant qu'on tape dans le panneau.
  ['keydown', 'keyup', 'keypress'].forEach(type => host.addEventListener(type, event => event.stopPropagation()));

  let hovered = null;  // vidéo sous la souris
  let target = null;   // vidéo du panneau ouvert
  let source = null;
  let hideTimer = null;
  let size = 'moyen';
  let previewStop = null;
  let me = null;

  function attach() {
    // En plein écran, seul l'élément plein écran est dessiné : le logo doit y être.
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  function place() {
    const video = target || hovered;
    if (!video || !video.isConnected) return;
    const r = frameRect(video);
    badge.style.left = `${Math.round(r.right - BADGE - 12)}px`;
    badge.style.top = `${Math.round(Math.max(8, r.top + 12))}px`;
    if (panel.classList.contains('open')) {
      panel.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - 328, r.right - 320 - 12)))}px`;
      panel.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - 120, r.top + 12 + BADGE + 8)))}px`;
    }
  }

  function showBadge(video) {
    clearTimeout(hideTimer);
    hovered = video;
    attach();
    place();
    badge.classList.add('show');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (panel.classList.contains('open')) return;
      badge.classList.remove('show');
      hovered = null;
    }, 1200);
  }

  let lastMove = 0;
  document.addEventListener('mousemove', event => {
    const now = performance.now();
    if (now - lastMove < 80) return;
    lastMove = now;
    if (event.composedPath().includes(host)) { clearTimeout(hideTimer); return; }
    const video = videoAt(event.clientX, event.clientY);
    if (video && sourceFor(video)) showBadge(video);
    else if (hovered) scheduleHide();
  }, { passive: true });
  addEventListener('scroll', place, { passive: true, capture: true });
  addEventListener('resize', place, { passive: true });
  document.addEventListener('fullscreenchange', () => { attach(); place(); });

  // ─── Panneau ─────────────────────────────────────────────────────────────

  const fmt = seconds => {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = (s % 60).toFixed(1).replace(/\.0$/, '');
    const sec = String(rest).padStart(rest.includes('.') ? 4 : 2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const parse = text => { const ms = links.parseTimecode(text); return ms == null ? null : ms / 1000; };

  function updateDuration() {
    const start = parse($('.start').value);
    const end = parse($('.end').value);
    const ok = start != null && end != null && end - start >= 0.3;
    $('.dur').textContent = $('.whole').checked ? '' : ok ? `extrait de ${fmt(end - start)}` : 'temps invalide';
    ['.start', '.end', '.now-start', '.now-end', '.preview'].forEach(sel => { $(sel).disabled = $('.whole').checked; });
  }

  function renderAccount() {
    const box = $('.account');
    if (me?.member) {
      box.innerHTML = '';
      if (me.member.avatar) { const img = document.createElement('img'); img.src = me.member.avatar; img.alt = ''; box.appendChild(img); }
      const name = document.createElement('span');
      name.textContent = `${me.member.name} · connecté avec Discord`;
      box.appendChild(name);
      $('.send').disabled = false;
      return;
    }
    box.innerHTML = '<button class="discord" type="button">Se connecter avec Discord</button>';
    box.querySelector('.discord').addEventListener('click', async () => {
      status('Connexion…');
      const res = await chrome.runtime.sendMessage({ type: 'login' });
      if (!res?.ok) { status(res?.error || 'Connexion impossible.', 'err'); return; }
      me = res.result;
      if (!me) status('Ton compte Discord ne fait pas partie du roster OLYCITY.', 'err');
      else status('');
      renderAccount();
    });
    $('.send').disabled = true;
  }

  async function loadTargets() {
    const res = await chrome.runtime.sendMessage({ type: 'targets' });
    if (!res?.ok) return;
    const select = $('.target');
    select.innerHTML = '<option value="">Tout le monde</option>';
    res.result.forEach(member => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = `${member.online ? '● ' : member.muted ? '🔇 ' : '○ '}${member.name}`;
      select.appendChild(option);
    });
  }

  async function openPanel() {
    target = hovered;
    if (!target) return;
    source = sourceFor(target);
    if (!source) return;
    stopPreview();
    const duration = Number.isFinite(target.duration) ? target.duration : 0;
    const startAt = target.currentTime || 0;
    $('.start').value = fmt(startAt);
    $('.end').value = fmt(duration ? Math.min(duration, startAt + DEFAULT_CLIP_S) : startAt + DEFAULT_CLIP_S);
    // Une vidéo courte (clip, tweet) part entière par défaut.
    $('.whole').checked = duration > 0 && duration <= 20;
    $('.src').textContent = source.link
      ? `Lien ${source.site} — lu par chaque OLYCITY Live`
      : `Vidéo de ${source.site} — envoyée comme fichier (500 Mo max)`;
    updateDuration();
    status('');
    panel.classList.add('open');
    badge.classList.add('show');
    place();
    const res = await chrome.runtime.sendMessage({ type: 'account' });
    me = res?.ok ? res.result : null;
    renderAccount();
    loadTargets();
  }

  function closePanel() {
    stopPreview();
    panel.classList.remove('open');
    target = null;
    scheduleHide();
  }

  function stopPreview() {
    if (previewStop) { target?.removeEventListener('timeupdate', previewStop); previewStop = null; }
  }

  badge.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });
  $('.x').addEventListener('click', closePanel);
  $('.whole').addEventListener('change', updateDuration);
  $('.start').addEventListener('input', updateDuration);
  $('.end').addEventListener('input', updateDuration);
  $('.now-start').addEventListener('click', () => {
    if (!target) return;
    $('.start').value = fmt(target.currentTime);
    const end = parse($('.end').value);
    if (end == null || end <= target.currentTime) $('.end').value = fmt(target.currentTime + DEFAULT_CLIP_S);
    updateDuration();
  });
  $('.now-end').addEventListener('click', () => { if (target) { $('.end').value = fmt(target.currentTime); updateDuration(); } });
  $('.preview').addEventListener('click', () => {
    const start = parse($('.start').value);
    const end = parse($('.end').value);
    if (!target || start == null || end == null || end <= start) return;
    stopPreview();
    target.currentTime = start;
    target.play().catch(() => {});
    previewStop = () => { if (target && target.currentTime >= end) { target.pause(); stopPreview(); } };
    target.addEventListener('timeupdate', previewStop);
  });
  $('.size').addEventListener('click', event => {
    const button = event.target.closest('button[data-size]');
    if (!button) return;
    size = button.dataset.size;
    root.querySelectorAll('.size button').forEach(b => b.classList.toggle('on', b === button));
  });

  $('.send').addEventListener('click', async () => {
    if (!source) return;
    let trim = null;
    if (!$('.whole').checked) {
      const start = parse($('.start').value);
      const end = parse($('.end').value);
      if (start == null || end == null || end - start < 0.3) { status('Début et fin invalides (ex. 1:20 et 1:35).', 'err'); return; }
      trim = { startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) };
    }
    const select = $('.target');
    const payload = {
      ...(source.link ? { link: source.link } : { fileUrl: source.fileUrl }),
      trim,
      text: $('.text').value.trim(),
      size,
      target: select.value || null,
      targetName: select.value ? select.selectedOptions[0].textContent.replace(/^[●○🔇]\s*/u, '') : null,
      muted: $('.muted').checked,
    };
    $('.send').disabled = true;
    status(source.fileUrl ? 'Téléchargement de la vidéo…' : 'Envoi…');
    const res = await chrome.runtime.sendMessage({ type: 'send', payload });
    $('.send').disabled = false;
    if (!res?.ok) { status(res?.error || 'Envoi impossible.', 'err'); return; }
    status('📺 Envoyé sur le livechat !', 'ok');
    $('.text').value = '';
    setTimeout(closePanel, 1400);
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'upload-progress' && panel.classList.contains('open')) {
      status(`Envoi de la vidéo… ${Math.round(message.progress * 100)} %`);
    }
  });

  // YouTube et les autres sites à navigation interne changent de vidéo sans
  // recharger la page : le panneau ouvert sur l'ancienne se ferme.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; if (panel.classList.contains('open')) closePanel(); }
    if (badge.classList.contains('show')) place();
  }, 500);
})();
