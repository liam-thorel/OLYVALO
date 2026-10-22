import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest, parseSubmission, queueItem, discordContent } from '../workers/livechat/worker.mjs';

const form = fields => {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.set(key, value));
  return data;
};

test('il faut un profil, et un média ou un texte', () => {
  assert.match(parseSubmission(form({ text: 'yo' })).error, /profil/);
  assert.match(parseSubmission(form({ fromName: 'Liam' })).error, /média/);
  assert.equal(parseSubmission(form({ fromName: 'Liam', text: 'yo' })).text, 'yo');
});

test('seuls les images, GIF et vidéos sous la limite passent', () => {
  const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
  assert.match(parseSubmission(form({ fromName: 'Liam', file: pdf })).error, /images/);
  const big = new File([new Uint8Array(2048)], 'a.png', { type: 'image/png' });
  const tooBig = parseSubmission(form({ fromName: 'Liam', file: big }), { maxBytes: 1024 });
  assert.equal(tooBig.status, 413);
  const gif = parseSubmission(form({ fromName: 'Liam', file: new File(['x'], 'a.gif', { type: 'image/gif' }) }));
  assert.equal(gif.kind, 'gif');
});

test('la zone perso, la cible et l’avatar sont nettoyés', () => {
  const parsed = parseSubmission(form({
    fromName: 'Liam', text: 'yo', size: 'custom', box: '{"cx":2,"cy":0.3,"w":0.01}',
    target: 'Nico<script>', fromAvatar: 'https://evil.fr/a.png', durationMs: '999999',
  }));
  assert.deepEqual(parsed.box, { cx: 1, cy: 0.3, w: 0.08, h: 0.52 });
  assert.equal(parsed.target, 'nicoscript');
  assert.equal(parsed.from.avatar, null);
  assert.equal(parsed.durationMs, 30000);
  const item = queueItem(parsed, null, 'm1');
  assert.equal(item.source, 'site');
  assert.equal(item.discordMessageId, 'm1');
  assert.match(discordContent({ ...parsed, targetName: 'Nico' }), /perso · pour Nico/);
});

test('le Worker poste sur Discord puis écrit la file', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://discord.com/')) {
      return Response.json({ id: 'm42', attachments: [{ url: 'https://cdn.discordapp.com/attachments/1/2/a.png', content_type: 'image/png' }] });
    }
    return Response.json({ name: '-Nabc' });
  };
  try {
    const body = form({ fromName: 'Liam', text: 'yo', size: 'grand', file: new File(['x'], 'a.png', { type: 'image/png' }) });
    const request = new Request('https://worker.test/send', { method: 'POST', body, headers: { Origin: 'https://olycity.fr', 'CF-Connecting-IP': '1.2.3.4' } });
    const res = await handleRequest(request, { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc', FIREBASE_ROOT: 'https://fb.test' }, { now: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, id: '-Nabc' });
    assert.match(calls[0].url, /wait=true/);
    const written = JSON.parse(calls[1].init.body);
    assert.equal(calls[1].url, 'https://fb.test/livechat/queue.json');
    assert.equal(written.media.url, 'https://cdn.discordapp.com/attachments/1/2/a.png');
    assert.equal(written.size, 'grand');

    const again = new Request('https://worker.test/send', { method: 'POST', body: form({ fromName: 'Liam', text: 'yo' }), headers: { Origin: 'https://olycity.fr', 'CF-Connecting-IP': '1.2.3.4' } });
    const limited = await handleRequest(again, { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { now: 2 });
    assert.equal(limited.status, 429);

    const foreign = new Request('https://worker.test/send', { method: 'POST', body: form({ fromName: 'X', text: 'spam' }), headers: { Origin: 'https://evil.fr' } });
    assert.equal((await handleRequest(foreign, { DISCORD_WEBHOOK_URL: 'x' })).status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});
