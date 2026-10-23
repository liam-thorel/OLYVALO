// Shared OLYCITY music remote. The iframe owns the authenticated session;
// only layout and theme messages cross origins, never cookies or commands.
export function musicFrameMessage(event, frameWindow, musicOrigin) {
  if (event.source !== frameWindow || event.origin !== musicOrigin) return null;
  if (event.data?.type === 'olycity:music-ready') return { ready:true };
  if (event.data?.type !== 'olycity:music-size' || !Number.isFinite(event.data.height)) return null;
  return { height:Math.max(44,Math.min(480,Math.ceil(event.data.height))), collapsed:event.data.collapsed === true };
}

export function mountMusicPlayer({ musicOrigin = 'https://musique.olycity.fr', miniPath = '/mini' } = {}) {
  if (document.getElementById('oly-music-remote') || location.origin === musicOrigin) return;
  const root = document.documentElement;
  const styles = document.createElement('style');
  styles.textContent = `
    #oly-music-remote{position:fixed;z-index:650;left:18px;bottom:18px;width:min(420px,calc(100vw - 36px));filter:drop-shadow(0 8px 20px #0005)}
    #oly-music-remote iframe{display:block;width:100%;height:120px;border:0;border-radius:12px;background:transparent;color-scheme:dark}
    #oly-music-remote[data-collapsed=true]{width:128px}
    #oly-music-remote a{display:inline-flex;align-items:center;min-height:44px;padding:0 15px;border:1px solid #514065;border-radius:9px;background:#10131a;color:#e2e5ee;font:600 12px system-ui,sans-serif;text-decoration:none}
    #oly-music-remote a:focus-visible{outline:2px solid #a87fff;outline-offset:3px}
    #oly-music-remote [hidden]{display:none!important}
    #oly-music-space{height:var(--oly-music-space,0px);flex-shrink:0}
    @media(max-width:768px){#oly-music-remote{left:8px;bottom:calc(var(--oly-music-nav,0px) + 8px + env(safe-area-inset-bottom));width:calc(100vw - 16px)}#oly-music-remote[data-collapsed=true]{left:auto;right:8px;width:128px}}
    @media print{#oly-music-remote,#oly-music-space{display:none!important}}
  `;
  document.head.append(styles);
  const container = document.createElement('aside');
  container.id = 'oly-music-remote';
  container.setAttribute('aria-label','Musique Discord OLYCITY');
  const frame = document.createElement('iframe');
  const url = new URL(miniPath,musicOrigin);
  url.searchParams.set('parentOrigin',location.origin);
  frame.src = url.href;
  frame.title = 'Télécommande du bot musique OLYCITY';
  frame.referrerPolicy = 'origin';
  const fallback = document.createElement('a');
  fallback.href = musicOrigin; fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
  fallback.textContent = '♫ Musique ↗'; fallback.hidden = true;
  container.append(frame,fallback);
  const spacer = document.createElement('div'); spacer.id = 'oly-music-space'; spacer.setAttribute('aria-hidden','true');
  document.body.append(container,spacer);
  let ready = false;
  let height = 120;
  let collapsed = false;
  const theme = () => root.dataset.game || (location.hostname.startsWith('games.') ? 'games' : 'hub');
  const sendTheme = () => frame.contentWindow?.postMessage({type:'olycity:music-theme',theme:theme()},musicOrigin);
  const layout = () => {
    const mobile = innerWidth <= 768;
    const nav = document.querySelector('.page-nav,.mobile-nav');
    const rect = nav?.getBoundingClientRect();
    const navHeight = mobile && rect && getComputedStyle(nav).position === 'fixed' ? Math.max(0,innerHeight - rect.top) : 0;
    root.style.setProperty('--oly-music-nav',`${navHeight}px`);
    const visibleHeight = Math.min(height,Math.max(120,innerHeight - navHeight - 36));
    frame.style.height = `${visibleHeight}px`;
    container.dataset.collapsed = String(collapsed);
    root.style.setProperty('--oly-music-space',`${mobile ? visibleHeight + 16 : 140}px`);
    // Keep the remote out of modal/profile selection and installation dialogs.
    const modal = document.querySelector('[aria-modal="true"]:not([hidden])');
    const hide = Boolean(modal && modal.getBoundingClientRect().width && getComputedStyle(modal).visibility !== 'hidden');
    if (container.hidden !== hide) container.hidden = hide;
  };
  const watchdog = setTimeout(() => {
    if (ready) return;
    frame.hidden = true; frame.style.display = 'none'; fallback.hidden = false;
    collapsed = true; height = 44; layout();
  },10000);
  const message = event => {
    const value = musicFrameMessage(event,frame.contentWindow,musicOrigin);
    if (!value) return;
    if (value.ready) {
      ready = true; clearTimeout(watchdog); fallback.hidden = true; frame.hidden = false; frame.style.display = 'block'; sendTheme();
    }
    if (value.height) { height = value.height; collapsed = value.collapsed; }
    layout();
  };
  window.addEventListener('message',message);
  window.addEventListener('resize',layout);
  const refresh = () => { if (ready) frame.contentWindow?.postMessage({type:'olycity:music-refresh'},musicOrigin); layout(); };
  window.addEventListener('focus',refresh);
  window.addEventListener('pageshow',refresh);
  const observer = new MutationObserver(() => { sendTheme(); layout(); });
  observer.observe(root,{attributes:true,attributeFilter:['data-game']});
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','class']});
  layout();
  return () => { observer.disconnect(); clearTimeout(watchdog); window.removeEventListener('message',message); window.removeEventListener('resize',layout); window.removeEventListener('focus',refresh); window.removeEventListener('pageshow',refresh); container.remove(); spacer.remove(); styles.remove(); root.style.removeProperty('--oly-music-space'); root.style.removeProperty('--oly-music-nav'); };
}

if (typeof document !== 'undefined' && !document.documentElement.hasAttribute('data-music-player-manual')) mountMusicPlayer();
