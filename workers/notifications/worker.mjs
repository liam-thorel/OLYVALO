import { dueReminderMinutes, notificationMessage, rankPromotion } from './rules.mjs';

const DEFAULT_FIREBASE = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const ADMIN_TESTERS = new Set(['nico', 'liam']);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers:{ 'Content-Type':'application/json; charset=utf-8', ...headers },
});

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = String(env.SITE_ORIGIN || 'https://liam-thorel.github.io').replace(/\/$/, '');
  const allowed = origin === allowedOrigin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin':allowed ? origin : allowedOrigin,
    'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':'Accept, Content-Type',
    Vary:'Origin',
  };
}

function safeMemberId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
}

function validSubscription(value) {
  return /^https:\/\//.test(value?.endpoint || '')
    && typeof value?.keys?.p256dh === 'string'
    && typeof value?.keys?.auth === 'string';
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function requestBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function subscriptions(env, memberId = '') {
  let cursor;
  const values = [];
  do {
    const page = await env.PUSH_SUBSCRIPTIONS.list({ prefix:'sub:', cursor });
    values.push(...await Promise.all(page.keys.map(key => env.PUSH_SUBSCRIPTIONS.get(key.name, 'json'))));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return values.filter(value => value && (!memberId || value.memberId === memberId));
}

async function sendOne(env, entry, message, fetchImpl = fetch) {
  const { buildPushPayload } = await import('@block65/webcrypto-web-push');
  const payload = await buildPushPayload({
    data:JSON.stringify(message),
    options:{ ttl:300, urgency:'normal' },
  }, entry.subscription, {
    subject:env.VAPID_SUBJECT || 'https://liam-thorel.github.io/OLYVALO/',
    publicKey:env.VAPID_PUBLIC_KEY,
    privateKey:env.VAPID_PRIVATE_KEY,
  });
  const response = await fetchImpl(entry.subscription.endpoint, payload);
  if (response.status === 404 || response.status === 410) {
    await env.PUSH_SUBSCRIPTIONS.delete('sub:' + await digest(entry.subscription.endpoint));
  }
  return response.ok;
}

async function broadcast(env, message, memberId = '') {
  const entries = await subscriptions(env, memberId);
  const results = await Promise.allSettled(entries.map(entry => sendOne(env, entry, message)));
  return results.filter(result => result.status === 'fulfilled' && result.value).length;
}

async function firebaseGet(env, path, query = '') {
  const root = String(env.FIREBASE_ROOT || DEFAULT_FIREBASE).replace(/\/$/, '');
  const response = await fetch(root + '/' + path + '.json' + query, { headers:{ Accept:'application/json' } });
  if (!response.ok) throw new Error('FIREBASE_HTTP_' + response.status);
  return response.json();
}

async function processReminder(env, now) {
  const plan = await firebaseGet(env, 'groupNight/current');
  const reminders = dueReminderMinutes(plan, now);
  let sent = 0;
  for (const reminderMinutes of reminders) {
    const marker = 'sent:session:' + plan.startsAt + ':' + (plan.updatedAt || 0) + ':' + reminderMinutes;
    if (await env.PUSH_SUBSCRIPTIONS.get(marker)) continue;
    sent += await broadcast(env, notificationMessage('reminder', { ...plan, reminderMinutes }));
    await env.PUSH_SUBSCRIPTIONS.put(marker, String(now), { expirationTtl:7 * 86400 });
  }
  return sent;
}

function recentRecords(records = {}, limit = 40) {
  return Object.fromEntries(Object.entries(records || {})
    .sort(([, left], [, right]) => Number(right?.ts || right?.endTs || 0) - Number(left?.ts || left?.endTs || 0))
    .slice(0, limit));
}

async function processRankRecords(env, game, records = {}, notify = true) {
  let sent = 0;
  for (const [id, raw] of Object.entries(records || {})) {
    const candidates = game === 'valorant' ? Object.values(raw?.reports || {}) : [raw];
    for (const record of candidates) {
      const promotion = rankPromotion(game, record);
      if (!promotion) continue;
      const identity = promotion.memberId || await digest(promotion.member);
      const marker = 'sent:rank:' + game + ':' + id + ':' + identity;
      if (await env.PUSH_SUBSCRIPTIONS.get(marker)) continue;
      if (notify) sent += await broadcast(env, notificationMessage('rank', { ...promotion, game, id }));
      await env.PUSH_SUBSCRIPTIONS.put(marker, String(Date.now()), { expirationTtl:365 * 86400 });
    }
  }
  return sent;
}

export async function runScheduled(env, now = Date.now()) {
  const bootstrapped = Boolean(await env.PUSH_SUBSCRIPTIONS.get('rank-bootstrap:v1'));
  const [reminder, valorant, lol] = await Promise.allSettled([
    processReminder(env, now),
    firebaseGet(env, 'historyIndex/valorant').then(records => processRankRecords(env, 'valorant', recentRecords(records), bootstrapped)),
    firebaseGet(env, 'live/lolHistory').then(records => processRankRecords(env, 'lol', recentRecords(records), bootstrapped)),
  ]);
  if (!bootstrapped && valorant.status === 'fulfilled' && lol.status === 'fulfilled') {
    await env.PUSH_SUBSCRIPTIONS.put('rank-bootstrap:v1', String(now));
  }
  return {
    reminder:reminder.status === 'fulfilled' ? reminder.value : 0,
    valorant:valorant.status === 'fulfilled' ? valorant.value : 0,
    lol:lol.status === 'fulfilled' ? lol.value : 0,
  };
}

export async function handleRequest(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:cors });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/config') {
    return json({ publicKey:env.VAPID_PUBLIC_KEY || '' }, 200, cors);
  }
  if (request.method === 'POST' && url.pathname === '/subscriptions') {
    const payload = await requestBody(request);
    const memberId = safeMemberId(payload.memberId);
    if (!memberId || !validSubscription(payload.subscription)) return json({ error:'Abonnement invalide' }, 400, cors);
    const key = 'sub:' + await digest(payload.subscription.endpoint);
    await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({
      memberId,
      name:String(payload.name || memberId).slice(0, 80),
      subscription:payload.subscription,
      userAgent:String(payload.userAgent || '').slice(0, 300),
      updatedAt:Date.now(),
    }));
    return json({ ok:true }, 201, cors);
  }
  if (request.method === 'DELETE' && url.pathname === '/subscriptions') {
    const payload = await requestBody(request);
    const endpoint = String(payload.endpoint || '');
    if (!/^https:\/\//.test(endpoint)) return json({ error:'Abonnement invalide' }, 400, cors);
    await env.PUSH_SUBSCRIPTIONS.delete('sub:' + await digest(endpoint));
    return json({ ok:true }, 200, cors);
  }
  if (request.method === 'POST' && url.pathname === '/notifications/test') {
    const payload = await requestBody(request);
    const memberId = safeMemberId(payload.memberId);
    if (!ADMIN_TESTERS.has(memberId)) return json({ error:'Test réservé à Nico et Liam' }, 403, cors);
    const rateKey = 'test-rate:' + memberId;
    if (await env.PUSH_SUBSCRIPTIONS.get(rateKey)) return json({ error:'Attends quelques secondes avant un nouveau test.' }, 429, cors);
    // Cloudflare KV rejects TTL values below 60 seconds. A shorter value made
    // the test route throw a 500 before the notification was even sent.
    await env.PUSH_SUBSCRIPTIONS.put(rateKey, '1', { expirationTtl:60 });
    const sent = await broadcast(env, {
      title:'OLYCITY',
      body:'✅ Test reçu pour ' + String(payload.name || memberId) + ' · Les rappels sont opérationnels.',
      tag:'test-' + memberId,
      url:'./#admin',
    }, memberId);
    return json({ ok:true, sent }, 200, cors);
  }
  return json({ error:'Not found' }, 404, cors);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('[OLYCITY Push]', error);
      return json({ error:'Service de notifications temporairement indisponible.' }, 500, corsHeaders(request, env));
    }
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
};
