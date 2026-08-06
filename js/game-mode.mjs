const STORAGE_KEY = 'olycity-game';
const MODES = new Set(['valorant', 'lol']);

export function getGameMode() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return MODES.has(stored) ? stored : 'valorant';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function applyHomeCopy(mode) {
  const lol = mode === 'lol';
  setText('brand-subtitle', lol ? 'League Live & Historique' : 'Valorant Meta Comps');
  setText('hero-eyebrow', lol ? 'OLYCITY · League of Legends · EUW' : 'OLYCITY · Five Stack · EU');
  setText('hero-subtitle', lol ? 'League Live · Historique · Paris' : 'Valorant Meta Comps · Patch 13.00');
  const meta = document.getElementById('hero-meta');
  if (meta) meta.innerHTML = lol
    ? '<span><span class="dot"></span>Live Riot Client</span><span><span class="dot"></span>Historique séparé · EUW</span>'
    : '<span><span class="dot"></span>7 maps · Patch 13.00</span><span><span class="dot"></span>Données VLR.gg · EWC 2026</span>';
  const primary = document.getElementById('hero-primary-cta');
  if (primary) {
    primary.textContent = lol ? '● Voir les parties live' : '◆ Explorer les maps';
    primary.onclick = () => window.OLYCITY?.nav(lol ? 'live' : 'maps');
  }
  const secondary = document.getElementById('hero-secondary-cta');
  if (secondary) {
    secondary.textContent = lol ? '◇ Ouvrir l’historique' : '◉ Voir le roster';
    secondary.onclick = () => window.OLYCITY?.nav(lol ? 'history' : 'roster');
  }
  setText('history-page-subtitle', lol ? 'Les parties League of Legends du groupe' : 'Les parties du five stack');
  setText('footer-product', lol ? 'OLYCITY · League Live & Historique · EUW · 2026' : 'OLYCITY · Valorant Meta Comps · Patch 13.00 · 2026');
  const sources = document.getElementById('footer-sources');
  if (sources) sources.innerHTML = lol
    ? 'Données : Riot Client · Data Dragon'
    : 'Sources : <a href="https://vlr.gg" target="_blank">VLR.gg</a> · <a href="https://hotspawn.com" target="_blank">Hotspawn</a> · <a href="https://dak.gg" target="_blank">dak.gg</a>';
  const activePage = document.querySelector('.spa-page.active')?.id?.replace('page-', '') || 'home';
  const pageLabel = activePage === 'home' ? (lol ? 'League of Legends' : 'Valorant Meta Comps') : activePage.charAt(0).toUpperCase() + activePage.slice(1);
  document.title = `OLYCITY — ${pageLabel}`;
}

export function setGameMode(mode, { navigate = true } = {}) {
  const next = MODES.has(mode) ? mode : 'valorant';
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.dataset.game = next;
  document.querySelectorAll('[data-game-choice]').forEach(button => {
    const active = button.dataset.gameChoice === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  applyHomeCopy(next);

  const blockedInLol = new Set(['page-maps', 'page-agents', 'page-builder']);
  const activePageId = document.querySelector('.spa-page.active')?.id || '';
  if (navigate && next === 'lol' && blockedInLol.has(activePageId)) {
    window.OLYCITY.nav('home');
  }
  document.dispatchEvent(new CustomEvent('olycity:gamechange', { detail: { mode: next } }));
  return next;
}

export function initGameMode() {
  document.querySelectorAll('[data-game-choice]').forEach(button => {
    button.addEventListener('click', () => setGameMode(button.dataset.gameChoice));
  });
  return setGameMode(getGameMode(), { navigate: false });
}
