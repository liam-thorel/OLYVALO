const assert = require('node:assert/strict');
const Module = require('node:module');

const streamUrls = [];

function loadFirebase(secret) {
  const original = Module._load;
  Module._load = function stub(request, parent, isMain) {
    if (request === './config.js') return { FIREBASE_URL: 'https://db.example', FIREBASE_AUTH_SECRET: secret };
    if (request === 'eventsource') {
      return class { constructor(url) { streamUrls.push(String(url)); } addEventListener() {} close() {} };
    }
    return original(request, parent, isMain);
  };
  delete require.cache[require.resolve('../discord-bot/firebase.js')];
  const mod = require('../discord-bot/firebase.js');
  Module._load = original;
  return mod;
}

async function capture(secret, run) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, json: async () => ({}) }; };
  try { await run(loadFirebase(secret)); } finally { global.fetch = originalFetch; }
  return calls;
}

(async () => {
  // ─── Sans secret : comportement strictement identique à avant ─────────────
  const plain = await capture(null, async fb => {
    await fb.fbGet('betting/wallets');
    await fb.fbPut('betting/wallets/1', { balance: 1 });
    await fb.fbPost('discordConfig/trackers', {});
    await fb.fbDelete('discovered/x');
  });
  plain.forEach(call => assert.doesNotMatch(call.url, /auth=/, 'aucun paramètre auth sans secret configuré'));
  assert.equal(plain[0].url, 'https://db.example/betting/wallets.json');
  assert.equal(plain.length, 4);

  // ─── Avec secret : toutes les méthodes le transmettent ────────────────────
  const authed = await capture('s3cr3t/+value', async fb => {
    await fb.fbGet('betting/wallets');
    await fb.fbPut('betting/wallets/1', { balance: 1 });
    await fb.fbPost('discordConfig/trackers', {});
    await fb.fbDelete('discovered/x');
  });
  assert.equal(authed.length, 4);
  authed.forEach(call => assert.match(call.url, /[?]auth=/, `auth manquant sur ${call.url}`));

  // Le secret peut contenir / et + : il doit être encodé, sinon il casse l'URL.
  assert.match(authed[0].url, /auth=s3cr3t%2F%2Bvalue/, 'le secret doit être encodé');

  // Les verbes HTTP ne doivent pas avoir été altérés au passage.
  assert.equal(authed[1].options.method, 'PUT');
  assert.equal(authed[2].options.method, 'POST');
  assert.equal(authed[3].options.method, 'DELETE');

  // ─── Le flux SSE aussi ────────────────────────────────────────────────────
  // watchNode écoute betting/rounds : sans auth sur le flux, le bot cesserait
  // de voir les paris une fois les règles appliquées.
  streamUrls.length = 0;
  loadFirebase('abc').watchNode('betting/rounds', () => {}, () => {});
  assert.equal(streamUrls.length, 1);
  assert.match(streamUrls[0], /^https:\/\/db\.example\/betting\/rounds\.json\?auth=abc$/);

  streamUrls.length = 0;
  loadFirebase(null).watchNode('betting/rounds', () => {}, () => {});
  assert.equal(streamUrls[0], 'https://db.example/betting/rounds.json', 'aucun auth sans secret');

  console.log('firebase-auth: secret optionnel, transmis sur toutes les méthodes, correctement encodé');
})().catch(error => { console.error(error); process.exit(1); });
