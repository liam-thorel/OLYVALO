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

import { seriesLabel, seriesKey, plotLayout, seriesPath, seriesAreaPath, ladderLabel, darken, TIME_RANGES } from './rr-curve-utils.mjs?v=20260919-courbes';

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const dateLabel = ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

export function emptyState(message) {
  return `<p class="curve-empty">${escapeHTML(message)}</p>`;
}

// Le cadre est volontairement étroit : étiré sur toute la largeur d'un écran
// de bureau, le tracé s'aplatissait et les variations devenaient illisibles.
// Il est cadré par le CSS, on laisse du vide autour plutôt que de l'étirer.
const CHART_WIDTH = 760;
const CHART_HEIGHT = 300;
const CHART_PADDING = 38;
// Nombre de traits verticaux du quadrillage. Assez pour donner le repère du
// temps, pas assez pour qu'on les compte.
const TIME_GRID_LINES = 6;

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
      <line class="curve-grid-line" shape-rendering="crispEdges" x1="${CHART_PADDING}" x2="${CHART_WIDTH - CHART_PADDING}" y1="${line.y.toFixed(1)}" y2="${line.y.toFixed(1)}"></line>
      <text class="curve-grid-label" x="4" y="${(line.y + 4).toFixed(1)}">${escapeHTML(line.label)}</text>`).join('');

  // Traits verticaux : sans eux le quadrillage n'en est pas un, et rien ne
  // rattache un creux à un moment.
  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const timeGrid = Array.from({ length: TIME_GRID_LINES + 1 }, (_, i) => {
    const x = CHART_PADDING + (innerWidth * i) / TIME_GRID_LINES;
    return `<line class="curve-grid-line" shape-rendering="crispEdges" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${CHART_PADDING}" y2="${(CHART_HEIGHT - CHART_PADDING).toFixed(1)}"></line>`;
  }).join('');

  // Aire sous chaque courbe : même teinte, assombrie, et très transparente.
  // Le dégradé s'efface vers le bas — dix aires opaques empilées noieraient le
  // fond, et c'est la proximité de SA courbe qui doit colorer une bande.
  const gradients = shown.map((serie, index) => `
      <linearGradient id="curve-fill-${index}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${escapeHTML(darken(serie.color))}" stop-opacity="0.30"></stop>
        <stop offset="100%" stop-color="${escapeHTML(darken(serie.color))}" stop-opacity="0"></stop>
      </linearGradient>`).join('');

  const areas = shown.map((serie, index) =>
    `<path class="curve-area" d="${seriesAreaPath(serie, layout)}" fill="url(#curve-fill-${index})"></path>`).join('');

  // Une pastille par partie faisait trois cents disques à l'écran avec dix
  // comptes : la courbe disparaissait sous ses propres points. Seul le dernier
  // est marqué — c'est le rang actuel, la seule valeur qu'on lit vraiment sur
  // un point précis. Le reste se lit comme une ligne.
  const paths = shown.map(s => {
    const last = s.points[s.points.length - 1];
    const titre = escapeHTML(`${seriesLabel(s, allSeries)} — ${ladderLabel(game, last.value)} · ${dateLabel(last.ts)}`);
    return `
      <path class="curve-line" d="${seriesPath(s, layout)}" stroke="${escapeHTML(s.color)}"
            vector-effect="non-scaling-stroke" stroke-dasharray="${s.isMain ? 'none' : '5 4'}"><title>${titre}</title></path>
      <circle class="curve-dot" cx="${layout.x(last.ts).toFixed(1)}" cy="${layout.y(last.value).toFixed(1)}" r="3.2"
          fill="${escapeHTML(s.color)}"><title>${titre}</title></circle>`;
  }).join('');

  return `
    <svg class="curve-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Progression du rang de ${escapeHTML(shown.map(s => seriesLabel(s, allSeries)).join(', '))}">
      <defs>${gradients}</defs>
      ${timeGrid}
      ${grid}
      ${areas}
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

export function renderRanges(activeRange) {
  return TIME_RANGES.map(range => `<button class="curve-range${range.id === activeRange ? ' active' : ''}"
      data-range="${escapeHTML(range.id)}" aria-pressed="${range.id === activeRange}">${escapeHTML(range.label)}</button>`).join('');
}

/**
 * Comptes du roster qu'on ne peut pas tracer.
 *
 * Sans cette liste, un joueur absent du graphique l'est sans explication — et
 * la première hypothèse est que le site a un bug, alors que son script n'a
 * simplement rien publié.
 */
export function renderUntracked(untracked = []) {
  if (untracked.length === 0) return '';
  const noms = untracked.map(entry => escapeHTML(entry.isMain
    ? entry.member
    : `${entry.member} · ${String(entry.account).split('#')[0]}`));
  return `<p class="curve-untracked">Sans courbe : ${noms.join(', ')}.
    Une partie ne porte que le rang du joueur dont son script l’a enregistrée — il en faut deux sur un même compte.</p>`;
}

/** Contenu complet de l'onglet. C'est ce que la page injecte, et ce que l'aperçu affiche. */
export function renderCurvePage({ allSeries = [], visible = new Set(), game = 'valorant', range = 'all', untracked = [] } = {}) {
  if (allSeries.length === 0) {
    return `${emptyState('Aucune progression à afficher pour le moment — il faut au moins deux parties classées sur un même compte.')}${renderUntracked(untracked)}`;
  }
  return `
    <div class="curve-ranges" role="group" aria-label="Plage de temps">${renderRanges(range)}</div>
    <div class="curve-chart-wrap">${renderChart(allSeries, visible, game)}</div>
    <div class="curve-legend" role="group" aria-label="Comptes affichés">${renderLegend(allSeries, visible)}</div>
    ${renderUntracked(untracked)}`;
}
