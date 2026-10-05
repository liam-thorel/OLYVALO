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
  const picker = document.querySelector('.game-switch');
  const label = next === 'lol' ? 'League of Legends' : 'Valorant';
  if (picker) {
    picker.querySelector('[data-game-label]').textContent = label;
    picker.querySelector('[data-game-short]').textContent = next === 'lol' ? 'LoL' : 'VAL';
    picker.querySelector('summary').setAttribute('aria-label', `Choisir le jeu : ${label}`);
    picker.querySelector('summary .game-switch-mark').textContent = next === 'lol' ? 'L' : 'V';
  }
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
  if (navigate && document.getElementById('page-history')?.classList.contains('active')) {
    window.OLYCITY?.nav?.('history', false);
  }
  return next;
}

export function initGameMode() {
  const picker = document.querySelector('.game-switch');
  const close = (restoreFocus = false) => {
    if (!picker?.open) return;
    picker.open = false;
    if (restoreFocus) picker.querySelector('summary').focus();
  };
  document.querySelectorAll('[data-game-choice]').forEach(button => {
    button.addEventListener('click', () => {
      setGameMode(button.dataset.gameChoice);
      close(true);
    });
  });
  picker?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  picker?.addEventListener('focusout', event => {
    if (!picker.contains(event.relatedTarget)) close();
  });
  picker?.addEventListener('toggle', () => {
    if (picker.open) document.querySelectorAll('.oly-site-switcher[open]').forEach(el => { el.open = false; });
  });
  document.addEventListener('click', event => {
    if (picker && !picker.contains(event.target)) close();
  });
  return setGameMode(getGameMode(), { navigate: false });
}
