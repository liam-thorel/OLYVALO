/**
 * OLYCITY — Courbes de progression.
 *
 * Le rang de chaque COMPTE dans le temps. Le graphique est un SVG construit à
 * la main : le site n'embarque aucune bibliothèque de tracé, et une courbe
 * ligne brisée n'en justifie pas une.
 *
 * Toute la logique (séries, couleurs, échelles, projection) vit dans
 * rr-curve-utils.mjs et se teste sans navigateur ; ce fichier ne fait que
 * dessiner et écouter les clics.
 */

import { fetchJsonWithRetry } from './request-utils.mjs?v=20260825-first-load-recovery';
import { getGameMode } from './game-mode.mjs';
import {
  valorantAccountSeries, lolAccountSeries, seriesLabel, curvePresets, applyPreset,
  seriesKey, plotLayout, seriesPath, ladderLabel,
} from './rr-curve-utils.mjs?v=20260918-courbes';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

let allSeries = [];
let visible = new Set();
let presets = [];
let activePreset = 'mains';
let currentGame = '';
let loaded = false;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fbGet(path) {
  return fetchJsonWithRetry(`${FIREBASE_URL}/${path}.json`, { timeoutMs: 12_000, init: { cache: 'no-store' } });
}

const dateLabel = ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

function emptyState(message) {
  return `<p class="curve-empty">${escapeHTML(message)}</p>`;
}

/**
 * Graduations horizontales.
 *
 * On place les repères sur les paliers ronds de l'échelle plutôt que sur des
 * valeurs réparties uniformément : « Diamant 2 » se lit, « 2 143 » non.
 */
function gridLines(layout, game) {
  const step = game === 'lol' ? 100 : 100;
  const first = Math.ceil(layout.minValue / step) * step;
  const lines = [];
  for (let value = first; value <= layout.maxValue && lines.length < 8; value += step) {
    lines.push({ y: layout.y(value), label: ladderLabel(game, value) });
  }
  return lines;
}

function renderChart(game) {
  const shown = allSeries.filter(s => visible.has(seriesKey(s)));
  if (shown.length === 0) return emptyState('Aucun compte sélectionné.');

  const width = 900;
  const height = 340;
  const layout = plotLayout(shown, { width, height, padding: 44 });
  if (!layout) return emptyState('Pas encore assez de parties classées pour tracer une courbe.');

  const grid = gridLines(layout, game).map(line => `
    <line class="curve-grid-line" x1="${layout.padding}" x2="${width - layout.padding}" y1="${line.y.toFixed(1)}" y2="${line.y.toFixed(1)}"></line>
    <text class="curve-grid-label" x="4" y="${(line.y + 4).toFixed(1)}">${escapeHTML(line.label)}</text>`).join('');

  const paths = shown.map(s => `
    <path class="curve-line" d="${seriesPath(s, layout)}" stroke="${escapeHTML(s.color)}"
          stroke-dasharray="${s.isMain ? 'none' : '6 4'}"></path>
    ${s.points.map(point => `<circle class="curve-dot" cx="${layout.x(point.ts).toFixed(1)}" cy="${layout.y(point.value).toFixed(1)}" r="3"
        fill="${escapeHTML(s.color)}"><title>${escapeHTML(`${seriesLabel(s, allSeries)} — ${ladderLabel(game, point.value)} · ${dateLabel(point.ts)}`)}</title></circle>`).join('')}`).join('');

  return `
    <svg class="curve-chart" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="Progression du rang de ${escapeHTML(shown.map(s => seriesLabel(s, allSeries)).join(', '))}">
      ${grid}
      ${paths}
      <text class="curve-axis-date" x="${layout.padding}" y="${height - 10}">${escapeHTML(dateLabel(layout.minTs))}</text>
      <text class="curve-axis-date curve-axis-date-end" x="${width - layout.padding}" y="${height - 10}">${escapeHTML(dateLabel(layout.maxTs))}</text>
    </svg>`;
}

function renderLegend() {
  return allSeries.map(s => {
    const on = visible.has(seriesKey(s));
    return `<button class="curve-legend-item${on ? ' active' : ''}" data-series="${escapeHTML(seriesKey(s))}"
      aria-pressed="${on}" style="--curve-color:${escapeHTML(s.color)}">
      <span class="curve-legend-dot${s.isMain ? '' : ' smurf'}"></span>
      ${escapeHTML(seriesLabel(s, allSeries))}
      ${s.isMain ? '' : '<span class="curve-legend-tag">smurf</span>'}
    </button>`;
  }).join('');
}

function renderPresets() {
  return presets.map(preset => `<button class="curve-preset${preset.id === activePreset ? ' active' : ''}"
    data-preset="${escapeHTML(preset.id)}" aria-pressed="${preset.id === activePreset}">${escapeHTML(preset.label)}</button>`).join('');
}

function render(root, game) {
  if (allSeries.length === 0) {
    root.innerHTML = emptyState('Aucune progression à afficher pour le moment — il faut au moins deux parties classées sur un même compte.');
    return;
  }
  root.innerHTML = `
    <div class="curve-presets" role="group" aria-label="Préréglages">${renderPresets()}</div>
    <div class="curve-chart-wrap">${renderChart(game)}</div>
    <div class="curve-legend" role="group" aria-label="Comptes affichés">${renderLegend()}</div>`;
}

function selectPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  activePreset = id;
  visible = new Set(applyPreset(allSeries, preset));
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
  presets = curvePresets(allSeries);
  // On ouvre sur les comptes principaux : c'est la lecture que l'on vient
  // chercher, les smurfs brouilleraient l'échelle dès l'arrivée.
  activePreset = presets[0]?.id || 'mains';
  selectPreset(activePreset);
  loaded = true;

  render(root, game);

  root.addEventListener('click', event => {
    const presetBtn = event.target.closest('.curve-preset');
    if (presetBtn) {
      selectPreset(presetBtn.dataset.preset);
      render(root, currentGame);
      return;
    }
    const legendBtn = event.target.closest('.curve-legend-item');
    if (!legendBtn) return;
    const key = legendBtn.dataset.series;
    if (visible.has(key)) visible.delete(key);
    else visible.add(key);
    // Un réglage à la main n'est plus un préréglage : ne plus le prétendre.
    activePreset = '';
    render(root, currentGame);
  });
}

// Le mode de jeu peut changer pendant que la page est ouverte : les deux
// historiques vivent dans des nœuds différents et n'ont pas la même échelle.
document.addEventListener('olycity:gamechange', () => {
  if (!document.getElementById('page-courbes')?.classList.contains('active')) return;
  loaded = false;
  initRrCurvePage();
});
