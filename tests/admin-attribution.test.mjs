import assert from 'node:assert/strict';
import {
  ROLES, attributionRows, attributionWarnings, deletionPlan,
  isValidPuuid, reassignPlan, riotIdOf, roleOf, overlayKeyFor,
} from '../js/admin-attribution.mjs';

const ROSTER = [
  { name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046', region: 'eu' }, smurfs: [{ name: 'Xi Jinping', tag: '5378' }] },
  { name: 'Noé', riot: { name: 'baby hayabusa', tag: 'NoWaY' } },
];
const PUUID_A = '11111111-2222-3333-4444-555555555555';
const PUUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ─── Validation du puuid ─────────────────────────────────────────────────────
// Un puuid mal saisi rattacherait silencieusement les parties de quelqu'un
// d'autre, ou plus vraisemblablement de personne.
assert.equal(isValidPuuid(PUUID_A), true);
assert.equal(isValidPuuid(PUUID_A.toUpperCase()), true, 'la casse ne compte pas');
assert.equal(isValidPuuid(` ${PUUID_A} `), true, 'les espaces d’un copier-coller sont tolérés');
assert.equal(isValidPuuid('11111111-2222-3333-4444-55555555555'), false, 'un caractère de moins');
assert.equal(isValidPuuid('pas-un-puuid'), false);
assert.equal(isValidPuuid(''), false);
assert.equal(isValidPuuid(null), false);

// ─── Rôle ────────────────────────────────────────────────────────────────────
// Le rôle explicite est celui qu'un humain a choisi : il l'emporte toujours.
assert.equal(roleOf({ role: 'smurf', source: 'roster.json', position: 0 }), 'smurf');
// À défaut, la position dans roster.json, seule source qui sépare riot/smurfs.
assert.equal(roleOf({ source: 'roster.json', position: 0 }), 'main');
assert.equal(roleOf({ source: 'roster.json', position: 2 }), 'smurf');
// Un compte ajouté depuis l'admin sans rôle n'est pas décrété principal.
assert.equal(roleOf({ source: 'rosterOverlay' }), 'unknown');
assert.equal(roleOf({ source: 'rosterOverlay', role: 'MAIN' }), 'main', 'casse ignorée');
assert.equal(roleOf({ source: 'rosterOverlay', role: 'capitaine' }), 'unknown', 'rôle inventé refusé');
assert.deepEqual(ROLES, ['main', 'smurf']);

assert.equal(riotIdOf({ name: 'A', tag: 'B' }), 'A#B');
assert.equal(riotIdOf({ playerName: 'C#D' }), 'C#D', 'playerName fait foi quand il existe');
assert.equal(riotIdOf({ name: 'SansTag' }), 'SansTag');

// ─── Inventaire ──────────────────────────────────────────────────────────────
const rows = attributionRows({
  roster: ROSTER,
  overlay: {
    members: { invite: { name: 'Invité' } },
    accounts: {
      liam: { k1: { name: 'Nouveau', tag: 'OLY', puuid: PUUID_A, role: 'main' } },
      invite: { k2: { name: 'Guest', tag: 'EUW' } },
    },
  },
});
assert.equal(rows.length, 5, 'les deux sources sont inventoriées');

// Un compte du dépôt reste MODIFIABLE : la première modification créera son
// override dans Firebase. Le verrouiller rendait l'écran inutilisable — dix
// des comptes du roster sont déclarés là.
const declare = rows.find(row => row.riotId === 'Wong Chi Ming#2046');
assert.equal(declare.editable, true);
assert.equal(roleOf(declare), 'main');
assert.equal(declare.region, 'eu');
// En revanche on ne peut pas l'EFFACER : le fichier est versionné.
assert.equal(declare.removable, false);
assert.equal(declare.declaredInRepo, true);

const ajoute = rows.find(row => row.riotId === 'Nouveau#OLY');
assert.equal(ajoute.removable, true, 'une entrée purement Firebase s’efface');
assert.equal(ajoute.key, 'k1', 'la clé est gardée : c’est elle qu’on écrira');
assert.equal(ajoute.puuid, PUUID_A);

// Un membre ajouté depuis l'admin est résolu vers un nom lisible.
assert.equal(rows.find(row => row.riotId === 'Guest#EUW').member, 'Invité');
assert.equal(roleOf(rows.find(row => row.riotId === 'Guest#EUW')), 'unknown');

// Une entrée sans pseudo n'est pas un compte.
assert.equal(attributionRows({ overlay: { accounts: { x: { k: { tag: 'OLY' } } } } }).length, 0);
assert.deepEqual(attributionRows({}), []);

// ─── Avertissements ──────────────────────────────────────────────────────────
// Le cas grave : un même compte rattaché à deux personnes.
const deuxMembres = attributionWarnings([
  { member: 'Liam', riotId: 'A#1', puuid: PUUID_A, source: 'rosterOverlay' },
  { member: 'Nico', riotId: 'B#2', puuid: PUUID_A, source: 'rosterOverlay' },
]);
assert.equal(deuxMembres[0].level, 'error');
assert.match(deuxMembres[0].message, /Liam et Nico/);

// Le cas bénin : un renommage, deux entrées pour la même personne.
const memeMembre = attributionWarnings([
  { member: 'Liam', riotId: 'Ancien#1', puuid: PUUID_A, source: 'rosterOverlay' },
  { member: 'Liam', riotId: 'Nouveau#2', puuid: PUUID_A, source: 'rosterOverlay' },
]);
assert.equal(memeMembre[0].level, 'warn');

// Deux comptes principaux pour une même personne : impossible.
const deuxMains = attributionWarnings([
  { member: 'Liam', riotId: 'A#1', role: 'main', source: 'rosterOverlay' },
  { member: 'Liam', riotId: 'B#2', role: 'main', source: 'rosterOverlay' },
]);
assert.ok(deuxMains.some(w => w.level === 'error' && /deux|2 comptes/i.test(w.message)));

// Même Riot ID déclaré des deux côtés.
assert.ok(attributionWarnings([
  { member: 'Liam', riotId: 'A#1', source: 'roster.json' },
  { member: 'Liam', riotId: 'a#1', source: 'rosterOverlay' },
]).some(w => /déclaré 2 fois/.test(w.message)), 'la comparaison ignore la casse');

assert.deepEqual(attributionWarnings([{ member: 'Liam', riotId: 'A#1', puuid: PUUID_A }]), []);

// ─── Un compte déclaré des deux côtés ne fait qu'UNE carte ───────────────────
// C'est le cas normal dès qu'on renseigne un puuid sur un compte du roster.
// Deux cartes pour un seul compte, dont une verrouillée, rendaient l'écran
// impraticable.
const fusion = attributionRows({
  roster: [{ name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046', region: 'eu' } }],
  overlay: { accounts: { liam: { k9: { name: 'Wong Chi Ming', tag: '2046', puuid: PUUID_A, role: 'main' } } } },
});
assert.equal(fusion.length, 1, 'un compte, une carte');
assert.deepEqual(fusion[0].sources, ['roster.json', 'rosterOverlay']);
assert.equal(fusion[0].key, 'k9', 'la clé de l’override est retenue');
assert.equal(fusion[0].puuid, PUUID_A, 'le puuid vient de l’override');
assert.equal(fusion[0].region, 'eu', 'la région du dépôt est conservée à défaut');
assert.equal(fusion[0].editable, true);
assert.equal(fusion[0].removable, false, 'déclaré dans le dépôt : masquable, pas effaçable');

// Deux comptes réellement différents restent deux cartes.
assert.equal(attributionRows({
  roster: [{ name: 'Liam', riot: { name: 'A', tag: '1' } }],
  overlay: { accounts: { liam: { k1: { name: 'B', tag: '2' } } } },
}).length, 2);

// ─── Clé d'override ──────────────────────────────────────────────────────────
// Déterministe : modifier deux fois le même compte réécrit la MÊME entrée.
// Une clé aléatoire fabriquerait les doublons qu'on cherche à supprimer.
assert.equal(overlayKeyFor('Wong Chi Ming#2046'), overlayKeyFor('Wong Chi Ming#2046'));
assert.doesNotMatch(overlayKeyFor('A#1/B.C$D[E]'), /[.#$[\]/]/, 'aucun caractère interdit par Firebase');
assert.notEqual(overlayKeyFor('A#1'), overlayKeyFor('B#2'));

// ─── Suppression ─────────────────────────────────────────────────────────────
const plan = deletionPlan([
  { member: 'Liam', riotId: 'A#1', memberId: 'liam', key: 'k1', removable: true, pendingDeletion: true },
  { member: 'Liam', riotId: 'B#2', memberId: 'liam', key: 'k2', removable: true, pendingDeletion: false },
  // Déclaré dans le dépôt : on ne peut pas l'effacer, on le MASQUE.
  { member: 'Noé', riotId: 'C#3', memberId: 'noe', key: '', removable: false, pendingDeletion: true },
]);
assert.equal(plan.length, 2);
assert.equal(plan[0].action, 'delete');
assert.equal(plan[0].path, 'rosterOverlay/accounts/liam/k1');
assert.equal(plan[1].action, 'hide', 'un compte du dépôt se masque');
assert.equal(plan[1].key, overlayKeyFor('C#3'), 'sous une clé dérivée de son Riot ID');
assert.deepEqual(deletionPlan([]), []);

// ─── Réattribution ───────────────────────────────────────────────────────────
// Firebase n'a pas de « déplacer » : on écrit la nouvelle clé AVANT d'effacer
// l'ancienne. Une coupure entre les deux laisse un doublon visible plutôt
// qu'un compte perdu.
const move = reassignPlan({ editable: true, key: 'k1', memberId: 'liam' }, 'nico');
assert.deepEqual(move, { from: 'rosterOverlay/accounts/liam/k1', to: 'rosterOverlay/accounts/nico/k1' });
assert.equal(reassignPlan({ editable: true, key: 'k1', memberId: 'liam' }, 'liam'), null, 'même membre : rien à faire');
assert.equal(reassignPlan({ editable: false, key: '', memberId: 'liam' }, 'nico'), null, 'roster.json ne bouge pas d’ici');
assert.equal(reassignPlan(null, 'nico'), null);

console.log('admin-attribution: rôles, puuid, avertissements, suppression et réattribution validés');

// ─── Câblage dans l'écran admin ──────────────────────────────────────────────
// Un écran peut être parfaitement écrit et rester sans effet : il suffit qu'un
// seul des points de branchement manque.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'admin.mjs'), 'utf8');

assert.match(admin, /from '\.\/admin-attribution\.mjs/, 'la logique vient du module testé');
assert.match(admin, /<div id="admin-attribution">\$\{renderAttributionHTML\(\)\}<\/div>/, 'la section est rendue');

// ─── Les comptes du dépôt doivent être réglables ─────────────────────────────
// Dix des comptes du roster sont déclarés dans data/roster.json. Les
// verrouiller rendait l'écran inutilisable ; on crée donc un override à la
// première modification, que les lecteurs fusionnent par Riot ID.
assert.match(admin, /async function writablePath\(row\)/);
assert.match(admin, /if \(row\.key\) return `rosterOverlay\/accounts/, 'l’override existant est réutilisé');
assert.match(admin, /const key = overlayKeyFor\(row\.riotId\)/, 'sinon une clé déterministe est dérivée');
// Aucune écriture ne doit court-circuiter cette création : elle échouerait
// silencieusement sur un compte du dépôt, qui n'a pas de clé.
assert.doesNotMatch(admin, /fbPut\(`rosterOverlay\/accounts\/\$\{row\.memberId\}\/\$\{row\.key\}/);
// Et plus aucun contrôle désactivé.
assert.doesNotMatch(admin, /\$\{disabled\}/, 'plus de contrôle verrouillé');

// ─── Masquer plutôt qu'effacer ───────────────────────────────────────────────
// Le fichier roster.json est versionné : l'admin ne peut pas l'en retirer.
assert.match(admin, /if \(entry\.action === 'delete'\) await fbDelete/);
assert.match(admin, /\/hidden`, true\)/, 'le compte est masqué du roster vivant');
// La confirmation dit lequel des deux gestes s'applique à chaque compte.
assert.match(admin, /effacé' : 'masqué du roster'/);
assert.match(admin, /Attribution des comptes/);

// Les cinq actions de la carte doivent être émises ET écoutées.
['set-role', 'toggle-delete', 'purge-marked', 'reassign', 'set-puuid', 'set-region'].forEach(action => {
  assert.ok(admin.includes(`data-action="${action}"`), `${action} doit être émis par le rendu`);
  assert.ok(admin.includes(`'${action}'`) || admin.includes(`data-action="${action}"]`), `${action} doit être écouté`);
});

// Un puuid invalide ne doit JAMAIS être écrit : il rattacherait les parties de
// quelqu'un d'autre, silencieusement.
assert.match(admin, /if \(value && !isValidPuuid\(value\)\)/);
assert.match(admin, /return;[\s\S]{0,80}input\.classList\.remove\('invalid'\)/, 'on sort avant d’écrire');

// La purge passe par le mot de passe admin, comme les autres suppressions.
assert.match(admin, /purge-marked[\s\S]{0,600}confirmWithPassword/);
// Et elle liste ce qu'elle va supprimer : c'est la dernière occasion de voir
// qu'un compte a été marqué par erreur.
assert.match(admin, /confirmWithPassword\([\s\S]{0,200}plan\.map/);

// Le déplacement écrit AVANT d'effacer : une coupure laisse un doublon
// visible, jamais un compte perdu.
const blocReassign = admin.slice(admin.indexOf('select[data-action="reassign"]'));
assert.ok(blocReassign.indexOf('fbPut(plan.to') < blocReassign.indexOf('fbDelete(plan.from'),
  'écrire puis effacer, dans cet ordre');

console.log('admin-attribution: écran branché, puuid validé et purge protégée');

// ─── Le réglage doit avoir un effet ──────────────────────────────────────────
// Un bouton qui n'agit sur rien serait pire que pas de bouton. Un compte
// désigné « principal » dans l'admin doit le devenir partout.
const { buildMembers } = await import('../js/rr-curve-utils.mjs');
const avecRole = buildMembers(
  [{ name: 'Liam', riot: { name: 'Ancien', tag: '0000' } }],
  { accounts: { liam: { k1: { name: 'Nouveau', tag: 'OLY', role: 'main' } } } },
);
assert.equal(avecRole[0].riotIds[0], 'Nouveau#OLY', 'le principal explicite passe en tête');
assert.equal(avecRole[0].riotIds.length, 2, 'sans perdre l’autre compte');

// Sans rôle explicite, roster.json garde la main : on n'invente rien.
const sansRole = buildMembers(
  [{ name: 'Liam', riot: { name: 'Ancien', tag: '0000' } }],
  { accounts: { liam: { k1: { name: 'Nouveau', tag: 'OLY' } } } },
);
assert.equal(sansRole[0].riotIds[0], 'Ancien#0000');

console.log('admin-attribution: le rôle choisi produit bien un effet');

// ─── Récupération du PUUID depuis l'API ──────────────────────────────────────
// La clé HenrikDev est déjà configurée dans l'admin : inutile d'envoyer
// quelqu'un chercher un puuid sur un site tiers et le recopier à la main.
assert.match(admin, /data-action="fetch-puuid"/, 'le bouton est rendu');
assert.match(admin, /fetchAccountIdentity\(name, tag\)/, 'et il interroge l’API');
assert.match(admin, /from '\.\/henrik\.js/);

// Le puuid récupéré est écrit, la région seulement si elle est vide : une
// valeur saisie à la main ne doit pas être écrasée par l'API.
assert.match(admin, /if \(identity\.region && !row\.region\)/);

// Un compte sans tag ne peut pas être interrogé — on le dit plutôt que
// d'envoyer une requête qui échouera.
assert.match(admin, /if \(!name \|\| !tag\)/);

// Chaque échec de l'API doit produire une phrase lisible : un code comme
// « NOT_FOUND » ne dit rien à qui remplit un formulaire.
['NO_API_KEY', 'AUTH_REQUIRED', 'RATE_LIMIT', 'COMPTE_PRIVE', 'NOT_FOUND', 'NETWORK'].forEach(code =>
  assert.ok(admin.includes(`case '${code}'`), `${code} doit être traduit`));
// Le cas le plus déroutant mérite son explication : un compte LoL pur n'existe
// pas côté Valorant.
assert.match(admin, /ne joue qu’à LoL, lance son script/, "le message dit quoi FAIRE, pas seulement ce qui a échoué");

const henrik = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'henrik.js'), 'utf8');
assert.match(henrik, /export async function fetchAccountIdentity/);
assert.match(henrik, /\/v1\/account\/\$\{encodeURIComponent/, 'le Riot ID est encodé : les pseudos contiennent des espaces');

console.log('admin-attribution: récupération du PUUID branchée sur la clé existante');

// ─── Le PUUID appartient au compte Riot, pas au jeu ──────────────────────────
// Le script LoL publie le sien (summoner.puuid) au même titre que le script
// Valorant (entitlements.subject), et le bot les résout depuis un index
// unique. On lit donc ce qui est déjà publié avant d'appeler l'API Valorant —
// qui, elle, ignore les comptes n'ayant jamais joué à Valorant.
const { knownPuuidFor } = await import('../js/admin-attribution.mjs');

assert.equal(
  knownPuuidFor('LoLOnly#EUW', { lolClients: { k: { playerName: 'LoLOnly#EUW', puuid: PUUID_B } } }),
  PUUID_B, 'un compte purement LoL a bien un puuid, publié par son script');

// Les clients Valorant sont indexés PAR puuid : quand la valeur ne le répète
// pas, la clé le porte.
assert.equal(
  knownPuuidFor('Sans#Valeur', { valorantClients: { [PUUID_A]: { playerName: 'Sans#Valeur' } } }),
  PUUID_A, 'le puuid est lu sur la clé à défaut de la valeur');

// Une clé qui n'est pas un puuid ne doit surtout pas être prise pour un.
assert.equal(knownPuuidFor('X#1', { valorantClients: { 'X#1': { playerName: 'X#1' } } }), '');
assert.equal(knownPuuidFor('Inconnu#1', { lolClients: {} }), '');
assert.equal(knownPuuidFor('', {}), '');
assert.equal(knownPuuidFor('A#1', {}), '');

// Un puuid mal formé publié par un script ne doit pas être recopié.
assert.equal(knownPuuidFor('A#1', { lolClients: { k: { playerName: 'A#1', puuid: 'bidon' } } }), '');

assert.match(admin, /knownPuuidFor\(row\.riotId/, 'la source locale est consultée en premier');
assert.match(admin, /const identity = local[\s\S]{0,120}await fetchAccountIdentity/, 'l’API n’est appelée qu’à défaut');

console.log('admin-attribution: le PUUID est celui du compte Riot, LoL compris');

// ─── Le masquage doit produire un effet ──────────────────────────────────────
// Un drapeau que personne ne lit ne masquerait rien.
const masque = buildMembers(
  [{ name: 'Liam', riot: { name: 'Vieux', tag: '0000' }, smurfs: [{ name: 'Actuel', tag: 'OLY' }] }],
  { accounts: { liam: { k1: { name: 'Vieux', tag: '0000', hidden: true } } } },
);
assert.deepEqual(masque[0].riotIds, ['Actuel#OLY'], 'le compte masqué quitte le roster');

// Sans le drapeau, il reste : on ne retire rien sans qu'un humain l'ait demandé.
assert.equal(buildMembers(
  [{ name: 'Liam', riot: { name: 'Vieux', tag: '0000' }, smurfs: [{ name: 'Actuel', tag: 'OLY' }] }],
  { accounts: { liam: { k1: { name: 'Vieux', tag: '0000' } } } },
)[0].riotIds.length, 2);

console.log('admin-attribution: masquage effectif sur les lecteurs de roster');
