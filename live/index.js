/**
 * OLYCITY LIVE — Valorant Local API Bridge v2
 * node index.js
 */

const https = require('https');

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const VAL_PORT = 2999;
const agent = new https.Agent({ rejectUnauthorized: false });

// ─── HTTP helpers ─────────────────────────────────────
function get(path) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: '127.0.0.1',
      port: VAL_PORT,
      path,
      agent,
      timeout: 2000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, err: 'JSON parse error', raw: data.slice(0,100) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

function putFirebase(path, data) {
  const body = JSON.stringify(data);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
      path: `/${path}.json`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(body); req.end();
  });
}

// ─── State ────────────────────────────────────────────
let inGame = false;
let lastPhase = '';
let tries = 0;
let connected = false;

function ts() { return new Date().toLocaleTimeString('fr-FR'); }

// ─── Poll ─────────────────────────────────────────────
async function poll() {
  // 1. Check if Valorant API is up
  const check = await get('/liveclientdata/activeplayer');

  if (!check.ok) {
    if (connected) {
      connected = false;
      inGame = false;
      console.log(`[${ts()}] ❌ Connexion perdue (${check.err}) — en attente...`);
      await putFirebase('live', { active: false, ts: Date.now() });
    } else {
      tries++;
      if (tries % 10 === 1) {
        console.log(`[${ts()}] ⏳ En attente de Valorant... (${check.err})`);
        console.log('         → Lance Valorant et entre dans une game/range');
      }
    }
    return;
  }

  // API répond
  if (!connected) {
    connected = true;
    tries = 0;
    console.log(`[${ts()}] ✅ Connecté à Valorant !`);
  }

  // 2. Fetch all data
  const all = await get('/liveclientdata/allgamedata');
  if (!all.ok) {
    console.log(`[${ts()}] ⚠️  allgamedata: ${all.err}`);
    return;
  }

  const d = all.data;
  const phase = d?.gameData?.gameMode || d?.gameData?.roundPhase || '?';
  const mapRaw = d?.gameData?.mapName || '?';
  const map = mapRaw.split('/').pop().split('_').pop();
  const players = d?.allPlayers || [];
  const active = d?.activePlayer || {};

  // Log state changes
  if (!inGame) {
    inGame = true;
    console.log(`[${ts()}] 🎮 Game détectée — Map: ${map} | Mode: ${phase} | ${players.length} joueurs`);
  }
  if (phase !== lastPhase) {
    lastPhase = phase;
    console.log(`[${ts()}] 📍 Phase: ${phase}`);
  }

  // 3. Build payload
  const payload = {
    active: true,
    ts: Date.now(),
    map: mapRaw,
    mapClean: map,
    phase: d?.gameData?.gameMode || '',
    roundPhase: d?.gameData?.roundPhase || 'in-game',
    gameTime: d?.gameData?.gameTime || 0,
    roundTime: d?.gameData?.roundTime || 0,
    activePlayer: {
      name:   active?.summonerName || '',
      agent:  active?.championName || '',
      hp:     active?.stats?.currentHealth || 0,
      maxHp:  active?.stats?.maxHealth || 150,
      shield: active?.stats?.currentShield || 0,
      credits: active?.currentGold || 0,
      ultPts: active?.abilities?.ultimate?.currentCharges || 0,
      ultMax: active?.abilities?.ultimate?.maxCharges || 1,
      ult:    (active?.abilities?.ultimate?.currentCharges || 0) >= (active?.abilities?.ultimate?.maxCharges || 1),
    },
    players: players.map(p => ({
      name:    p.summonerName || '',
      agent:   p.championName || '',
      team:    p.team || 'CHAOS',
      alive:   !p.isDead,
      hp:      p.stats?.currentHealth || 0,
      maxHp:   p.stats?.maxHealth || 150,
      shield:  p.stats?.currentShield || 0,
      kills:   p.scores?.kills || 0,
      deaths:  p.scores?.deaths || 0,
      assists: p.scores?.assists || 0,
      ultPts:  p.abilities?.ultimate?.currentCharges || 0,
      ultMax:  p.abilities?.ultimate?.maxCharges || 1,
      ult:     (p.abilities?.ultimate?.currentCharges || 0) >= (p.abilities?.ultimate?.maxCharges || 1),
      x: p.position?.x || 0,
      y: p.position?.y || 0,
    })),
  };

  await putFirebase('live', payload);
}

// ─── Start ────────────────────────────────────────────
console.log('');
console.log('  ╔═══════════════════════════════╗');
console.log('  ║   OLYCITY LIVE  v2  🔴        ║');
console.log('  ║   Valorant → Firebase → Site  ║');
console.log('  ╚═══════════════════════════════╝');
console.log('');
console.log('  Firebase: ✅');
console.log('  Valorant: en attente...');
console.log('  Ctrl+C pour arrêter');
console.log('');

setInterval(poll, 1000);
poll();
