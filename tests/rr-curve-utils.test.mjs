import assert from 'node:assert/strict';
import {
  MEMBER_COLORS, accountColor, valorantLadderPoint, lolLadderPoint, ladderLabel,
  accountIndex, valorantAccountSeries, lolAccountSeries, seriesLabel,
  defaultVisible, seriesKey, plotLayout, seriesPath, curveDiagnostics, untrackedReason,
  buildMembers, puuidIndex,
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

// Un membre hors palette (ajouté depuis l'admin) recevait le MÊME gris que
// tous les autres : deux invités étaient impossibles à distinguer.
const gapTeinte = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const teinteDe = couleur => Number(String(couleur).match(/hsl\(([\d.]+)/)?.[1]);
const invites = [0, 1, 2, 3, 4].map(i => teinteDe(accountColor('Invité', 0, i)));
assert.equal(new Set(invites).size, invites.length, 'cinq invités, cinq teintes');
invites.forEach((teinte, i) => invites.slice(i + 1).forEach(autre =>
  assert.ok(gapTeinte(teinte, autre) >= 25, `teintes trop proches : ${teinte} et ${autre}`)));
// Et aucune ne doit se confondre avec une couleur du roster.
[355, 180, 45, 259, 31].forEach(reservee => invites.forEach(teinte =>
  assert.ok(gapTeinte(teinte, reservee) >= 25, `${teinte} empiète sur une couleur du roster`)));
// Un index hors liste se replie proprement plutôt que de rendre « hsl(undefined) ».
assert.match(accountColor('Invité', 0, 99), /^hsl\(\d+ /);
assert.match(accountColor('Invité', 1, 0), /^hsl\(/, 'le smurf d’un invité reste une déclinaison');

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

// ─── Le rapporteur s'identifie par son puuid, pas par `report.player` ────────
// `report.player` vient de la PRÉSENCE Riot, incomplète selon les files : le
// script la laisse alors vide. S'appuyer dessus faisait disparaître du
// graphique des joueurs ayant des dizaines de parties enregistrées.
const sansPresence = (ts, rr) => ({
  player: '', playerPuuid: 'puuid-rayhan', ts, mode: 'competitive', rr: { tier: 21, after: rr },
  players: [{ name: 'RayBaz#OLY', puuid: 'puuid-rayhan' }, { name: 'Inconnu#404', puuid: 'autre' }],
});
const recupere = valorantAccountSeries({
  m1: { reports: { r: sansPresence(1, 40) } },
  m2: { reports: { r: sansPresence(2, 65) } },
}, MEMBERS);
assert.equal(recupere.length, 1, 'le compte est retrouvé sans la présence Riot');
assert.equal(recupere[0].member, 'Rayhan');
assert.equal(recupere[0].points.length, 2);

// Le rapport d'un COÉQUIPIER ne doit pas donner ses points au membre : seul
// le rapporteur porte son rang après-match.
const rapportDunAutre = {
  player: '', playerPuuid: 'puuid-inconnu', mode: 'competitive', rr: { tier: 21, after: 40 },
  players: [{ name: 'RayBaz#OLY', puuid: 'puuid-rayhan' }, { name: 'Inconnu#404', puuid: 'puuid-inconnu' }],
};
assert.deepEqual(valorantAccountSeries({
  m1: { reports: { r: { ...rapportDunAutre, ts: 1 } } },
  m2: { reports: { r: { ...rapportDunAutre, ts: 2 } } },
}, MEMBERS), [], 'le rang du rapporteur n’est pas prêté à ses coéquipiers');

// ─── Le roster ne tient pas dans roster.json ─────────────────────────────────
// `data/roster.json` ne porte que les comptes déclarés à la main. Les comptes
// ajoutés depuis l'admin, et les puuids de TOUS les comptes, vivent dans
// rosterOverlay. Ne lire que le premier rendait invisible un joueur dont le
// compte courant a été enregistré là — ou qui s'était renommé depuis.
const rosterFichier = [{ name: 'Liam', riot: { name: 'Ancien Nom', tag: '0000' } }];
const overlay = {
  members: { invite: { name: 'Invité' } },
  accounts: {
    liam: { k1: { name: 'Wong Chi Ming', tag: '2046', puuid: 'puuid-liam' } },
    invite: { k1: { name: 'Guest', tag: 'EUW', puuid: 'puuid-invite' } },
  },
};
const fusionnes = buildMembers(rosterFichier, overlay);
const liam = fusionnes.find(m => m.name === 'Liam');
assert.deepEqual(liam.riotIds, ['Ancien Nom#0000', 'Wong Chi Ming#2046'], 'les deux sources sont fusionnées');
assert.deepEqual(liam.puuids, ['puuid-liam'], 'le puuid vient de rosterOverlay');
assert.ok(fusionnes.some(m => m.name === 'Invité'), 'un membre ajouté depuis l’admin existe aussi');
// Un compte déjà déclaré dans roster.json ne doit pas être ajouté deux fois.
assert.equal(buildMembers([{ name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046' } }],
  { accounts: { liam: { k1: { name: 'Wong Chi Ming', tag: '2046' } } } })[0].riotIds.length, 1);
assert.deepEqual(buildMembers(null, null), []);
assert.deepEqual(buildMembers([], {}), []);

// Le puuid est l'identifiant Riot PERMANENT : il retrouve le joueur même quand
// le Riot ID du rapport ne figure nulle part dans le roster.
assert.equal(puuidIndex(fusionnes).get('puuid-liam').member, 'Liam');
const renomme = ts => ({
  playerPuuid: 'puuid-liam', player: 'Encore Un Autre Nom#9999', ts,
  mode: 'competitive', rr: { tier: 21, after: 40 + ts }, players: [],
});
const parPuuid = valorantAccountSeries({ a: { reports: { r: renomme(1) } }, b: { reports: { r: renomme(2) } } }, fusionnes);
assert.equal(parPuuid.length, 1, 'le joueur est retrouvé par son puuid');
assert.equal(parPuuid[0].member, 'Liam');

// Un puuid inconnu du roster ne crée pas de série fantôme.
assert.deepEqual(valorantAccountSeries({
  a: { reports: { r: { ...renomme(1), playerPuuid: 'puuid-inconnu' } } },
  b: { reports: { r: { ...renomme(2), playerPuuid: 'puuid-inconnu' } } },
}, fusionnes), []);

// ─── L'ancienne forme d'historique ───────────────────────────────────────────
// Les parties écrites avant l'introduction du nœud `reports` portent leurs
// champs à plat. Le lecteur d'historique du site les gère déjà ; les courbes
// les ignoraient en silence — soit tout l'historique d'avant ce changement.
const rapportAPlat = ts => ({
  map: 'Ascent', mode: 'competitive', ts, player: 'RayBaz#OLY',
  rr: { tier: 21, after: 30 + ts },
});
const ancienFormat = valorantAccountSeries({ m1: rapportAPlat(1), m2: rapportAPlat(2) }, MEMBERS);
assert.equal(ancienFormat.length, 1, 'une entrée à plat reste un rapport');
assert.equal(ancienFormat[0].points.length, 2);

// Une entrée à plat SANS map n'est pas un rapport : on ne l'invente pas.
assert.deepEqual(valorantAccountSeries({ m1: { ts: 1, rr: { tier: 21, after: 40 } } }, MEMBERS), []);

// ─── Pourquoi un compte n'a pas de courbe ────────────────────────────────────
// Quatre causes, qui ne se corrigent pas de la même façon. Les confondre sous
// « aucune partie » envoie chercher au mauvais endroit.
const diag = (history, membres = MEMBERS) => curveDiagnostics(history, membres);
const cle = 'raybaz#oly';

const sansRang = diag({ m1: { reports: { r: {
  mode: 'competitive', playerPuuid: 'p', ts: 1,
  players: [{ name: 'RayBaz#OLY', puuid: 'p' }],
} } } });
assert.match(untrackedReason(sansRang.get(cle)), /sans le rang de fin de partie/);

const horsClasse = diag({ m1: { reports: { r: {
  mode: 'unrated', playerPuuid: 'p', ts: 1,
  players: [{ name: 'RayBaz#OLY', puuid: 'p' }],
} } } });
assert.match(untrackedReason(horsClasse.get(cle)), /aucune en file classée/);

// Vu dans une partie, mais c'est un AUTRE joueur qui l'a enregistrée : son
// script ne tourne pas, et c'est une panne complètement différente.
const enregistreParUnAutre = diag({ m1: { reports: { r: {
  mode: 'competitive', playerPuuid: 'autre', ts: 1, rr: { tier: 21, after: 40 },
  players: [{ name: 'RayBaz#OLY', puuid: 'p' }, { name: 'X#1', puuid: 'autre' }],
} } } });
assert.match(untrackedReason(enregistreParUnAutre.get(cle)), /enregistrées par un autre joueur/);

const uneSeule = diag({ m1: { reports: { r: {
  mode: 'competitive', playerPuuid: 'p', ts: 1, rr: { tier: 21, after: 40 },
  players: [{ name: 'RayBaz#OLY', puuid: 'p' }],
} } } });
assert.match(untrackedReason(uneSeule.get(cle)), /il en faut deux/);

assert.match(untrackedReason(undefined), /aucune partie trouvée/);

// Un rapport ancien sans `players[]` reste lisible par son champ `player`.
const ancien = ts => ({ player: 'RayBaz#OLY', ts, mode: 'competitive', rr: { tier: 21, after: 50 } });
assert.equal(valorantAccountSeries({ m1: { reports: { r: ancien(1) } }, m2: { reports: { r: ancien(2) } } },
  MEMBERS).length, 1, 'repli sur `player` pour les rapports sans liste de joueurs');

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

// Deux points : un segment droit, il n'y a rien à lisser.
const path = seriesPath(main, layout);
assert.match(path, /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);

// ─── Le lissage ne doit RIEN inventer ────────────────────────────────────────
// Le lissage évident (Catmull-Rom) dépasse : entre deux parties la courbe monte
// au-dessus du point le plus haut. Sur un graphique de rang, ça dessine un
// palier que le joueur n'a jamais atteint.
//
// On échantillonne la VRAIE courbe et non les points de contrôle : ceux-ci
// touchent légitimement la borne de l'interpolation monotone, et les lire
// laisserait croire à un dépassement qui n'existe pas.
function echantillonner(d, pas = 24) {
  const nombres = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const ys = [];
  let from = nombres[0];
  for (let i = 1; i + 2 < nombres.length + 1; i += 3) {
    const [c1, c2, to] = [nombres[i], nombres[i + 1], nombres[i + 2]];
    if (!to) break;
    for (let k = 0; k <= pas; k++) {
      const t = k / pas;
      const u = 1 - t;
      ys.push(u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1]);
    }
    from = to;
  }
  return ys;
}

const pic = [{ ts: 0, value: 100 }, { ts: 1, value: 100 }, { ts: 2, value: 300 },
  { ts: 3, value: 100 }, { ts: 4, value: 100 }];
const piclay = plotLayout([{ points: pic }], { width: 500, height: 300, padding: 0 });
const courbe = seriesPath({ points: pic }, piclay);
assert.match(courbe, /^M[\d.]+,[\d.]+ C/, 'trois points et plus : des cubiques, plus des segments');

// y décroît quand la valeur monte : le minimum d'y est le sommet à l'écran.
// Le chemin SVG arrondit ses coordonnées au dixième de pixel : la tolérance
// couvre cet arrondi, et rien de plus. Un vrai dépassement de lissage se
// compte en pixels, pas en centièmes.
const ARRONDI = 0.06;
const surPic = echantillonner(courbe);
assert.ok(Math.min(...surPic) >= piclay.y(300) - ARRONDI, 'la courbe ne dépasse jamais le sommet réel');
assert.ok(Math.max(...surPic) <= piclay.y(100) + ARRONDI, 'ni ne plonge sous le creux réel');

// Une suite strictement croissante doit le rester : aucun faux recul entre
// deux parties gagnées.
const strictementCroissant = [{ ts: 0, value: 10 }, { ts: 1, value: 20 }, { ts: 2, value: 24 }, { ts: 3, value: 60 }];
const montlay = plotLayout([{ points: strictementCroissant }], { width: 400, height: 200, padding: 0 });
const surMontee = echantillonner(seriesPath({ points: strictementCroissant }, montlay));
surMontee.forEach((y, i) => { if (i) assert.ok(y <= surMontee[i - 1] + ARRONDI, `faux recul à l’échantillon ${i}`); });

// Et le lissage doit vraiment arrondir : sur une montée régulière, la courbe
// s'écarte de la ligne brisée qui reliait les points.
const anguleux = strictementCroissant.map(p => montlay.y(p.value));
assert.ok(Math.max(...surMontee.map((y, i) => Math.abs(y - (anguleux[0] + (anguleux[3] - anguleux[0]) * i / (surMontee.length - 1))))) > 1,
  'la courbe n’est pas une simple droite');

assert.equal(seriesPath({ points: [{ ts: 1, value: 1 }] }, layout),
  `M${layout.x(1).toFixed(1)},${layout.y(1).toFixed(1)}`, 'un point isolé reste un point');

// Tout joué le même jour : on centre plutôt que de diviser par zéro.
const plat = plotLayout([{ points: [{ ts: 5, value: 10 }, { ts: 5, value: 20 }] }], { width: 800, height: 300 });
assert.equal(plat.x(5), 400);
assert.ok(Number.isFinite(plat.y(15)));

assert.equal(plotLayout([], {}), null);
assert.equal(plotLayout([{ points: [{ ts: 1, value: 1 }] }], {}), null);

assert.equal(seriesKey({ account: 'RayBaz#OLY' }), 'raybaz#oly');

console.log('rr-curve-utils: séries par compte, couleurs déclinées, échelles de rang et tracé validés');
