import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discordContent, discordIdFromAvatar, handleRequest, isValidKey, parseSubmission, planUpload, queueItem, rosterMembers,
} from '../workers/livechat/worker.mjs';

const LIAM = { id: 'liam', name: 'Liam', avatar: 'https://cdn.discordapp.com/avatars/222/abc.png?size=512' };

test('le roster relie un compte Discord à son membre par l’avatar', () => {
  assert.equal(discordIdFromAvatar(LIAM.avatar), '222');
  assert.equal(discordIdFromAvatar('https://example.com/a.png'), null);
  const members = rosterMembers([LIAM], { nouveau: { name: 'Nouveau', avatar: 'https://cdn.discordapp.com/avatars/333/x.png' }, liam: { name: 'Doublon' } });
  assert.deepEqual(members.map(m => [m.id, m.discordId]), [['liam', '222'], ['nouveau', '333']]);
});

test('un envoi exige un membre, et un média ou un texte', () => {
  assert.equal(parseSubmission({ text: 'yo' }).status, 401);
  assert.match(parseSubmission({}, LIAM).error, /média/);
  assert.equal(parseSubmission({ text: 'yo' }, LIAM).from.name, 'Liam');
  assert.match(parseSubmission({ mediaKey: '../secret.png' }, LIAM).error, /introuvable/);
});

test('le nom affiché vient du roster, jamais du navigateur', () => {
  const parsed = parseSubmission({ text: 'yo', fromName: 'Usurpateur', fromAvatar: 'https://evil.fr/a.png' }, LIAM);
  assert.deepEqual(parsed.from, { id: 'liam', name: 'Liam', avatar: LIAM.avatar });
});

test('la zone perso, la cible et la durée sont nettoyées', () => {
  const parsed = parseSubmission({
    text: 'yo', size: 'custom', box: { cx: 2, cy: 0.3, w: 0.01 }, target: 'Nico<script>', durationMs: 999999,
  }, LIAM);
  assert.deepEqual(parsed.box, { cx: 1, cy: 0.3, w: 0.05, h: 0.52 });
  assert.equal(parsed.target, 'nicoscript');
  assert.equal(parsed.durationMs, 30000);
  const item = queueItem(parsed, null, 'm1');
  assert.equal(item.source, 'site');
  assert.equal(item.discordMessageId, 'm1');
  assert.match(discordContent({ ...parsed, targetName: 'Nico' }, 'https://x/m/k.png'), /yo\nhttps:\/\/x\/m\/k\.png\n.*perso · pour Nico/);
});

test('jusqu’à 500 Mo, découpés en morceaux acceptés par un Worker gratuit', () => {
  const plan = planUpload({ type: 'video/mp4', size: 499 * 1024 * 1024 }, 1);
  assert.equal(plan.parts, 10);
  assert.ok(plan.partSize < 100 * 1024 * 1024 && plan.partSize >= 5 * 1024 * 1024);
  assert.ok(isValidKey(plan.key));
  assert.equal(planUpload({ type: 'video/mp4', size: 501 * 1024 * 1024 }).status, 413);
  assert.match(planUpload({ type: 'application/pdf', size: 10 }).error, /Format/);
  assert.ok(!isValidKey('a/b.png'));
  assert.ok(!isValidKey('abcdef.exe'));
});

function fakeEnv() {
  const objects = new Map();
  const uploads = new Map();
  return {
    objects,
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
    FIREBASE_ROOT: 'https://fb.test',
    MEMBERS_URL: 'https://members.test/members.json',
    MEDIA: {
      async createMultipartUpload(key, options) { uploads.set('u1', { key, options, parts: [] }); return { uploadId: 'u1' }; },
      resumeMultipartUpload(key, uploadId) {
        return {
          async uploadPart(partNumber, body) {
            const bytes = new Uint8Array(await new Response(body).arrayBuffer());
            uploads.get(uploadId).parts[partNumber - 1] = bytes;
            return { partNumber, etag: `e${partNumber}` };
          },
          async complete() {
            const upload = uploads.get(uploadId);
            const size = upload.parts.reduce((total, part) => total + part.length, 0);
            objects.set(key, { size, httpMetadata: upload.options.httpMetadata });
            return { size };
          },
        };
      },
      async head(key) { return objects.get(key) || null; },
      async delete(key) { objects.delete(key); },
    },
  };
}

test('envoi complet : connexion vérifiée, morceaux, puis file et Discord', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.endsWith('/users/@me')) {
      return init.headers.Authorization === 'Bearer bon' ? Response.json({ id: '222', avatar: null }) : new Response('', { status: 401 });
    }
    if (target.startsWith('https://members.test/')) return Response.json([LIAM]);
    if (target.includes('rosterOverlay')) return Response.json(null);
    if (target.startsWith('https://discord.com/api/webhooks/')) return Response.json({ id: 'm42' });
    return Response.json({ name: '-Nabc' });
  };
  const env = fakeEnv();
  const headers = (extra = {}) => ({ Origin: 'https://olycity.fr', Authorization: 'Bearer bon', 'CF-Connecting-IP': '1.2.3.4', ...extra });
  let now = 1_000_000;
  const call = async (path, init) => handleRequest(new Request(`https://worker.test${path}`, init), env, { now: now += 5000 });
  try {
    const anonymous = await call('/me', { headers: { Origin: 'https://olycity.fr', Authorization: 'Bearer faux' } });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await (await call('/me', { headers: headers() })).json(), { member: { id: 'liam', name: 'Liam', avatar: LIAM.avatar } });

    const start = await (await call('/upload/start', {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ type: 'image/png', size: 3 }),
    })).json();
    assert.equal(start.parts, 1);
    const part = await (await call(`/upload/part?key=${start.key}&uploadId=${start.uploadId}&part=1`, {
      method: 'PUT', headers: headers(), body: new Uint8Array([1, 2, 3]),
    })).json();
    assert.deepEqual(part, { partNumber: 1, etag: 'e1' });
    const done = await call('/upload/complete', {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ key: start.key, uploadId: start.uploadId, parts: [part] }),
    });
    assert.equal(done.status, 200);

    const sent = await call('/send', {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: 'yo', size: 'grand', mediaKey: start.key, fromName: 'Usurpateur' }),
    });
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { ok: true, id: '-Nabc' });
    const webhook = calls.find(c => c.url.startsWith('https://discord.com/api/webhooks/'));
    assert.equal(JSON.parse(webhook.init.body).username, 'Liam');
    const written = JSON.parse(calls.find(c => c.url === 'https://fb.test/livechat/queue.json').init.body);
    assert.equal(written.media.url, `https://worker.test/m/${start.key}`);
    assert.equal(written.media.kind, 'image');
    assert.equal(written.from.name, 'Liam');
    assert.equal(written.discordMessageId, 'm42');

    const foreign = await call('/send', { method: 'POST', headers: { Origin: 'https://evil.fr', Authorization: 'Bearer bon' }, body: '{}' });
    assert.equal(foreign.status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('un compte Discord hors roster ne peut rien envoyer', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/users/@me')) return Response.json({ id: '999' });
    if (String(url).startsWith('https://members.test/')) return Response.json([LIAM]);
    return Response.json(null);
  };
  try {
    const res = await handleRequest(new Request('https://worker.test/me', {
      headers: { Origin: 'https://olycity.fr', Authorization: 'Bearer inconnu' },
    }), fakeEnv(), { now: 5 });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /roster/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('un extrait vidéo ne part que pour une vidéo, et se lit sur Discord', () => {
  const parsed = parseSubmission({ mediaKey: 'abcdef12.mp4', trim: { startMs: 3200, endMs: 65000 } }, LIAM);
  assert.deepEqual(parsed.trim, { startMs: 3200, endMs: 65000 });
  assert.match(discordContent(parsed, 'https://x/m/abcdef12.mp4'), /extrait 0:03\.2 → 1:05/);
  assert.deepEqual(queueItem(parsed, { url: 'u', kind: 'video' }).trim, { startMs: 3200, endMs: 65000 });
  assert.equal(queueItem(parsed, { url: 'u', kind: 'image' }).trim, undefined);
  assert.equal(parseSubmission({ text: 'yo', trim: { startMs: 5000, endMs: 5100 } }, LIAM).trim, null);
  assert.equal(parseSubmission({ text: 'yo', trim: { startMs: 0, endMs: 2 * 60 * 60 * 1000 } }, LIAM).trim, null);
});
