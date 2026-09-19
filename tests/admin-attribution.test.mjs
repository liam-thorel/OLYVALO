import assert from 'node:assert/strict';
import {
  ROLES, attributionRows, attributionWarnings, deletionPlan,
  isValidPuuid, reassignPlan, riotIdOf, roleOf,
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

// roster.json est versionné dans le dépôt : l'admin n'y écrit pas. Le masquer
// donnerait une vue fausse ; le rendre modifiable ferait croire à une
// écriture qui n'arriverait jamais.
const declare = rows.find(row => row.riotId === 'Wong Chi Ming#2046');
assert.equal(declare.editable, false);
assert.equal(roleOf(declare), 'main');
assert.equal(declare.region, 'eu');

const ajoute = rows.find(row => row.riotId === 'Nouveau#OLY');
assert.equal(ajoute.editable, true);
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

// ─── Suppression ─────────────────────────────────────────────────────────────
const plan = deletionPlan([
  { member: 'Liam', riotId: 'A#1', memberId: 'liam', key: 'k1', editable: true, pendingDeletion: true },
  { member: 'Liam', riotId: 'B#2', memberId: 'liam', key: 'k2', editable: true, pendingDeletion: false },
  // Non modifiable : l'admin n'écrit pas dans roster.json, marquer n'y ferait rien.
  { member: 'Noé', riotId: 'C#3', memberId: 'noe', key: '', editable: false, pendingDeletion: true },
]);
assert.equal(plan.length, 1);
assert.equal(plan[0].path, 'rosterOverlay/accounts/liam/k1');
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
assert.match(admin, /exclusivement LoL n’y figure pas/);

const henrik = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'henrik.js'), 'utf8');
assert.match(henrik, /export async function fetchAccountIdentity/);
assert.match(henrik, /\/v1\/account\/\$\{encodeURIComponent/, 'le Riot ID est encodé : les pseudos contiennent des espaces');

console.log('admin-attribution: récupération du PUUID branchée sur la clé existante');
