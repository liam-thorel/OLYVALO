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
  setText('brand-subtitle', 'Valorant · League · Coop');
  setText('hero-eyebrow', 'OLYCITY · Le Discord');
  setText('hero-subtitle', 'Valorant · League · Coop');
  const meta = document.getElementById('hero-meta');
  if (meta) meta.style.display = 'none';
  const primary = document.getElementById('hero-primary-cta');
  if (primary) {
    primary.textContent = '● Voir le Live';
    primary.onclick = () => window.OLYCITY?.nav('live');
  }
  const secondary = document.getElementById('hero-secondary-cta');
  if (secondary) {
    secondary.style.display = 'none';
  }
  setText('history-page-subtitle', lol ? 'Les parties League of Legends du groupe' : 'Les parties du five stack');
  setText('footer-product', 'OLYCITY · 2026');
  const sources = document.getElementById('footer-sources');
  if (sources) sources.innerHTML = lol
    ? 'Données : Riot Client · Data Dragon'
    : 'Sources : <a href="https://www.rib.gg" target="_blank">RIB.gg</a> · <a href="https://metabot.gg/en/valorant" target="_blank">MetaBot</a> · <a href="https://vlr.gg" target="_blank">VLR.gg</a>';
  const activePage = document.querySelector('.spa-page.active')?.id?.replace('page-', '') || 'home';
  const pageLabel = activePage === 'home' ? '' : activePage.charAt(0).toUpperCase() + activePage.slice(1);
  document.title = pageLabel ? `OLYCITY — ${pageLabel}` : 'OLYCITY';
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

  const blockedInLol = new Set(['page-maps']);
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
