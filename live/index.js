/**
 * OLYCITY LIVE v3 — Valorant Local API (lockfile method)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

// Lockfile locations
const LOCKFILE_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'Riot Games', 'Riot Client', 'Config', 'lockfile'),
  path.join(process.env.APPDATA     || '', '..', 'Local', 'Riot Games', 'Riot Client', 'Config', 'lockfile'),
  'C:\\Riot Games\\Riot Client\\Config\\lockfile',
];

const GAME_LOCKFILE_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log'),
];

function ts() { return new Date().toLocaleTimeString('fr-FR'); }

// ─── Read lockfile ─────────────────────────────────────
function readLockfile() {
  for (const p of LOCKFILE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8').trim();
        const [name, pid, port, password, protocol] = content.split(':');
        return { port: parseInt(port), password, protocol };
      }
    } catch {}
  }
  return null;
}

// ─── HTTPS with auth ───────────────────────────────────
function getWithAuth(port, password, endpoint) {
  const auth = Buffer.from(`riot:${password}`).toString('base64');
  const agent = new https.Agent({ rejectUnauthorized: false });
  return new Promise(resolve => {
    const req = https.get({
      hostname: '127.0.0.1',
      port,
      path: endpoint,
      agent,
      timeout: 2000,
      headers: { Authorization: `Basic ${auth}` }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: true, status: res.statusCode, raw: data.slice(0,200) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

// ─── Firebase ──────────────────────────────────────────
function putFirebase(path, data) {
  const body = JSON.stringify(data);
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
      path: `/${path}.json`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(body); req.end();
  });
}

// ─── Main ──────────────────────────────────────────────
let tries = 0;
let lastPort = null;
let inGame = false;

async function poll() {
  // 1. Find lockfile
  const lock = readLockfile();
  if (!lock) {
    tries++;
    if (tries % 10 === 1) {
      console.log(`[${ts()}] ⏳ Lockfile introuvable — Riot Client pas lancé ?`);
      console.log('         Chemins cherchés:');
      LOCKFILE_PATHS.forEach(p => console.log(`         · ${p}`));
    }
    return;
  }

  if (lock.port !== lastPort) {
    lastPort = lock.port;
    console.log(`[${ts()}] ✅ Riot Client détecté — port ${lock.port}`);
  }

  // 2. Check if in game via presence
  const presence = await getWithAuth(lock.port, lock.password, '/chat/v4/presences');
  if (!presence.ok) {
    tries++;
    if (tries % 10 === 1) console.log(`[${ts()}] ⚠️  Presence API: ${presence.err}`);
    return;
  }

  tries = 0;

  // 3. Find current player's presence
  const presences = presence.data?.presences || [];
  const me = presences.find(p => p.puuid && p.private);

  if (!me) {
    if (inGame) console.log(`[${ts()}] 🏠 Retour au lobby`);
    inGame = false;
    await putFirebase('live', { active: false, ts: Date.now() });
    return;
  }

  // Decode private data (base64 JSON)
  let privateData = {};
  try {
    privateData = JSON.parse(Buffer.from(me.private, 'base64').toString());
  } catch {}

  const sessionState = privateData.sessionLoopState || '';
  console.log(`[${ts()}] 📍 État: ${sessionState} | ${JSON.stringify(privateData).slice(0,100)}`);

  if (sessionState !== 'INGAME') {
    if (inGame) console.log(`[${ts()}] 🏠 Plus en game (${sessionState})`);
    inGame = false;
    await putFirebase('live', { active: false, ts: Date.now() });
    return;
  }

  if (!inGame) {
    inGame = true;
    console.log(`[${ts()}] 🎮 EN GAME ! Map: ${privateData.matchMap || '?'}`);
  }

  // 4. Get match details
  const currentMatch = privateData.matchMap || '';
  await putFirebase('live', {
    active: true,
    ts: Date.now(),
    map: currentMatch,
    mapClean: currentMatch.split('/').pop() || currentMatch,
    partySize: privateData.partySize || 1,
    rank: privateData.competitiveTier || 0,
    mode: privateData.queueId || '',
    playerName: me.game_name + '#' + me.game_tag,
    players: [], // will be expanded with match API
    activePlayer: {
      name: me.game_name || '',
      agent: privateData.characterId || '',
      hp: 100,
    }
  });
}

console.log('');
console.log('  ╔═══════════════════════════════╗');
console.log('  ║   OLYCITY LIVE  v3  🔴        ║');
console.log('  ║   Via Riot Client lockfile    ║');
console.log('  ╚═══════════════════════════════╝');
console.log('');

setInterval(poll, 2000);
poll();
