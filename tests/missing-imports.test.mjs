import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Appels à une fonction qu'un module N'IMPORTE PAS.
 *
 * `ReferenceError: duplicateLabel is not defined` a tué l'écran admin entier —
 * l'appel est dans le rendu, donc la page ne s'affichait plus du tout. Deux
 * autres manquaient en même temps (`overlayKeyFor`, `adoptionPlan`), sur des
 * chemins moins fréquentés : ils auraient attendu des semaines.
 *
 * C'est la deuxième fois dans la même journée : `fetchAccountIdentity` était
 * passé par le même trou. Le motif est toujours le même — on ajoute un appel à
 * une fonction voisine et on oublie la ligne d'import, ce qu'aucun outil de ce
 * dépôt ne signale, puisqu'il n'y a ni bundler ni typage.
 *
 * L'analyse est volontairement simple : on ne cherche que les identifiants
 * EXPORTÉS par un autre module du dossier `js/`. Un faux positif est donc
 * improbable, et le test reste lisible.
 */

const DIR = new URL('../js/', import.meta.url);
const files = readdirSync(DIR).filter(name => name.endsWith('.mjs') || name.endsWith('.js'));

/**
 * Retire les COMMENTAIRES, et rien d'autre.
 *
 * « voir milestones() » dans un commentaire n'est pas un appel : sans ce
 * nettoyage, le test criait au loup sur de la prose — et un test qui crie pour
 * rien finit ignoré.
 *
 * Les chaînes et les gabarits sont CONSERVÉS, et c'est nécessaire :
 * `${escapeHTML(duplicateLabel(x))}` est un vrai appel, et c'est la forme la
 * plus courante dans les modules de rendu — celle du bug d'origine.
 *
 * Deux tentatives plus ambitieuses ont échoué, et méritent d'être notées pour
 * qu'on ne les refasse pas :
 *
 * - retirer aussi chaînes et gabarits avalait 78 % d'admin.mjs, parce que les
 *   gabarits y sont imbriqués et que leur texte contient des accolades ;
 * - suivre l'état chaîne/gabarit caractère par caractère trébuchait sur les
 *   littéraux d'expression régulière : `/[&<>"']/` ouvre un guillemet qui ne
 *   se referme jamais, et le reste du fichier disparaît.
 *
 * Dans les deux cas le test passait au vert en ne voyant plus rien — l'inverse
 * exact de ce qu'on lui demande. Un retrait de commentaires sans état est
 * moins savant, et il ne ment pas.
 *
 * Le garde-fou `[^:]` évite de prendre le `//` d'une URL pour un commentaire.
 */
function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const sources = new Map(files.map(name => [name, stripNoise(readFileSync(new URL(name, DIR), 'utf8'))]));

// Nom → module qui l'exporte.
const exported = new Map();
sources.forEach((source, name) => {
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)) {
    if (!exported.has(match[1])) exported.set(match[1], name);
  }
});
assert.ok(exported.size > 50, `l’analyse doit voir les exports du dossier, ${exported.size} trouvés`);
assert.ok(exported.has('duplicateLabel'), 'le cas d’origine doit être dans le champ de l’analyse');

function localNames(source) {
  const names = new Set();
  // Importés — nommés, par défaut, ou en espace de noms.
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    match[1].split(',').forEach(part => names.add(part.trim().split(/\s+as\s+/).pop().trim()));
  }
  for (const match of source.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s*(?:,|from)/g)) names.add(match[1]);
  // Définis sur place. Volontairement sans ancre de début de ligne : retirer
  // les gabarits multilignes recolle des lignes entre elles, et une déclaration
  // qui se retrouve en milieu de ligne serait prise pour un import manquant.
  // Manquer un vrai appel non importé coûte moins cher qu'un test qui crie à
  // tort — celui-là, plus personne ne le lit.
  for (const match of source.matchAll(/\bfunction\s*\*?\s*(\w+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\b(?:const|let|var|class)\s+(\w+)/g)) names.add(match[1]);
  // Déstructurés — y compris d'un `await import()` différé, comme le module de
  // notifications push que l'admin ne charge qu'au clic, et y compris dans les
  // paramètres d'un callback : `.then(({ initPushNotifications }) => ...)`.
  for (const match of source.matchAll(/\{([^{}]+)\}\s*(?:=[^=>]|\)\s*=>)/g)) {
    match[1].split(',').forEach(part => names.add(part.trim().split(/[:=]/)[0].trim()));
  }
  // Méthodes abrégées d'un littéral objet : `window.OLYCITY = { async
  // syncAccount(nom) {...} }` définit bien `syncAccount`, appelé plus loin par
  // `window.OLYCITY.syncAccount(...)`.
  for (const match of source.matchAll(/(?:^|[\n,{])\s*(?:async\s+)?(\w+)\s*\([^()]*\)\s*\{/g)) names.add(match[1]);
  // Paramètres de fonction et de callback : `rows => adoptionPlan(rows)` ne
  // doit pas faire passer `rows` pour un import manquant.
  for (const match of source.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    match[1].split(',').forEach(part => {
      const name = part.trim().split(/[:=]/)[0].replace(/^\.\.\./, '').trim();
      if (/^\w+$/.test(name)) names.add(name);
    });
  }
  for (const match of source.matchAll(/(?:^|[^\w.])(\w+)\s*=>/g)) names.add(match[1]);
  return names;
}

const manquants = [];
sources.forEach((source, file) => {
  const known = localNames(source);
  exported.forEach((from, name) => {
    if (from === file || known.has(name)) return;
    // Appelé comme fonction, et pas en tant que propriété (`obj.name(...)`)
    // ni en tant que clé d'objet.
    if (!new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(source)) return;
    manquants.push(`js/${file} appelle ${name}() sans l’importer (exporté par js/${from})`);
  });
});

assert.deepEqual(manquants, [], `Appels sans import :\n${manquants.join('\n')}`);

console.log(`missing-imports: ${sources.size} modules, aucun appel à une fonction non importée`);
