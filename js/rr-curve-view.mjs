/**
 * Courbes de progression — rendu.
 *
 * Séparé de la page pour la même raison que overlay-view.mjs l'est de
 * l'overlay : le balisage se teste alors sans navigateur, et l'aperçu de
 * conception affiche EXACTEMENT ce que verra l'utilisateur plutôt qu'une
 * imitation qui dérivera.
 *
 * Aucune dépendance au DOM ici : ces fonctions prennent des données et
 * rendent des chaînes.
 */

import { seriesLabel, seriesKey, plotLayout, seriesPath, ladderLabel } from './rr-curve-utils.mjs?v=20260918-courbes';

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const dateLabel = ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

export function emptyState(message) {
  return `<p class="curve-empty">${escapeHTML(message)}</p>`;
}

const CHART_WIDTH = 900;
const CHART_HEIGHT = 340;
const CHART_PADDING = 44;

/**
 * Graduations horizontales.
 *
 * Les repères tombent sur les paliers de l'échelle et non sur des valeurs
 * réparties uniformément : « Diamant 2 · 40 RR » se lit, « 2 143 » non.
 */
const MAX_GRID_LINES = 8;
// Pas « ronds » de chaque jeu : Valorant compte 100 par palier et 300 par
// rang, LoL 100 par division et 400 par tier. Un pas quelconque placerait les
// repères au milieu des paliers, là où ils ne veulent rien dire.
const GRID_STEPS = { valorant: [100, 300, 600, 900, 1800], lol: [100, 400, 800, 1200, 2400] };

export function gridLines(layout, game) {
  const steps = GRID_STEPS[game] || GRID_STEPS.valorant;
  const span = layout.maxValue - layout.minValue;
  // Le pas doit couvrir TOUT le graphique : à pas fixe, une plage large ne
  // recevait de repères que dans son bas, le reste restant nu.
  const step = steps.find(candidate => span / candidate <= MAX_GRID_LINES) || steps[steps.length - 1];
  const first = Math.ceil(layout.minValue / step) * step;
  const lines = [];
  for (let value = first; value <= layout.maxValue && lines.length < MAX_GRID_LINES; value += step) {
    lines.push({ y: layout.y(value), label: gridLabel(game, value) });
  }
  return lines;
}

/**
 * Un repère tombe par construction sur un début de palier : « Platine 2 · 0 RR »
 * n'apporte rien de plus que « Platine 2 », et encombre une marge étroite. Le
 * « 0 RR » n'est retiré que s'il vaut bien zéro.
 */
function gridLabel(game, value) {
  return ladderLabel(game, value).replace(/(?: ·)? 0 (?:RR|LP)$/, '');
}

export function renderChart(allSeries, visible, game) {
  const shown = allSeries.filter(s => visible.has(seriesKey(s)));
  if (shown.length === 0) return emptyState('Aucun compte sélectionné.');

  const layout = plotLayout(shown, { width: CHART_WIDTH, height: CHART_HEIGHT, padding: CHART_PADDING });
  if (!layout) return emptyState('Pas encore assez de parties classées pour tracer une courbe.');

  const grid = gridLines(layout, game).map(line => `
      <line class="curve-grid-line" x1="${CHART_PADDING}" x2="${CHART_WIDTH - CHART_PADDING}" y1="${line.y.toFixed(1)}" y2="${line.y.toFixed(1)}"></line>
      <text class="curve-grid-label" x="4" y="${(line.y + 4).toFixed(1)}">${escapeHTML(line.label)}</text>`).join('');

  const paths = shown.map(s => `
      <path class="curve-line" d="${seriesPath(s, layout)}" stroke="${escapeHTML(s.color)}"
            stroke-dasharray="${s.isMain ? 'none' : '6 4'}"></path>
      ${s.points.map(point => `<circle class="curve-dot" cx="${layout.x(point.ts).toFixed(1)}" cy="${layout.y(point.value).toFixed(1)}" r="3"
          fill="${escapeHTML(s.color)}"><title>${escapeHTML(`${seriesLabel(s, allSeries)} — ${ladderLabel(game, point.value)} · ${dateLabel(point.ts)}`)}</title></circle>`).join('')}`).join('');

  return `
    <svg class="curve-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img"
         aria-label="Progression du rang de ${escapeHTML(shown.map(s => seriesLabel(s, allSeries)).join(', '))}">
      ${grid}
      ${paths}
      <text class="curve-axis-date" x="${CHART_PADDING}" y="${CHART_HEIGHT - 10}">${escapeHTML(dateLabel(layout.minTs))}</text>
      <text class="curve-axis-date curve-axis-date-end" x="${CHART_WIDTH - CHART_PADDING}" y="${CHART_HEIGHT - 10}">${escapeHTML(dateLabel(layout.maxTs))}</text>
    </svg>`;
}

export function renderLegend(allSeries, visible) {
  return allSeries.map(s => {
    const on = visible.has(seriesKey(s));
    return `<button class="curve-legend-item${on ? ' active' : ''}" data-series="${escapeHTML(seriesKey(s))}"
        aria-pressed="${on}" style="--curve-color:${escapeHTML(s.color)}">
        <span class="curve-legend-dot${s.isMain ? '' : ' smurf'}"></span>
        ${escapeHTML(seriesLabel(s, allSeries))}${s.isMain ? '' : '<span class="curve-legend-tag">smurf</span>'}
      </button>`;
  }).join('');
}

export function renderPresets(presets, activePreset) {
  return presets.map(preset => `<button class="curve-preset${preset.id === activePreset ? ' active' : ''}"
      data-preset="${escapeHTML(preset.id)}" aria-pressed="${preset.id === activePreset}">${escapeHTML(preset.label)}</button>`).join('');
}

/** Contenu complet de l'onglet. C'est ce que la page injecte, et ce que l'aperçu affiche. */
export function renderCurvePage({ allSeries = [], visible = new Set(), presets = [], activePreset = '', game = 'valorant' } = {}) {
  if (allSeries.length === 0) {
    return emptyState('Aucune progression à afficher pour le moment — il faut au moins deux parties classées sur un même compte.');
  }
  return `
    <div class="curve-presets" role="group" aria-label="Préréglages">${renderPresets(presets, activePreset)}</div>
    <div class="curve-chart-wrap">${renderChart(allSeries, visible, game)}</div>
    <div class="curve-legend" role="group" aria-label="Comptes affichés">${renderLegend(allSeries, visible)}</div>`;
}
