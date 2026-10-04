import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { handleRequest as notifications, siteOrigins } from '../workers/notifications/worker.mjs';
import { siteOrigins as catalogOrigins } from '../workers/game-catalog/worker.mjs';

const require = createRequire(import.meta.url);
const { isAllowedUrl, siteUrl } = require('../overlay/lib/url-policy.js');
const { redirectTarget } = require('../live/http-redirect.js');

// Passage du site à olycity.fr. Pendant la transition, l'ancienne adresse
// redirige vers la nouvelle : tout ce qui ne connaît qu'une des deux casse.

test('overlay : le domaine propre est accepté, et lui seul', () => {
  assert.equal(isAllowedUrl('https://olycity.fr/overlay.html'), true);
  assert.equal(isAllowedUrl('https://olycity.fr/#live'), true);
  assert.equal(isAllowedUrl('https://www.olycity.fr/'), true);
  // L'ancienne adresse reste valable : c'est elle qui redirige.
  assert.equal(isAllowedUrl(siteUrl('overlay.html')), true);

  assert.equal(isAllowedUrl('http://olycity.fr/'), false, 'http n’est pas https');
  assert.equal(isAllowedUrl('https://olycity.fr.evil.example/'), false, 'un suffixe n’est pas le domaine');
  assert.equal(isAllowedUrl('https://evil.olycity.fr/'), false, 'pas de sous-domaine arbitraire');
});

test('script : les redirections sont suivies, vers https uniquement', () => {
  const old = 'https://liam-thorel.github.io/OLYVALO/data/roster.json';
  assert.equal(redirectTarget(old, 301, 'https://olycity.fr/data/roster.json'), 'https://olycity.fr/data/roster.json');
  assert.equal(redirectTarget(old, 308, '/OLYVALO/data/roster.json?v=2'),
    'https://liam-thorel.github.io/OLYVALO/data/roster.json?v=2', 'une adresse relative se résout');
  assert.equal(redirectTarget(old, 301, 'http://olycity.fr/data/roster.json'), null, 'jamais en clair');
  assert.equal(redirectTarget(old, 200, 'https://olycity.fr/'), null, 'pas une redirection');
  assert.equal(redirectTarget(old, 302, ''), null);
  assert.equal(redirectTarget(old, 301, 'file:///etc/passwd'), null);
});

test('script : l’assistant d’installation passe par le suivi de redirection', () => {
  const source = readFileSync(new URL('../live/ask-identity.js', import.meta.url), 'utf8');
  const getJson = source.slice(source.indexOf('function getJson'), source.indexOf('function putJson'));
  assert.match(getJson, /redirectTarget\(url, response\.statusCode, response\.headers\.location\)/);
  assert.ok(getJson.indexOf('redirectTarget') < getJson.indexOf('statusCode !== 200'),
    'la redirection est examinée AVANT le refus des codes autres que 200');
  assert.match(getJson, /redirectsLeft > 0/, 'pas de boucle de redirection infinie');
});

test('workers : plusieurs origines autorisées', async () => {
  for (const origins of [siteOrigins, catalogOrigins]) {
    assert.deepEqual(origins({ SITE_ORIGIN: 'https://olycity.fr, https://liam-thorel.github.io/' }),
      ['https://olycity.fr', 'https://liam-thorel.github.io']);
    assert.ok(origins({}).includes('https://olycity.fr'), 'sans réglage, le nouveau domaine passe');
  }

  const env = { SITE_ORIGIN: 'https://olycity.fr,https://liam-thorel.github.io', VAPID_PUBLIC_KEY: 'k', PUSH_SUBSCRIPTIONS: { get: async () => null } };
  for (const origin of ['https://olycity.fr', 'https://liam-thorel.github.io']) {
    const response = await notifications(new Request('https://push.example/config', { headers: { Origin: origin } }), env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin, `${origin} doit être autorisée`);
  }
  const evil = await notifications(new Request('https://push.example/config', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), 'https://olycity.fr', 'une origine inconnue ne se fait pas écho');
});

test('workers : les fichiers de déploiement listent les deux adresses', () => {
  for (const path of ['../workers/notifications/wrangler.toml', '../workers/game-catalog/wrangler.toml']) {
    const toml = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(toml, /SITE_ORIGIN = "[^"]*https:\/\/olycity\.fr[^"]*"/);
    assert.match(toml, /SITE_ORIGIN = "[^"]*https:\/\/liam-thorel\.github\.io[^"]*"/,
      'un onglet resté ouvert sur l’ancienne adresse doit continuer de marcher');
  }
});
