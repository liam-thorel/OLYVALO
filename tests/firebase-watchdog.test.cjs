/**
 * Flux Firebase (SSE) morts sans erreur : quand le Wi-Fi du serveur se reconnecte, la
 * socket peut rester ouverte dans le vide et EventSource ne se reconnecte jamais. Le
 * chien de garde de watchNode doit rouvrir un flux resté silencieux (sans keep-alive).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const instances = [];
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  emit(type, data) { (this.listeners[type] ?? []).forEach(fn => fn({ data: JSON.stringify(data) })); }
  close() { this.closed = true; }
}

function loadFirebase() {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === 'eventsource') return FakeEventSource;
    if (request === './config.js') return { FIREBASE_URL: 'https://example.firebaseio.test' };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../discord-bot/firebase.js')];
    return require('../discord-bot/firebase.js');
  } finally {
    Module._load = original;
  }
}

test('un flux silencieux plus de 90 s est rouvert, un flux vivant ne l\'est pas', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  instances.length = 0;
  const { watchNode } = loadFirebase();
  const updates = [];
  const errors = [];
  const stop = watchNode('live/sessions', s => updates.push(s), e => errors.push(e.message));

  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, 'https://example.firebaseio.test/live/sessions.json');
  instances[0].emit('put', { path: '/', data: { a: { active: true } } });
  assert.deepEqual(updates.at(-1), { a: { active: true } });

  // Flux vivant : un keep-alive toutes les 30 s pendant 5 min → aucune reconnexion
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(30_000);
    instances[0].emit('keep-alive', null);
  }
  assert.equal(instances.length, 1);
  assert.equal(errors.length, 0);

  // Plus rien pendant 105 s → le chien de garde referme et rouvre le flux
  t.mock.timers.tick(105_000);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].closed, true);
  assert.match(errors[0], /silencieux depuis \d+ s \(live\/sessions\)/);

  // Le nouveau flux renvoie le noeud entier : il remplace l'ancien snapshot
  instances[1].emit('put', { path: '/', data: { b: { active: false } } });
  assert.deepEqual(updates.at(-1), { b: { active: false } });

  // Les modifications partielles s'appliquent sur le nouveau snapshot
  instances[1].emit('patch', { path: '/b', data: { active: true } });
  assert.deepEqual(updates.at(-1), { b: { active: true } });

  stop();
  assert.equal(instances[1].closed, true);
  t.mock.timers.tick(600_000);
  assert.equal(instances.length, 2, 'plus aucune reconnexion après stop()');
});
