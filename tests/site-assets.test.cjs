const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const workflow = read('.github/workflows/pages.yml');
assert.match(workflow, /cp index\.html overlay\.html \.nojekyll manifest\.webmanifest sw\.js _site\//);
assert.match(workflow, /s\/__OLYCITY_BUILD_ID__\/\$\{GITHUB_SHA\}\/g/);
assert.match(workflow, /NOTIFICATION_ENDPOINT/);

// Le workflow copie explicitement ce qu'il publie : ce qui n'est pas listé
// n'arrive pas en ligne. On extrait cette liste pour la confronter à ce que
// le site charge réellement.
const published = new Set();
for (const m of workflow.matchAll(/^\s*cp (?:-r )?([^\n|>]+?) _site\/?(\S*)$/gm)) {
  m[1].trim().split(/\s+/).forEach(entry => published.add(entry.replace(/^\.\//, '')));
}
// cp live/update-manifest.json _site/live/
for (const m of workflow.matchAll(/^\s*cp ([^\s]+) _site\/(\S+)\/$/gm)) published.add(m[1]);

// ─── Tout ce que le site référence doit être publié ──────────────────────────
const sources = ['index.html', 'overlay.html', ...fs.readdirSync(path.join(root, 'js')).map(f => `js/${f}`)];
const referenced = new Set();
for (const file of sources) {
  const src = read(file);
  for (const m of src.matchAll(/["'`]\.\/([A-Za-z0-9_-]+)\//g)) referenced.add(m[1]);
}

const rootsPublished = new Set([...published].map(p => p.split('/')[0]));
for (const dir of referenced) {
  assert.ok(
    rootsPublished.has(dir),
    `le site charge ./${dir}/ mais le workflow Pages ne le publie pas`,
  );
}

// ─── Cas particulier : le panneau admin lit un fichier précis de live/ ───────
assert.match(read('js/admin.mjs'), /\.\/live\/update-manifest\.json/);
assert.ok(
  published.has('live/update-manifest.json'),
  'le manifeste lu par le panneau admin doit être publié',
);

// ─── Ce qui ne doit surtout PAS être publié ─────────────────────────────────
assert.ok(!published.has('live'), 'tout live/ ne doit pas être publié (ZIP de 34 Mo)');
['discord-bot', 'tests', 'scripts', 'workers'].forEach(dir =>
  assert.ok(!published.has(dir), `${dir}/ n'a rien à faire sur le site public`));

// ─── Plus aucun secret sur le site public ───────────────────────────────────
// La clé HenrikDev était injectée dans _site/config.js au déploiement. Mais
// GitHub Pages sert tout ce qui entre dans _site, et le dépôt est public :
// elle était donc lisible dans les DevTools par n'importe quel visiteur. Une
// clé ramassée, c'est le quota du roster qui saute.
//
// Elle reste désormais dans le secret d'Actions, et c'est sync-stats.yml qui
// s'en sert pour publier dans `rosterStats/` — d'où le site lit sans clé.
assert.doesNotMatch(workflow, /secrets\.HENRIK_API_KEY/,
  'le déploiement du site ne doit plus recevoir la clé');
assert.match(workflow, /! grep -qi 'HENRIK' _site\/config\.js/,
  'et doit échouer si elle y repasse, plutôt que la publier en silence');
// config.js subsiste pour les réglages réellement publics — des URL, pas des
// secrets — et reste généré, jamais commité.
assert.match(workflow, /> _site\/config\.js/, 'config.js doit être généré dans _site, pas dans le dépôt');
assert.match(workflow, /JSON\.stringify/, 'les valeurs doivent être encodées pour ne pas casser le module');

// ─── Le site doit rester déployable même sans clé ───────────────────────────
assert.doesNotMatch(workflow, /exit 1/, 'une clé absente ne doit pas faire échouer le déploiement');

console.log('site-assets: la liste publiée couvre tout ce que le site charge, sans le superflu');
