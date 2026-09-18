import assert from 'node:assert/strict';
import { renderCurvePage, renderChart, renderLegend, renderPresets, gridLines, escapeHTML } from '../js/rr-curve-view.mjs';
import { valorantAccountSeries, curvePresets, applyPreset, seriesKey, plotLayout } from '../js/rr-curve-utils.mjs';

const MEMBERS = [
  { name: 'Rayhan', riotIds: ['RayBaz#OLY', 'rbz#3030'] },
  { name: 'Liam', riotIds: ['Wong Chi Ming#2046'] },
];
const report = (player, ts, tier, after) => ({ player, ts, mode: 'competitive', rr: { tier, after } });
const series = valorantAccountSeries({
  a: { reports: { r: report('RayBaz#OLY', 1_000_000, 21, 40) } },
  b: { reports: { r: report('RayBaz#OLY', 2_000_000, 21, 72) } },
  c: { reports: { r: report('rbz#3030', 1_500_000, 9, 30) } },
  d: { reports: { r: report('rbz#3030', 2_500_000, 10, 12) } },
  e: { reports: { r: report('Wong Chi Ming#2046', 1_200_000, 18, 55) } },
  f: { reports: { r: report('Wong Chi Ming#2046', 2_200_000, 19, 22) } },
}, MEMBERS);
const presets = curvePresets(series);
const mains = new Set(applyPreset(series, presets[0]));

// ─── Échappement ─────────────────────────────────────────────────────────────
// Les Riot ID sont choisis par des inconnus et atterrissent dans du HTML
// construit à la main.
assert.equal(escapeHTML('<img onerror=alert(1)>'), '&lt;img onerror=alert(1)&gt;');
assert.equal(escapeHTML('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');

const piege = valorantAccountSeries({
  a: { reports: { r: report('<script>#x', 1000, 21, 40) } },
  b: { reports: { r: report('<script>#x', 2000, 21, 60) } },
}, [{ name: 'Pirate', riotIds: ['<script>#x'] }]);
const dangereux = renderLegend(piege, new Set([seriesKey(piege[0])]));
assert.doesNotMatch(dangereux, /<script>/, 'aucune balise injectée depuis un Riot ID');
assert.match(dangereux, /&lt;script&gt;/);

// ─── Graphique ───────────────────────────────────────────────────────────────
const chart = renderChart(series, mains, 'valorant');
assert.match(chart, /<svg class="curve-chart" viewBox="0 0 900 340"/);
// Un tracé par compte visible, et seulement ceux-là.
assert.equal((chart.match(/class="curve-line"/g) || []).length, 2, 'deux mains visibles');
assert.match(chart, /stroke="#f5c842"/, 'Rayhan garde le jaune de son avatar');
assert.match(chart, /stroke="#3fcfcf"/, 'Liam garde le cyan');
// Le smurf est masqué par le préréglage d'ouverture.
assert.doesNotMatch(chart, /stroke-dasharray="6 4"/, 'aucun smurf tracé au départ');

// Les infobulles nomment le rang, pas la valeur brute de l'échelle. Le nom
// précise le compte parce que Rayhan en a deux de tracés — et il le précise
// que le smurf soit affiché ou non, sinon l'étiquette changerait sous l'œil.
assert.match(chart, /<title>Rayhan · RayBaz — Ascendant 1 · 72 RR/);
assert.doesNotMatch(chart, /<title>[^<]*2172/, 'la valeur interne ne doit pas fuir à l’écran');

// Avec les smurfs, le trait devient pointillé.
const tout = renderChart(series, new Set(series.map(seriesKey)), 'valorant');
assert.equal((tout.match(/class="curve-line"/g) || []).length, 3);
assert.match(tout, /stroke-dasharray="6 4"/, 'le smurf se trace en pointillés');

assert.match(renderChart(series, new Set(), 'valorant'), /Aucun compte sélectionné/);

// ─── Graduations ─────────────────────────────────────────────────────────────
const layout = plotLayout(series.filter(s => mains.has(seriesKey(s))), { width: 900, height: 340, padding: 44 });
const grid = gridLines(layout, 'valorant');
assert.ok(grid.length >= 2 && grid.length <= 8, 'assez de repères, sans saturer');
grid.forEach(line => assert.match(line.label, /^[A-ZÉ][a-zé]+ \d$/, 'un repère se lit « Diamant 2 », pas « 2143 »'));

// ─── Légende ─────────────────────────────────────────────────────────────────
const legend = renderLegend(series, mains);
assert.match(legend, /curve-legend-item active[^>]*>\s*<span class="curve-legend-dot">/, 'un main visible : pastille pleine');
assert.match(legend, /curve-legend-dot smurf/, 'le smurf a la pastille en anneau');
assert.match(legend, /curve-legend-tag">smurf</);
// Un compte masqué reste dans la légende : il doit pouvoir être rallumé.
assert.match(legend, /class="curve-legend-item"[^>]*aria-pressed="false"/);
assert.match(legend, /--curve-color:#f5c842/);
// Rayhan a deux comptes tracés : son nom seul ne suffirait plus à les séparer.
assert.match(legend, /Rayhan · RayBaz/);
assert.match(legend, /Rayhan · rbz/);
assert.ok(legend.includes('Liam'), 'Liam figure dans la légende');
assert.doesNotMatch(legend, /Liam · /, 'un seul compte : aucune précision à ajouter');

// ─── Préréglages ─────────────────────────────────────────────────────────────
const chips = renderPresets(presets, 'mains');
assert.match(chips, /class="curve-preset active"[^>]*data-preset="mains"/);
assert.match(chips, /Tous les comptes de Rayhan/);
assert.doesNotMatch(chips, /Tous les comptes de Liam/, 'Liam n’a pas de smurf : rien à proposer');

// ─── Page complète ───────────────────────────────────────────────────────────
const html = renderCurvePage({ allSeries: series, visible: mains, presets, activePreset: 'mains', game: 'valorant' });
['curve-presets', 'curve-chart-wrap', 'curve-legend'].forEach(cls =>
  assert.ok(html.includes(cls), `${cls} doit être rendu`));
assert.match(renderCurvePage({}), /Aucune progression à afficher/);

console.log('rr-curve-view: balisage, couleurs, pointillés des smurfs et échappement validés');

// ─── La grille doit couvrir tout le graphique ────────────────────────────────
// À pas fixe, une plage large ne recevait de repères que dans son bas : avec
// dix comptes du Fer à l'Ascendant, les deux tiers du cadre restaient nus.
const large = plotLayout([{ points: [{ ts: 1, value: 600 }, { ts: 2, value: 2200 }] }],
  { width: 900, height: 340, padding: 44 });
const grilleLarge = gridLines(large, 'valorant');
assert.ok(grilleLarge.length >= 4, 'assez de repères sur une plage large');
assert.ok(grilleLarge.length <= 8, 'jamais plus de huit');
// Le repère le plus haut doit approcher le sommet, pas s'arrêter au tiers.
const plusHaut = Math.min(...grilleLarge.map(l => l.y));
assert.ok(plusHaut < large.y(large.minValue + (large.maxValue - large.minValue) * 0.75),
  'la grille monte jusqu’en haut du cadre');

// Les repères tombent sur des paliers ronds, jamais au milieu de nulle part.
// Un repère tombe par construction sur un début de palier : le « 0 RR » qui
// suivait n'apportait rien et encombrait une marge étroite.
grilleLarge.forEach(line => assert.doesNotMatch(line.label, /0 RR/, 'pas de « 0 RR » parasite'));
assert.match(grilleLarge[0].label, /^(Fer|Bronze|Argent|Or|Platine|Diamant|Ascendant|Immortel) \d$/);
const grilleLol = gridLines(plotLayout([{ points: [{ ts: 1, value: 400 }, { ts: 2, value: 3200 }] }], { width: 900, height: 340 }), 'lol');
// À partir de Master, LoL n'a plus de divisions : « Master IV » serait faux.
grilleLol.forEach(line => assert.match(line.label, /^[A-ZÉ][a-zé]+(?: (?:IV|III|II|I))?$/, `repère LoL inattendu : ${line.label}`));
assert.ok(grilleLol.some(line => line.label === 'Diamant IV'), 'sous Master, la division est affichée');
assert.ok(grilleLol.some(line => line.label === 'Master'), 'au-dessus, elle disparaît');

console.log('rr-curve-view: grille adaptée à l’amplitude affichée');
