import assert from 'node:assert/strict';
import {
  MEMBER_COLORS, accountColor, valorantLadderPoint, lolLadderPoint, ladderLabel,
  accountIndex, valorantAccountSeries, lolAccountSeries, seriesLabel,
  defaultVisible, seriesKey, plotLayout, seriesPath,
} from '../js/rr-curve-utils.mjs';

const MEMBERS = [
  { name: 'Rayhan', riotIds: ['RayBaz#OLY', 'rbz#3030'] },
  { name: 'Liam', riotIds: ['Wong Chi Ming#2046', 'Xi Jinping#5378'] },
  { name: 'Noé', riotIds: ['baby hayabusa#NoWaY'] },
];

// ─── Couleurs ────────────────────────────────────────────────────────────────
// Le compte principal garde EXACTEMENT la couleur de l'avatar : un joueur doit
// se reconnaître d'un écran à l'autre.
assert.equal(accountColor('Rayhan', 0), MEMBER_COLORS.Rayhan);
assert.equal(accountColor('Liam', 0), MEMBER_COLORS.Liam);

// Les smurfs sont des déclinaisons : même TEINTE, clarté et saturation
// différentes. Changer la teinte en ferait un autre joueur à l'œil.
const teinte = couleur => Number(String(couleur).match(/hsl\((\d+)/)?.[1]);
assert.equal(teinte(accountColor('Rayhan', 1)), teinte(accountColor('Rayhan', 2)), 'même teinte entre smurfs');
assert.notEqual(accountColor('Rayhan', 1), accountColor('Rayhan', 2), 'deux smurfs restent distinguables');
assert.notEqual(accountColor('Rayhan', 1), MEMBER_COLORS.Rayhan);

// Une teinte partagée entre joueurs différents casserait la lecture.
assert.notEqual(teinte(accountColor('Rayhan', 1)), teinte(accountColor('Liam', 1)));

// Un membre hors palette ne doit pas faire planter le rendu.
assert.equal(accountColor('Inconnu', 0), '#8992aa');
assert.ok(accountColor('Inconnu', 1).startsWith('hsl('));

// ─── Échelles ────────────────────────────────────────────────────────────────
assert.equal(valorantLadderPoint(21, 70), 2170);
// Monter d'un palier doit toujours augmenter la valeur, y compris au passage
// de 99 RR à 0 RR du palier suivant — le RR brut seul reculerait.
assert.ok(valorantLadderPoint(22, 0) > valorantLadderPoint(21, 99), 'le passage de palier monte');
assert.equal(valorantLadderPoint(2, 50), null, 'sous Fer 1, aucun rang');
assert.equal(valorantLadderPoint(null, 50), null);
assert.equal(valorantLadderPoint(21, null), null, 'sans RR, pas de point');
assert.equal(valorantLadderPoint(21, -1), null);

assert.equal(lolLadderPoint({ tier: 'DIAMOND', division: 'I', lp: 55 }), 2755);
assert.ok(lolLadderPoint({ tier: 'DIAMOND', division: 'I', lp: 0 })
  > lolLadderPoint({ tier: 'DIAMOND', division: 'II', lp: 99 }), 'la division compte avant le LP');
assert.equal(lolLadderPoint({ tier: 'INCONNU' }), null);
assert.equal(lolLadderPoint(null), null);
// LP absent : le palier reste connu, on ne jette pas le point.
assert.equal(lolLadderPoint({ tier: 'IRON', division: 'IV' }), 0);

assert.equal(ladderLabel('valorant', 2170), 'Ascendant 1 · 70 RR');
assert.equal(ladderLabel('valorant', 300), 'Fer 1 · 0 RR');
assert.equal(ladderLabel('lol', 2755), 'Diamant I 55 LP');
// À partir de Master, LoL n'a plus de divisions : en afficher une serait faux.
assert.match(ladderLabel('lol', 7 * 400 + 250), /^Master 250 LP$/);
assert.equal(ladderLabel('valorant', NaN), '');

// ─── Index des comptes ───────────────────────────────────────────────────────
const index = accountIndex(MEMBERS);
assert.equal(index.get('raybaz#oly').smurfIndex, 0, 'le premier Riot ID est le principal');
assert.equal(index.get('rbz#3030').smurfIndex, 1);
assert.equal(index.get('rbz#3030').member, 'Rayhan');
assert.equal(index.get('inconnu#1'), undefined);

// ─── Séries Valorant ─────────────────────────────────────────────────────────
const report = (player, ts, tier, after, mode = 'competitive') => ({
  player, ts, mode, rr: { tier, after, delta: 20 },
  players: [{ name: player }, { name: 'Wong Chi Ming#2046' }],
});
const historique = {
  m1: { reports: { r1: report('RayBaz#OLY', 1000, 21, 40) } },
  m2: { reports: { r1: report('RayBaz#OLY', 2000, 21, 60) } },
  m3: { reports: { r1: report('rbz#3030', 1500, 9, 30) } },
  m4: { reports: { r1: report('rbz#3030', 2500, 9, 55) } },
  // Hors file classée : n'a pas sa place sur une courbe de rang.
  m5: { reports: { r1: report('RayBaz#OLY', 3000, 21, 80, 'unrated') } },
  // Un compte hors roster ne doit pas créer de série fantôme.
  m6: { reports: { r1: report('Inconnu#404', 3000, 15, 10) } },
};

const series = valorantAccountSeries(historique, MEMBERS);
assert.equal(series.length, 2, 'une série par compte, et seulement pour le roster');

const main = series.find(s => s.account === 'RayBaz#OLY');
assert.equal(main.isMain, true);
assert.equal(main.color, MEMBER_COLORS.Rayhan);
assert.deepEqual(main.points.map(p => p.value), [2140, 2160], 'points triés par date');
assert.equal(main.points.length, 2, 'la partie non classée est écartée');

const smurf = series.find(s => s.account === 'rbz#3030');
assert.equal(smurf.isMain, false);
assert.notEqual(smurf.color, main.color);

// Le rang après-match n'appartient qu'au RAPPORTEUR. Liam figure dans les
// joueurs de chaque partie sans jamais en être l'auteur : lui prêter ces
// points lui donnerait le rang de Rayhan.
assert.equal(series.some(s => s.member === 'Liam'), false, 'seul le rapporteur porte son rang');

// Deux rapports pour la même partie ne doivent pas doubler le point.
const doublon = valorantAccountSeries({
  m1: { reports: { a: report('RayBaz#OLY', 1000, 21, 40), b: report('RayBaz#OLY', 1000, 21, 40) } },
  m2: { reports: { a: report('RayBaz#OLY', 2000, 21, 60) } },
}, MEMBERS);
assert.equal(doublon[0].points.length, 2, 'un rapport dupliqué ne crée pas deux points');

// Un seul point ne trace aucune courbe.
assert.deepEqual(valorantAccountSeries({ m1: { reports: { r: report('RayBaz#OLY', 1, 21, 40) } } }, MEMBERS), []);
assert.deepEqual(valorantAccountSeries(null, MEMBERS), []);
assert.deepEqual(valorantAccountSeries({}, []), []);

// ─── Séries LoL ──────────────────────────────────────────────────────────────
const lol = lolAccountSeries({
  a: { playerName: 'RayBaz#OLY', ts: 100, rankAfter: { tier: 'EMERALD', division: 'II', lp: 40 } },
  b: { playerName: 'RayBaz#OLY', ts: 200, rankAfter: { tier: 'EMERALD', division: 'II', lp: 62 } },
  c: { playerName: 'rbz#3030', ts: 150, rankAfter: { tier: 'SILVER', division: 'I', lp: 10 } },
  d: { playerName: 'rbz#3030', ts: 250, rankAfter: { tier: 'GOLD', division: 'IV', lp: 8 } },
  e: { playerName: 'RayBaz#OLY', ts: 300 }, // sans rang : rien à tracer
}, MEMBERS);
assert.equal(lol.length, 2);
assert.equal(lol.find(s => s.account === 'RayBaz#OLY').points.length, 2);
// Le passage Argent I → Or IV doit MONTER, alors que le LP brut recule (10 → 8).
const montee = lol.find(s => s.account === 'rbz#3030').points;
assert.ok(montee[1].value > montee[0].value, 'monter de tier fait monter la courbe');

// ─── Étiquettes ──────────────────────────────────────────────────────────────
assert.equal(seriesLabel(series[0], series), 'Rayhan · RayBaz');
assert.equal(seriesLabel({ member: 'Noé', account: 'baby hayabusa#NoWaY' }, [{ member: 'Noé' }]), 'Noé',
  'un seul compte tracé : le nom suffit');

// ─── Sélection d'ouverture ───────────────────────────────────────────────────
// Les smurfs, deux à quatre rangs plus bas, étireraient l'échelle verticale au
// point d'aplatir les courbes qu'on vient regarder.
assert.deepEqual(defaultVisible(series), ['raybaz#oly'], 'on ouvre sur les comptes principaux');

// Aucun principal tracé : mieux vaut tout montrer qu'un graphique vide.
const queDesSmurfs = series.filter(s => !s.isMain);
assert.deepEqual(defaultVisible(queDesSmurfs), ['rbz#3030']);
assert.deepEqual(defaultVisible([]), []);

// ─── Tracé ───────────────────────────────────────────────────────────────────
const layout = plotLayout(series, { width: 1000, height: 400, padding: 40 });
assert.ok(layout, 'deux points suffisent à tracer');
assert.equal(Math.round(layout.x(layout.minTs)), 40, 'le premier point touche la marge gauche');
assert.equal(Math.round(layout.x(layout.maxTs)), 960);
// Une valeur haute doit être HAUT sur l'écran : y décroît quand la valeur monte.
assert.ok(layout.y(layout.maxValue) < layout.y(layout.minValue));
// Marge de 5 % : aucune courbe ne colle au bord.
assert.ok(layout.y(2160) > layout.padding, 'le sommet garde de l’air');

const path = seriesPath(main, layout);
assert.match(path, /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
assert.equal(seriesPath(main, null), '');
assert.equal(seriesPath({ points: [] }, layout), '');

// Tout joué le même jour : on centre plutôt que de diviser par zéro.
const plat = plotLayout([{ points: [{ ts: 5, value: 10 }, { ts: 5, value: 20 }] }], { width: 800, height: 300 });
assert.equal(plat.x(5), 400);
assert.ok(Number.isFinite(plat.y(15)));

assert.equal(plotLayout([], {}), null);
assert.equal(plotLayout([{ points: [{ ts: 1, value: 1 }] }], {}), null);

assert.equal(seriesKey({ account: 'RayBaz#OLY' }), 'raybaz#oly');

console.log('rr-curve-utils: séries par compte, couleurs déclinées, échelles de rang et tracé validés');
