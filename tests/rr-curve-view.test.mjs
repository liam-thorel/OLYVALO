import assert from 'node:assert/strict';
import { renderCurvePage, renderChart, renderLegend, renderRanges, renderUntracked, gridLines, escapeHTML } from '../js/rr-curve-view.mjs';
import { valorantAccountSeries, defaultVisible, seriesKey, plotLayout, untrackedAccounts, curveDiagnostics, TIME_RANGES } from '../js/rr-curve-utils.mjs';

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
const mains = new Set(defaultVisible(series));

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
assert.match(chart, /<svg class="curve-chart" viewBox="0 0 760 300"/);
// Un tracé par compte visible, et seulement ceux-là.
assert.equal((chart.match(/class="curve-line"/g) || []).length, 2, 'deux mains visibles');
assert.match(chart, /stroke="#f5c842"/, 'Rayhan garde le jaune de son avatar');
assert.match(chart, /stroke="#3fcfcf"/, 'Liam garde le cyan');
// Le smurf est masqué par le préréglage d'ouverture.
assert.doesNotMatch(chart, /stroke-dasharray="5 4"/, 'aucun smurf tracé au départ');

// Les infobulles nomment le rang, pas la valeur brute de l'échelle. Le nom
// précise le compte parce que Rayhan en a deux de tracés — et il le précise
// que le smurf soit affiché ou non, sinon l'étiquette changerait sous l'œil.
assert.match(chart, /<title>Rayhan · RayBaz — Ascendant 1 · 72 RR/);
assert.doesNotMatch(chart, /<title>[^<]*2172/, 'la valeur interne ne doit pas fuir à l’écran');

// Les points sont des PALIERS : assez peu nombreux pour être tous affichés,
// là où une pastille par partie faisait trois cents disques sous lesquels la
// courbe disparaissait.
const pastilles = (chart.match(/class="curve-dot/g) || []).length;
assert.ok(pastilles >= 2, 'chaque palier est marqué');
// Le dernier point se distingue : c'est le rang actuel.
assert.equal((chart.match(/class="curve-dot last"/g) || []).length, 2, 'un dernier point par compte affiché');
// Un disque de 3 px ne se vise pas à la souris : chaque palier a une cible
// élargie et invisible.
assert.equal((chart.match(/class="curve-hit"/g) || []).length, pastilles, 'une cible par palier');

// Avec les smurfs, le trait devient pointillé.
const tout = renderChart(series, new Set(series.map(seriesKey)), 'valorant');
assert.equal((tout.match(/class="curve-line"/g) || []).length, 3);
assert.match(tout, /stroke-dasharray="5 4"/, 'le smurf se trace en pointillés');

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

// ─── Quadrillage et aires ────────────────────────────────────────────────────
// Un quadrillage sans traits verticaux n'en est pas un : rien ne rattache un
// creux à un moment.
const verticaux = [...chart.matchAll(/<line class="curve-grid-line"[^>]*x1="([\d.]+)"[^>]*x2="([\d.]+)"/g)]
  .filter(m => m[1] === m[2]);
assert.ok(verticaux.length >= 5, 'des traits verticaux, pas seulement des horizontaux');
assert.match(chart, /shape-rendering="crispEdges"/, 'les traits du quadrillage restent nets');
// Le trait de la courbe ne doit pas épaissir quand le SVG est agrandi.
assert.match(chart, /vector-effect="non-scaling-stroke"/);

// Une aire par courbe affichée, chacune avec SON dégradé.
assert.equal((chart.match(/class="curve-area"/g) || []).length, 2, 'une aire par compte affiché');
assert.equal((chart.match(/<linearGradient id="curve-fill-\d+"/g) || []).length, 2);
assert.match(chart, /<path class="curve-area" d="[^"]*Z"/, 'l’aire est un tracé refermé');
// Elle est assombrie et très transparente : elle ne doit pas manger la courbe.
const opacites = [...chart.matchAll(/stop-opacity="([\d.]+)"/g)].map(m => Number(m[1]));
assert.ok(Math.max(...opacites) <= 0.35, 'l’aire reste très transparente');
assert.ok(opacites.includes(0), 'le dégradé s’efface vers le bas');

// ─── Plage de temps ──────────────────────────────────────────────────────────
const plages = renderRanges('30d');
TIME_RANGES.forEach(r => assert.ok(plages.includes(`data-range="${r.id}"`), `plage ${r.id} proposée`));
assert.match(plages, /class="curve-range active"[^>]*data-range="30d"/);
assert.equal((plages.match(/aria-pressed="true"/g) || []).length, 1, 'une seule plage active');

// ─── Comptes sans courbe ─────────────────────────────────────────────────────
// Un joueur absent du graphique l'était sans explication, et la première
// hypothèse est que le site a un bug — alors que son script n'a rien publié.
const rosterLarge = [...MEMBERS, { name: 'Noé', riotIds: ['hayabusa#NoWaY'] }];
const absents = untrackedAccounts(rosterLarge, series, curveDiagnostics({
  a: { reports: { r: report('RayBaz#OLY', 1_000_000, 21, 40) } },
  b: { reports: { r: report('RayBaz#OLY', 2_000_000, 21, 72) } },
}, rosterLarge));
assert.ok(absents.some(a => a.member === 'Noé'), 'Noé n’a aucune partie enregistrée');
const bloc = renderUntracked(absents);
assert.match(bloc, /Comptes sans courbe/);
assert.match(bloc, /Noé/);
// Chaque compte porte SA raison : quatre causes différentes empêchent de
// tracer une courbe, et elles ne se corrigent pas de la même façon.
assert.match(bloc, /<li><strong>Noé<\/strong> — aucune partie trouvée/);
assert.equal((bloc.match(/<li>/g) || []).length, absents.length, 'une ligne par compte absent');
assert.equal(renderUntracked([]), '', 'rien à dire quand tout le monde est tracé');

// ─── Page complète ───────────────────────────────────────────────────────────
const html = renderCurvePage({ allSeries: series, visible: mains, game: 'valorant', range: 'all', untracked: absents });
['curve-chart-wrap', 'curve-legend', 'curve-ranges', 'curve-untracked'].forEach(cls =>
  assert.ok(html.includes(cls), `${cls} doit être rendu`));
// Même sans courbe traçable, la raison de l'absence doit s'afficher.
assert.match(renderCurvePage({ untracked: absents }), /Comptes sans courbe/);
// La rangée de préréglages a été retirée : la légende est le seul réglage.
assert.doesNotMatch(html, /curve-preset/, 'plus aucun préréglage');
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
// Le repère le plus haut doit approcher le peak, pas s'arrêter au tiers.
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

// ─── La bulle dit le rang réel, la pastille le peak ────────────────────────
// Un pic atteint puis reperdu dans la même période est TRACÉ (sinon il
// disparaîtrait du graphique), mais la bulle doit annoncer où le joueur en
// était vraiment à cette date — et nommer le peak, faute de quoi la pastille
// paraîtrait mal placée.
const avecPeak = renderChart([{
  member: 'Liam', account: 'Liam#EUW', smurfIndex: 0, isMain: true, color: '#3fcfcf',
  points: [
    { ts: 1, value: 2000, current: 2000, games: 1 },
    { ts: 2, value: 2400, current: 2150, games: 3 },
    { ts: 3, value: 2160, current: 2160, games: 1 },
  ],
}], new Set(['liam#euw']), 'valorant');

assert.match(avecPeak, /<title>Liam — Ascendant 1 · 50 RR[^<]*· 3 parties · peak Immortel 1 · 0 RR<\/title>/,
  'la bulle donne le rang réel, puis nomme le peak de la période');
assert.doesNotMatch(avecPeak, /<title>Liam — Immortel 1 · 0 RR[^<]*3 parties/,
  'le peak ne doit jamais être annoncé comme le rang du moment');
// Quand les deux coïncident, pas de mention parasite.
assert.match(avecPeak, /<title>Liam — Ascendant 1 · 60 RR · 01 janv\. · 1 partie<\/title>/);

console.log('rr-curve-view: bulle au rang réel, pastille au peak');
