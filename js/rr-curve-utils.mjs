/**
 * Courbes de progression — logique pure.
 *
 * Une série par COMPTE et non par joueur : un membre et son smurf n'évoluent
 * pas sur la même échelle, et les fondre donnerait une courbe en dents de scie
 * qui ne décrit la progression de personne.
 *
 * Le rang n'est lisible que si l'axe est continu. On projette donc chaque
 * palier sur une échelle linéaire : Valorant `tier × 100 + RR`, LoL
 * `tier × 400 + division × 100 + LP` (la même que le bot, voir
 * discord-bot/rank-tracking.js).
 */

// Couleur de base par joueur — identique à celle des avatars du site, pour
// qu'un joueur garde sa couleur d'un écran à l'autre.
export const MEMBER_COLORS = {
  Nico: '#ff4656',
  Liam: '#3fcfcf',
  Rayhan: '#f5c842',
  Mathis: '#a87fff',
  Noé: '#ff8200',
};
const FALLBACK_COLOR = '#8992aa';

const VALORANT_RANKS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'];
const LOL_TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_TIER_LABELS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Master', 'Grandmaster', 'Challenger'];
const LOL_DIVISION_SCORE = { IV: 0, III: 1, II: 2, I: 3 };

// ─── Couleurs ────────────────────────────────────────────────────────────────

function hexToHsl(hex) {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
    : max === g ? (b - r) / d + 2
      : (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Couleur d'un compte.
 *
 * La TEINTE ne bouge jamais : c'est elle qui dit « c'est Rayhan ». Seules la
 * clarté et la saturation varient, pour que les smurfs se lisent comme des
 * déclinaisons et non comme d'autres joueurs. Les écarts alternent clair/
 * sombre afin que deux smurfs restent distinguables l'un de l'autre.
 */
export function accountColor(memberName, smurfIndex = 0) {
  const base = MEMBER_COLORS[memberName] || FALLBACK_COLOR;
  if (!smurfIndex) return base;
  const hsl = hexToHsl(base);
  if (!hsl) return base;
  const step = Math.ceil(smurfIndex / 2);
  const lighter = smurfIndex % 2 === 1;
  const l = clamp(hsl.l + (lighter ? 1 : -1) * step * 16, 24, 82);
  const s = clamp(hsl.s - step * 16, 18, 100);
  return `hsl(${Math.round(hsl.h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

// ─── Échelles de rang ────────────────────────────────────────────────────────

/** Valorant : palier 3 = Fer 1, trois paliers par rang, 0–100 RR par palier. */
export function valorantLadderPoint(tier, rr) {
  // `Number(null)` vaut 0 : sans ce garde, un rapport sans RR se tracerait
  // comme une chute à 0 RR dans le palier — un effondrement qui n'a pas eu
  // lieu. L'absence de valeur doit retirer le point, pas en inventer un.
  if (tier === null || tier === undefined || tier === '') return null;
  if (rr === null || rr === undefined || rr === '') return null;
  const tierValue = Number(tier);
  const rrValue = Number(rr);
  if (!Number.isFinite(tierValue) || tierValue < 3) return null;
  if (!Number.isFinite(rrValue) || rrValue < 0) return null;
  return tierValue * 100 + rrValue;
}

export function lolLadderPoint(rank) {
  const index = LOL_TIER_ORDER.indexOf(String(rank?.tier || '').toUpperCase());
  if (index < 0) return null;
  const lp = Number(rank?.lp);
  return index * 400 + (LOL_DIVISION_SCORE[rank?.division] ?? 0) * 100 + (Number.isFinite(lp) ? lp : 0);
}

/** Étiquette lisible d'une valeur de l'échelle, pour l'axe et les infobulles. */
export function ladderLabel(game, value) {
  if (!Number.isFinite(value)) return '';
  if (game === 'lol') {
    const index = clamp(Math.floor(value / 400), 0, LOL_TIER_LABELS.length - 1);
    const rest = value - index * 400;
    const division = ['IV', 'III', 'II', 'I'][clamp(Math.floor(rest / 100), 0, 3)];
    // À partir de Master il n'y a plus de divisions : les afficher tromperait.
    if (index >= 7) return `${LOL_TIER_LABELS[index]} ${Math.round(rest)} LP`;
    return `${LOL_TIER_LABELS[index]} ${division} ${Math.round(rest % 100)} LP`;
  }
  const tier = Math.floor(value / 100);
  const rr = Math.round(value - tier * 100);
  if (tier < 3) return `${rr} RR`;
  const index = tier >= 27 ? 8 : Math.floor((tier - 3) / 3);
  const division = (tier - 3) % 3 + 1;
  const name = VALORANT_RANKS[index] || '';
  return index >= 8 ? `${name} ${rr} RR` : `${name} ${division} · ${rr} RR`;
}

// ─── Séries ──────────────────────────────────────────────────────────────────

const lower = value => String(value || '').trim().toLowerCase();

/**
 * Index compte → membre, avec le rang du compte dans sa liste (0 = principal).
 *
 * roster.json est la seule source qui sépare le compte principal des smurfs
 * (`riot` d'un côté, `smurfs` de l'autre) ; l'ordre de `riotIds` le reflète.
 */
export function accountIndex(members = []) {
  const index = new Map();
  members.forEach(member => {
    (member?.riotIds || []).forEach((riotId, position) => {
      const key = lower(riotId);
      if (!key || index.has(key)) return;
      index.set(key, { member: member.name, account: riotId, smurfIndex: position });
    });
  });
  return index;
}

function sortedPoints(points) {
  return points
    .sort((a, b) => a.ts - b.ts)
    // Deux rapports pour la même partie (reprise du script, double écriture) :
    // un seul point, sinon la courbe fait un aller-retour sur place.
    .filter((point, i, all) => i === 0 || point.ts !== all[i - 1].ts);
}

/**
 * Séries Valorant, une par compte.
 *
 * Seul le rapporteur d'une partie porte SON rang après-match (`report.rr`) —
 * les neuf autres joueurs listés n'ont pas le leur. On lit donc `report.player`
 * et jamais la liste des joueurs, sinon on prêterait à un coéquipier le rang
 * de celui qui a produit le rapport.
 */
export function valorantAccountSeries(historyRoot, members = []) {
  const index = accountIndex(members);
  const byAccount = new Map();

  Object.values(historyRoot || {}).forEach(match => {
    Object.values(match?.reports || {}).forEach(report => {
      if (lower(report?.mode) !== 'competitive') return;
      const value = valorantLadderPoint(report?.rr?.tier, report?.rr?.after);
      if (value === null) return;
      const identity = index.get(lower(report.player));
      if (!identity) return;
      const ts = Number(report.ts || report.endTs || 0);
      if (!ts) return;
      const key = lower(identity.account);
      if (!byAccount.has(key)) byAccount.set(key, { ...identity, points: [] });
      byAccount.get(key).points.push({ ts, value, delta: report.rr?.delta ?? null });
    });
  });

  return finalize(byAccount);
}

/** Séries LoL. Chaque entrée porte déjà le compte (`playerName`) et son rang. */
export function lolAccountSeries(lolHistory, members = []) {
  const index = accountIndex(members);
  const byAccount = new Map();

  Object.values(lolHistory || {}).forEach(entry => {
    const value = lolLadderPoint(entry?.rankAfter);
    if (value === null) return;
    const identity = index.get(lower(entry?.playerName));
    if (!identity) return;
    const ts = Number(entry?.ts || 0);
    if (!ts) return;
    const key = lower(identity.account);
    if (!byAccount.has(key)) byAccount.set(key, { ...identity, points: [] });
    byAccount.get(key).points.push({ ts, value, delta: null });
  });

  return finalize(byAccount);
}

function finalize(byAccount) {
  return [...byAccount.values()]
    .map(series => ({
      ...series,
      isMain: series.smurfIndex === 0,
      color: accountColor(series.member, series.smurfIndex),
      points: sortedPoints(series.points),
    }))
    // Un seul point ne trace pas de courbe : il n'y a encore rien à lire.
    .filter(series => series.points.length >= 2)
    .sort((a, b) => a.member.localeCompare(b.member, 'fr') || a.smurfIndex - b.smurfIndex);
}

/** Étiquette d'une série : le nom seul si le membre n'a qu'un compte tracé. */
export function seriesLabel(series, all = []) {
  const siblings = all.filter(other => other.member === series.member);
  if (siblings.length <= 1) return series.member;
  const short = String(series.account || '').split('#')[0] || series.account;
  return `${series.member} · ${short}`;
}

// ─── Sélection ───────────────────────────────────────────────────────────────

/**
 * Comptes affichés à l'ouverture : les principaux.
 *
 * C'est la lecture que l'on vient chercher ; les smurfs, deux à quatre rangs
 * plus bas, étireraient l'échelle verticale au point d'aplatir les courbes
 * qu'on regarde. La légende permet ensuite de les allumer un par un.
 */
export function defaultVisible(series = []) {
  const mains = series.filter(s => s.isMain);
  // Aucun compte principal tracé (que des smurfs, ou un roster incomplet) :
  // mieux vaut tout montrer qu'un graphique vide.
  return (mains.length ? mains : series).map(seriesKey);
}

export function seriesKey(series) {
  return lower(series?.account);
}

// ─── Mise en page du tracé ───────────────────────────────────────────────────

/**
 * Projette les séries visibles dans la boîte du graphique.
 *
 * L'échelle verticale est commune à toutes les courbes affichées : c'est ce
 * qui permet de comparer deux joueurs d'un coup d'œil. Une marge de 5 % évite
 * qu'une courbe ne colle au bord.
 */
export function plotLayout(visibleSeries = [], { width = 900, height = 320, padding = 36 } = {}) {
  const points = visibleSeries.flatMap(s => s.points);
  if (points.length < 2) return null;

  const times = points.map(p => p.ts);
  const values = points.map(p => p.value);
  const minTs = Math.min(...times);
  const maxTs = Math.max(...times);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 100;
  const minValue = rawMin - span * 0.05;
  const maxValue = rawMax + span * 0.05;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  // Une seule date (tout joué le même jour) : on centre plutôt que de diviser
  // par zéro.
  const x = ts => (maxTs === minTs ? width / 2 : padding + ((ts - minTs) / (maxTs - minTs)) * innerWidth);
  const y = value => padding + (1 - (value - minValue) / (maxValue - minValue)) * innerHeight;

  return { x, y, minTs, maxTs, minValue, maxValue, width, height, padding };
}

export function seriesPath(series, layout) {
  if (!layout || !series?.points?.length) return '';
  return series.points
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${layout.x(point.ts).toFixed(1)},${layout.y(point.value).toFixed(1)}`)
    .join(' ');
}
