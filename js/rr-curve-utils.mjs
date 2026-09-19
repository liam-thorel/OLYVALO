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
/**
 * Teintes de rechange pour les membres hors palette — quelqu'un ajouté depuis
 * l'admin. Tous recevaient le MÊME gris : deux invités étaient alors
 * impossibles à distinguer, et leurs smurfs aussi.
 *
 * Elles sont attribuées par ORDRE et non par hachage du nom : un hachage ne
 * garantit aucun écart entre deux teintes, et les tentatives de corriger après
 * coup (décaler jusqu'à sortir d'une zone interdite) font converger des noms
 * différents vers la même couleur. Une liste fixe l'écart une fois pour toutes.
 *
 * Chacune est à plus de 25° des cinq du roster et des autres. Au-delà de cinq
 * invités simultanés la liste se répète — on préfère une répétition annoncée à
 * un calcul qui prétend l'éviter.
 */
const EXTRA_HUES = [120, 210, 300, 75, 145];

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
/**
 * Teinte d'un membre absent de la palette — quelqu'un ajouté depuis l'admin.
 *
 * Tous recevaient le MÊME gris : deux invités étaient alors impossibles à
 * distinguer, et leurs smurfs aussi. On dérive donc une teinte stable de leur
 * nom, en évitant celles des cinq du roster.
 */
export function accountColor(memberName, smurfIndex = 0, extraIndex = 0) {
  const known = MEMBER_COLORS[memberName];
  const hue = EXTRA_HUES[((extraIndex % EXTRA_HUES.length) + EXTRA_HUES.length) % EXTRA_HUES.length];
  const hsl = known ? hexToHsl(known) : { h: hue, s: 62, l: 58 };
  if (!smurfIndex) return known || `hsl(${hue} 62% 58%)`;
  if (!hsl) return known;
  const step = Math.ceil(smurfIndex / 2);
  const lighter = smurfIndex % 2 === 1;
  const l = clamp(hsl.l + (lighter ? 1 : -1) * step * 16, 24, 82);
  const s = clamp(hsl.s - step * 16, 18, 100);
  return `hsl(${Math.round(hsl.h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

/**
 * Version assombrie d'une couleur, pour l'aire sous la courbe.
 *
 * Accepte les deux formats que produit accountColor : hexadécimal pour les
 * couleurs du roster, hsl() pour les déclinaisons et les teintes de rechange.
 */
export function darken(color, amount = 0.45) {
  const value = String(color || '');
  const hsl = value.startsWith('hsl') ? parseHsl(value) : hexToHsl(value);
  if (!hsl) return value;
  return `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(clamp(hsl.l * (1 - amount), 6, 100))}%)`;
}

function parseHsl(value) {
  const match = String(value).match(/hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
  return match ? { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) } : null;
}

// ─── Plage de temps ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export const TIME_RANGES = [
  { id: '7d', label: '7 jours', days: 7 },
  { id: '30d', label: '30 jours', days: 30 },
  { id: '90d', label: '3 mois', days: 90 },
  { id: 'all', label: 'Tout', days: null },
];

/**
 * Restreint les séries à une fenêtre de temps.
 *
 * Le point qui PRÉCÈDE la fenêtre est conservé s'il existe : sans lui la
 * courbe commencerait au premier match de la période, et le rang d'entrée
 * dans la fenêtre — d'où le joueur part — serait invisible.
 */
export function withinRange(series = [], rangeId = 'all', now = Date.now()) {
  const range = TIME_RANGES.find(entry => entry.id === rangeId);
  if (!range?.days) return series;
  const since = now - range.days * DAY_MS;

  return series
    .map(entry => {
      const inside = entry.points.filter(point => point.ts >= since);
      if (inside.length === 0) return { ...entry, points: [] };
      const firstIndex = entry.points.indexOf(inside[0]);
      const withAnchor = firstIndex > 0 ? [entry.points[firstIndex - 1], ...inside] : inside;
      return { ...entry, points: withAnchor };
    })
    .filter(entry => entry.points.length >= 2);
}

/**
 * Ce que l'historique contient pour chaque compte du roster.
 *
 * Quatre raisons différentes empêchent de tracer une courbe, et elles ne se
 * corrigent pas de la même façon. Les confondre sous « aucune partie » envoie
 * chercher au mauvais endroit — c'est arrivé.
 */
export function curveDiagnostics(historyRoot, members = []) {
  const index = accountIndex(members);
  const stats = new Map();
  const ensure = key => {
    if (!stats.has(key)) stats.set(key, { seen: 0, reported: 0, reportedRanked: 0, withRank: 0 });
    return stats.get(key);
  };

  Object.values(historyRoot || {}).forEach(match => {
    reportsOf(match).forEach(report => {
      // Vu comme JOUEUR : la partie existe, même si un autre l'a enregistrée.
      (report?.players || []).forEach(player => {
        const known = index.get(lower(player?.name));
        if (known) ensure(lower(known.account)).seen += 1;
      });

      const identity = reporterAccount(report, index);
      if (!identity) return;
      const row = ensure(lower(identity.account));
      row.reported += 1;
      if (lower(report?.mode) !== 'competitive') return;
      row.reportedRanked += 1;
      if (valorantLadderPoint(report?.rr?.tier, report?.rr?.after) !== null) row.withRank += 1;
    });
  });

  return stats;
}

/** Pourquoi ce compte n'a pas de courbe, en une phrase. */
export function untrackedReason(stat) {
  const { seen = 0, reported = 0, reportedRanked = 0, withRank = 0 } = stat || {};
  if (withRank === 1) return 'une seule partie classée avec le rang enregistré — il en faut deux';
  if (reportedRanked > 0) {
    return `${reportedRanked} partie${reportedRanked > 1 ? 's' : ''} classée${reportedRanked > 1 ? 's' : ''} enregistrée${reportedRanked > 1 ? 's' : ''}, mais sans le rang de fin de partie`;
  }
  if (reported > 0) return `${reported} partie${reported > 1 ? 's' : ''} enregistrée${reported > 1 ? 's' : ''}, aucune en file classée`;
  if (seen > 0) return `vu dans ${seen} partie${seen > 1 ? 's' : ''}, toutes enregistrées par un autre joueur — son script n’a rien publié`;
  return 'aucune partie trouvée dans l’historique';
}

/**
 * Comptes du roster dont aucune courbe ne peut être tracée.
 *
 * Un compte n'apparaît que si SON script a publié le rapport de fin de
 * partie : seul le rapporteur porte son rang après-match. Un joueur qui ne
 * fait pas tourner OLYCITY Live est donc absent du graphique sans que rien ne
 * l'explique — d'où cette liste, affichée en légende.
 */
export function untrackedAccounts(members = [], series = [], diagnostics = new Map()) {
  const tracked = new Set(series.map(seriesKey));
  const missing = [];
  members.forEach(member => {
    (member?.riotIds || []).forEach((riotId, position) => {
      const key = lower(riotId);
      if (tracked.has(key)) return;
      missing.push({
        member: member.name, account: riotId, smurfIndex: position, isMain: position === 0,
        reason: untrackedReason(diagnostics.get(key)),
      });
    });
  });
  return missing;
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
 * Rapports d'une entrée d'historique, ANCIENNE FORME COMPRISE.
 *
 * Les entrées écrites avant l'introduction du nœud `reports` portent leurs
 * champs à plat sur la partie elle-même. Le lecteur d'historique du site les
 * gère déjà (js/history-utils.mjs) ; les courbes, non — elles ignoraient donc
 * en silence toutes les parties d'avant ce changement de format.
 */
function reportsOf(match) {
  if (!match || typeof match !== 'object') return [];
  const nested = match.reports && typeof match.reports === 'object' ? Object.values(match.reports) : [];
  if (nested.length) return nested.filter(report => report && typeof report === 'object');
  return match.map ? [match] : [];
}

/**
 * Compte du roster ayant PRODUIT ce rapport.
 *
 * On passe par `players[] + playerPuuid` avant `report.player`, et c'est
 * essentiel : `report.player` vient de la PRÉSENCE Riot, qui est incomplète
 * selon les files (le script le note lui-même) et vaut alors la chaîne vide.
 * Les noms de `players[]`, eux, viennent des détails de fin de partie —
 * autrement dit de l'API, pas d'un statut affiché. S'appuyer sur `player`
 * faisait disparaître du graphique des joueurs qui avaient pourtant des
 * dizaines de parties enregistrées.
 *
 * C'est la même identification que celle des récaps (discord-bot/stats.js),
 * et pour la même raison : seul le rapporteur porte son rang après-match.
 */
function reporterAccount(report, index) {
  const self = (report?.players || []).find(player =>
    player?.puuid && report.playerPuuid && player.puuid === report.playerPuuid);
  return (self && index.get(lower(self.name))) || index.get(lower(report?.player)) || null;
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
    reportsOf(match).forEach(report => {
      if (lower(report?.mode) !== 'competitive') return;
      const value = valorantLadderPoint(report?.rr?.tier, report?.rr?.after);
      if (value === null) return;
      const identity = reporterAccount(report, index);
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
  // Ordre alphabétique des membres hors palette : la couleur d'un invité ne
  // doit pas changer parce qu'un autre a joué une partie de plus.
  const extras = [...new Set([...byAccount.values()]
    .map(series => series.member)
    .filter(member => !(member in MEMBER_COLORS)))].sort((a, b) => a.localeCompare(b, 'fr'));

  return [...byAccount.values()]
    .map(series => ({
      ...series,
      isMain: series.smurfIndex === 0,
      color: accountColor(series.member, series.smurfIndex, extras.indexOf(series.member)),
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

/**
 * Tracé lissé, en cubiques monotones (Fritsch–Carlson).
 *
 * Le lissage évident — Catmull-Rom, ou des tangentes prises sur les voisins —
 * DÉPASSE : entre deux parties la courbe monte au-dessus du point le plus
 * haut avant de redescendre. Sur un graphique de rang, ça dessine un palier
 * que le joueur n'a jamais atteint. C'est un mensonge discret et permanent,
 * exactement le genre que personne ne vient vérifier.
 *
 * L'interpolation monotone borne les tangentes pour que la courbe reste
 * toujours entre les deux points qu'elle relie : elle arrondit les angles
 * sans rien inventer.
 */
/**
 * Aire sous la courbe, refermée sur le bas du cadre.
 *
 * Fermer sur la base plutôt que sur la courbe d'en dessous est délibéré : les
 * courbes se CROISENT, et « la courbe du dessous » change en cours de route.
 * Un dégradé très transparent superpose les aires, ce qui donne les bandes
 * attendues sans jamais se tromper de voisin.
 */
export function seriesAreaPath(series, layout) {
  const line = seriesPath(series, layout);
  const points = series?.points;
  if (!line || !points?.length || points.length < 2) return '';
  const base = layout.height - layout.padding;
  return `${line} L${layout.x(points[points.length - 1].ts).toFixed(1)},${base.toFixed(1)}`
    + ` L${layout.x(points[0].ts).toFixed(1)},${base.toFixed(1)} Z`;
}

export function seriesPath(series, layout) {
  const points = series?.points;
  if (!layout || !points?.length) return '';

  const xs = points.map(point => layout.x(point.ts));
  const ys = points.map(point => layout.y(point.value));
  const start = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  if (points.length === 1) return start;
  if (points.length === 2) return `${start} L${xs[1].toFixed(1)},${ys[1].toFixed(1)}`;

  // Pentes des segments, puis tangente en chaque point.
  const slopes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    slopes.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx);
  }

  const tangents = [slopes[0]];
  for (let i = 1; i < slopes.length; i++) {
    // Changement de sens (un sommet ou un creux) : tangente plate, sinon la
    // courbe dépasserait le point d'inflexion.
    if (slopes[i - 1] * slopes[i] <= 0) { tangents.push(0); continue; }
    const average = (slopes[i - 1] + slopes[i]) / 2;
    const limit = 3 * Math.min(Math.abs(slopes[i - 1]), Math.abs(slopes[i]));
    tangents.push(Math.sign(average) * Math.min(Math.abs(average), limit));
  }
  tangents.push(slopes[slopes.length - 1]);

  let path = start;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    path += ` C${(xs[i] + dx).toFixed(1)},${(ys[i] + tangents[i] * dx).toFixed(1)}`
      + ` ${(xs[i + 1] - dx).toFixed(1)},${(ys[i + 1] - tangents[i + 1] * dx).toFixed(1)}`
      + ` ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return path;
}
