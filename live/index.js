/**
 * OLYCITY LIVE — Valorant Local API Bridge
 * Lance ce script avant une game : node index.js
 * Les données apparaissent en temps réel sur olycity.gg
 *
 * Requiert : Node.js 18+
 * Installe les dépendances : npm install
 */

const https = require('https');
const http  = require('http');

// ─── Firebase config ─────────────────────────────────
const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = 'AIzaSyBOfJ_6l3Elifz4DC_1iqpyzLjlzPRskCE';

// ─── Valorant Live Client API ─────────────────────────
// Port 2999 = Valorant in-game client data (League/Val shared API)
const VAL_BASE = 'https://127.0.0.1:2999/liveclientdata';

// Ignore self-signed cert from Valorant API
const agent = new https.Agent({ rejectUnauthorized: false });

// ─── Helpers ──────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function pushToFirebase(path, data) {
  const body = JSON.stringify(data);
  const url = new URL(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_KEY}`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main loop ────────────────────────────────────────
let lastPhase = null;
let inGame = false;

async function poll() {
  try {
    // Fetch all game data in one call
    const allData = await get(`${VAL_BASE}/allgamedata`);

    if (!allData) {
      if (inGame) {
        console.log('Game ended — clearing live data');
        await pushToFirebase('live', { active: false, ts: Date.now() });
        inGame = false;
      }
      return;
    }

    inGame = true;
    const { activePlayer, allPlayers, gameData, events } = allData;

    // Build compact payload
    const players = (allPlayers || []).map(p => ({
      name:       p.summonerName,
      agent:      p.championName,
      team:       p.team,
      alive:      !p.isDead,
      hp:         p.stats?.currentHealth || 0,
      maxHp:      p.stats?.maxHealth || 150,
      shield:     p.stats?.currentShield || 0,
      kills:      p.scores?.kills || 0,
      deaths:     p.scores?.deaths || 0,
      assists:    p.scores?.assists || 0,
      ult:        p.abilities?.ultimate?.chargesNeeded === 0,
      ultPts:     p.abilities?.ultimate?.currentCharges || 0,
      ultMax:     p.abilities?.ultimate?.maxCharges || 1,
      position:   { x: p.position?.x || 0, y: p.position?.y || 0 },
    }));

    const game = {
      active:     true,
      ts:         Date.now(),
      map:        gameData?.mapName || '',
      phase:      gameData?.gameMode || '',
      roundPhase: gameData?.roundPhase || '',
      time:       gameData?.gameTime || 0,
      roundTime:  gameData?.roundTime || 0,
      score: {
        ally:   players.filter(p => p.team === 'ORDER').length > 0
          ? (gameData?.gameMode || '').includes('deathmatch') ? 0
          : (events?.Events || []).filter(e => e.EventName === 'Kill' && e.KillerName?.includes('ORDER')).length
          : 0,
        enemy: 0,
      },
      players,
      activePlayer: {
        name:    activePlayer?.summonerName || '',
        agent:   activePlayer?.championName || '',
        hp:      activePlayer?.stats?.currentHealth || 0,
        ult:     activePlayer?.abilities?.ultimate?.chargesNeeded === 0,
        ultPts:  activePlayer?.abilities?.ultimate?.currentCharges || 0,
        ultMax:  activePlayer?.abilities?.ultimate?.maxCharges || 1,
        credits: activePlayer?.currentGold || 0,
      }
    };

    // Log phase changes
    if (gameData?.roundPhase !== lastPhase) {
      lastPhase = gameData?.roundPhase;
      console.log(`[${new Date().toLocaleTimeString()}] Phase: ${lastPhase} | ${players.filter(p=>p.alive && p.team==='ORDER').length}/5 alliés vivants`);
    }

    await pushToFirebase('live', game);

  } catch (e) {
    if (inGame) {
      await pushToFirebase('live', { active: false, ts: Date.now() }).catch(() => {});
      inGame = false;
    }
    // Silently wait — Valorant not launched yet
  }
}

// ─── Start ────────────────────────────────────────────
console.log('');
console.log('  ██████╗ ██╗  ██╗   ██╗ ██████╗██╗████████╗██╗   ██╗');
console.log('  ██╔══██╗██║  ╚██╗ ██╔╝██╔════╝██║╚══██╔══╝╚██╗ ██╔╝');
console.log('  ██║  ██║██║   ╚████╔╝ ██║     ██║   ██║    ╚████╔╝ ');
console.log('  ██║  ██║██║    ╚██╔╝  ██║     ██║   ██║     ╚██╔╝  ');
console.log('  ██████╔╝███████╗██║   ╚██████╗██║   ██║      ██║   ');
console.log('  ╚═════╝ ╚══════╝╚═╝    ╚═════╝╚═╝   ╚═╝      ╚═╝   ');
console.log('');
console.log('  LIVE BRIDGE — Valorant → Firebase → OLYCITY');
console.log('  En attente d\'une game...');
console.log('  Lance Valorant et entre dans une partie.');
console.log('  Ctrl+C pour arrêter.');
console.log('');

setInterval(poll, 1000); // Poll every second
poll();
