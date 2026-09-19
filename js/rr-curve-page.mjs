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
import { valorantAccountSeries, lolAccountSeries, defaultVisible, withinRange, untrackedAccounts, curveDiagnostics, buildMembers } from './rr-curve-utils.mjs?v=20260919c-courbes';
import { renderCurvePage, emptyState } from './rr-curve-view.mjs?v=20260919c-courbes';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

let allSeries = [];
let visible = new Set();
let currentGame = '';
let loaded = false;
let listening = false;
let range = 'all';
let untracked = [];

async function fbGet(path) {
  return fetchJsonWithRetry(`${FIREBASE_URL}/${path}.json`, { timeoutMs: 12_000, init: { cache: 'no-store' } });
}

function render(root, game) {
  // Le filtrage se fait au rendu et non au chargement : changer de plage ne
  // doit pas relire l'historique, et les comptes cochés restent les mêmes.
  const shown = withinRange(allSeries, range);
  root.innerHTML = renderCurvePage({ allSeries: shown, visible, game, range, untracked });
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
    const rangeBtn = event.target.closest('.curve-range');
    if (rangeBtn) {
      range = rangeBtn.dataset.range;
      render(root, currentGame);
      return;
    }
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
  let overlay = null;
  let history = null;
  try {
    // rosterOverlay n'est pas un détail : il porte les puuids et les comptes
    // ajoutés depuis l'admin. Sans lui, un joueur dont le compte courant a été
    // enregistré là — ou qui s'est renommé — reste invisible.
    [roster, overlay, history] = await Promise.all([
      fetch('data/roster.json', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
      fbGet('rosterOverlay').catch(() => null),
      fbGet(game === 'lol' ? 'live/lolHistory' : 'live/history').catch(() => null),
    ]);
  } catch {
    root.innerHTML = emptyState('Historique indisponible — réessaie dans un instant.');
    return;
  }

  const members = buildMembers(roster, overlay);

  allSeries = game === 'lol' ? lolAccountSeries(history, members) : valorantAccountSeries(history, members);
  // Le diagnostic ne sert qu'à EXPLIQUER une absence, jamais à décider d'une
  // courbe : côté LoL il n'a pas de sens, l'historique y est déjà par compte.
  untracked = game === 'lol'
    ? untrackedAccounts(members, allSeries)
    : untrackedAccounts(members, allSeries, curveDiagnostics(history, members));
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
