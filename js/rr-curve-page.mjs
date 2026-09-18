/**
 * OLYCITY — Courbes de progression.
 *
 * Le rang de chaque COMPTE dans le temps. Le graphique est un SVG construit à
 * la main : le site n'embarque aucune bibliothèque de tracé, et une courbe
 * ligne brisée n'en justifie pas une.
 *
 * Les séries et les échelles vivent dans rr-curve-utils.mjs, le balisage
 * dans rr-curve-view.mjs — tous deux testables sans navigateur, et c'est ce
 * même balisage qu'affiche l'aperçu de conception. Ce fichier ne fait que
 * charger les données et écouter les clics.
 */

import { fetchJsonWithRetry } from './request-utils.mjs?v=20260825-first-load-recovery';
import { getGameMode } from './game-mode.mjs';
import { valorantAccountSeries, lolAccountSeries, defaultVisible } from './rr-curve-utils.mjs?v=20260918-courbes';
import { renderCurvePage, emptyState } from './rr-curve-view.mjs?v=20260918-courbes';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

let allSeries = [];
let visible = new Set();
let currentGame = '';
let loaded = false;
let listening = false;

async function fbGet(path) {
  return fetchJsonWithRetry(`${FIREBASE_URL}/${path}.json`, { timeoutMs: 12_000, init: { cache: 'no-store' } });
}

function render(root, game) {
  root.innerHTML = renderCurvePage({ allSeries, visible, game });
}

/**
 * Un seul écouteur pour toute la vie de la page.
 *
 * initRrCurvePage() est rappelée à chaque changement de jeu : en attachant
 * l'écouteur là, chaque bascule en ajoutait un. Deux écouteurs, c'est un clic
 * qui allume puis éteint aussitôt — la légende cessait de répondre.
 */
function listenOnce(root) {
  if (listening) return;
  listening = true;
  root.addEventListener('click', event => {
    const legendBtn = event.target.closest('.curve-legend-item');
    if (!legendBtn) return;
    const key = legendBtn.dataset.series;
    if (visible.has(key)) visible.delete(key);
    else visible.add(key);
    render(root, currentGame);
  });
}

export async function initRrCurvePage() {
  const root = document.getElementById('curves-content');
  if (!root) return;

  const game = getGameMode() === 'lol' ? 'lol' : 'valorant';
  // Le changement de jeu recharge : les deux historiques vivent dans des
  // nœuds différents et n'ont pas la même échelle.
  if (loaded && game === currentGame) { render(root, game); return; }
  currentGame = game;

  root.innerHTML = '<p class="curve-empty">Chargement des courbes…</p>';

  let roster = [];
  let history = null;
  try {
    [roster, history] = await Promise.all([
      fetch('data/roster.json', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
      fbGet(game === 'lol' ? 'live/lolHistory' : 'live/history').catch(() => null),
    ]);
  } catch {
    root.innerHTML = emptyState('Historique indisponible — réessaie dans un instant.');
    return;
  }

  const members = (Array.isArray(roster) ? roster : []).map(player => ({
    name: player?.name || '',
    riotIds: [player?.riot, ...(player?.smurfs || [])]
      .filter(account => account?.name)
      .map(account => (account.tag ? `${account.name}#${account.tag}` : String(account.name))),
  }));

  allSeries = game === 'lol' ? lolAccountSeries(history, members) : valorantAccountSeries(history, members);
  visible = new Set(defaultVisible(allSeries));
  loaded = true;

  render(root, game);
  listenOnce(root);
}

// Le mode de jeu peut changer pendant que la page est ouverte : les deux
// historiques vivent dans des nœuds différents et n'ont pas la même échelle.
document.addEventListener('olycity:gamechange', () => {
  if (!document.getElementById('page-courbes')?.classList.contains('active')) return;
  loaded = false;
  initRrCurvePage();
});
