import assert from 'node:assert/strict';
import {
  parseTimestamp, parseYouTubeRef, validateLineup, mergeLineups, lineupCoverage,
} from '../js/lineup-utils.mjs';

// Un lineup ne stocke aucun contenu : c'est une référence vers une vidéo
// YouTube et un horodatage. Le point de friction, c'est que personne ne va
// lire un ID dans une URL ni convertir « 1m35s » en secondes.

// ─── Horodatages ─────────────────────────────────────────────────────────────
assert.equal(parseTimestamp('95'), 95);
assert.equal(parseTimestamp(95), 95);
assert.equal(parseTimestamp('1m35s'), 95);
assert.equal(parseTimestamp('1h02m03s'), 3723);
assert.equal(parseTimestamp('5m'), 300);
assert.equal(parseTimestamp('90s'), 90);
assert.equal(parseTimestamp('2:35'), 155);
assert.equal(parseTimestamp('1:02:35'), 3755);

// Démarrer au début est un défaut acceptable ; une valeur inventée ne l'est pas.
for (const bad of ['', null, undefined, 'bientôt', '--', {}, 'mm']) {
  assert.equal(parseTimestamp(bad), 0, `entrée non interprétable : ${JSON.stringify(bad)}`);
}

// ─── Toutes les formes d'URL YouTube ─────────────────────────────────────────
const ID = 'czketOpD2p8';
const forms = [
  `https://www.youtube.com/watch?v=${ID}`,
  `https://youtube.com/watch?v=${ID}&list=PLxx`,
  `https://m.youtube.com/watch?v=${ID}`,
  `https://youtu.be/${ID}`,
  `https://www.youtube.com/embed/${ID}`,
  `https://www.youtube.com/shorts/${ID}`,
  `youtube.com/watch?v=${ID}`,            // collé sans le protocole
  `  https://youtu.be/${ID}  `,           // avec des espaces
  ID,                                      // l'ID seul, comme dans le JSON
];
forms.forEach(form => {
  const ref = parseYouTubeRef(form);
  assert.equal(ref?.videoId, ID, `forme non reconnue : ${form}`);
});

// L'horodatage du bouton Partager, sous ses deux écritures.
assert.deepEqual(parseYouTubeRef(`https://youtu.be/${ID}?t=95`), { videoId: ID, start: 95 });
assert.deepEqual(parseYouTubeRef(`https://www.youtube.com/watch?v=${ID}&t=1m35s`), { videoId: ID, start: 95 });
assert.deepEqual(parseYouTubeRef(`https://www.youtube.com/embed/${ID}?start=42`), { videoId: ID, start: 42 });

// Ce qu'on doit refuser plutôt qu'enregistrer un lineup qui n'affichera rien.
for (const bad of [
  '', null, undefined, 'pas une url', 'https://vimeo.com/12345',
  'https://example.com/watch?v=czketOpD2p8',   // bon paramètre, mauvais site
  `https://www.youtube.com/watch?v=trop-court`,
  'https://www.youtube.com/',                   // pas de vidéo
  'https://www.youtube.com/results?search_query=lineup',
]) {
  assert.equal(parseYouTubeRef(bad), null, `aurait dû être refusé : ${JSON.stringify(bad)}`);
}

// ─── Validation ──────────────────────────────────────────────────────────────
const valide = {
  map: 'Abyss', agent: 'Sova', name: 'A Site God Arrow', type: 'ATK', diff: 'Facile',
  video: `https://youtu.be/${ID}?t=95`, desc: 'Révèle tout A Site depuis A Long',
};
const ok = validateLineup(valide);
assert.equal(ok.ok, true);
assert.deepEqual(ok.lineup, {
  name: 'A Site God Arrow', type: 'ATK', diff: 'Facile',
  videoId: ID, start: 95, desc: 'Révèle tout A Site depuis A Long',
}, 'la forme enregistrée est celle que data/lineups.json utilise déjà');
assert.equal(ok.map, 'Abyss');
assert.equal(ok.agent, 'Sova');

// Le rendu insère ces champs dans du HTML : un lineup incomplet casserait la
// carte de la map pour tout le monde, pas seulement pour son auteur.
const champs = ['name', 'video', 'desc', 'type', 'diff', 'map', 'agent'];
champs.forEach(champ => {
  const resultat = validateLineup({ ...valide, [champ]: '' });
  assert.equal(resultat.ok, false, `${champ} vide doit être refusé`);
  assert.ok(resultat.erreurs.length > 0);
});
assert.equal(validateLineup({ ...valide, type: 'atk' }).ok, false, 'la casse du côté compte');
assert.equal(validateLineup({ ...valide, diff: 'Impossible' }).ok, false);
assert.equal(validateLineup({ ...valide, name: 'x'.repeat(81) }).ok, false);
assert.equal(validateLineup({ ...valide, desc: 'x'.repeat(241) }).ok, false);
assert.equal(validateLineup({}).ok, false);
assert.equal(validateLineup().ok, false);
// Plusieurs problèmes à la fois : on les signale tous, pas un par soumission.
assert.ok(validateLineup({}).erreurs.length >= 5);

// ─── Fusion dépôt + ajouts du roster ─────────────────────────────────────────
const base = { Split: { Sova: [{ videoId: 'aaaaaaaaaaa', start: 0, name: 'Livré' }] } };
const ajouts = {
  Split: { Sova: { cle1: { videoId: 'bbbbbbbbbbb', start: 10, name: 'Ajouté' } },
           Viper: { cle2: { videoId: 'ccccccccccc', start: 0, name: 'Autre agent' } } },
  Abyss: { Sova: { cle3: { videoId: 'ddddddddddd', start: 5, name: 'Nouvelle carte' } } },
};
const fusion = mergeLineups(base, ajouts);
assert.deepEqual(fusion.Split.Sova.map(l => l.name), ['Livré', 'Ajouté'],
  'la liste versionnée reste la référence, les ajouts s’empilent après');
assert.equal(fusion.Split.Viper.length, 1, 'un agent absent du dépôt apparaît');
assert.equal(fusion.Abyss.Sova.length, 1, 'une carte absente du dépôt apparaît');

// Deux personnes qui trouvent la même vidéo au même instant : un seul lineup.
const doublon = mergeLineups(
  { Split: { Sova: [{ videoId: 'aaaaaaaaaaa', start: 30 }] } },
  { Split: { Sova: { x: { videoId: 'aaaaaaaaaaa', start: 30 }, y: { videoId: 'aaaaaaaaaaa', start: 31 } } } },
);
assert.equal(doublon.Split.Sova.length, 2, 'même vidéo mais autre instant = autre lineup');

// Une entrée sans vidéo ne doit pas atteindre le rendu.
assert.deepEqual(mergeLineups({}, { Split: { Sova: { x: { name: 'sans vidéo' } } } }), {});

assert.deepEqual(mergeLineups(base, {}), base);
assert.deepEqual(mergeLineups({}, {}), {});
assert.deepEqual(mergeLineups(), {});
assert.deepEqual(mergeLineups(null, null), {});

// ─── Couverture ──────────────────────────────────────────────────────────────
// C'est ce qui doit rendre visibles les cartes vides : trois sur sept
// aujourd'hui, et rien ne le signalait.
const rotation = ['Split', 'Abyss', 'Sunset'];
assert.deepEqual(lineupCoverage(fusion, rotation), [
  { map: 'Split', count: 3 },
  { map: 'Abyss', count: 1 },
  { map: 'Sunset', count: 0 },
]);
assert.deepEqual(lineupCoverage({}, ['Split']), [{ map: 'Split', count: 0 }]);
assert.deepEqual(lineupCoverage(null, []), []);

console.log('lineup-utils: URL YouTube, validation, fusion et couverture validées');
