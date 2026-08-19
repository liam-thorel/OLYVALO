const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execFileSync, spawn } = require('child_process');
const WebSocket = require('ws');
const { buildRankSnapshot } = require('./rank-utils.js');
const { riotServer } = require('./server-utils.js');
const { autoUpdate, restartDecision } = require('./updater.js');
const { pregameTransition } = require('./pregame-utils.js');
const { ensureStartupLauncher } = require('./startup.js');
const { acquireInstanceLock, releaseInstanceLock } = require('./instance-lock.js');
const { stopLegacyLiveProcesses } = require('./legacy-cleanup.js');
const { createLolWatcher } = require('./lol-watcher.js');
const { planRestart } = require('./restart-policy.js');
const { readIdentity, writeIdentity } = require('./identity.js');
const { createAccountBinder } = require('./account-binding.js');
const { cleanupStalePresence, PRESENCE_CLEANUP_INTERVAL_MS } = require('./maintenance.js');
const { presenceRecordForPath } = require('./presence-schema.js');
const { resolveRiotIdentity } = require('./riot-identity.js');
const { valorantHistorySummary } = require('./history-index.js');

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const SCRIPT_VERSION = '4.17.5';
const INSTANCE_LOCK_PATH = path.join(__dirname, '.olycity-live.lock');
const LOG_PATH = path.join(__dirname, 'olycity.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
let ownsInstanceLock = acquireInstanceLock(INSTANCE_LOCK_PATH);

if (!ownsInstanceLock) process.exit(0);

function releaseOwnedInstanceLock() {
  if (!ownsInstanceLock) return;
  releaseInstanceLock(INSTANCE_LOCK_PATH);
  ownsInstanceLock = false;
}

function spawnSilentLauncher() {
  const child = process.platform === 'win32'
    ? spawn('wscript.exe', [path.join(__dirname, 'silent.vbs')], {
      cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true,
    })
    : spawn(process.execPath, [__filename], {
      cwd: __dirname, detached: true, stdio: 'inherit',
    });
  child.unref();
}

function restartForLogRotationIfNeeded() {
  try {
    if (!fs.existsSync(LOG_PATH) || fs.statSync(LOG_PATH).size <= MAX_LOG_BYTES) return false;
    if (process.platform !== 'win32') {
      fs.truncateSync(LOG_PATH, 0);
      return false;
    }
    releaseOwnedInstanceLock();
    spawnSilentLauncher();
    process.exit(0);
    return true;
  } catch {
    return false;
  }
}

const lolWatcher = createLolWatcher({
  putFB, getFB, ts, scriptVersion: SCRIPT_VERSION,
  getIdentity: () => identity,
  bindAccount: options => accountBinder.bind(options),
});

process.on('exit', releaseOwnedInstanceLock);

// Filet de secours : le script tourne sans supervision (tâche planifiée
// ONLOGON, pas de redémarrage auto par Windows en cas de crash) — donc en cas
// d'erreur fatale on se relance nous-mêmes, avec un garde-fou anti-boucle si
// deux crashs arrivent en moins de 30s (config cassée, ne pas boucler à l'infini).
function crashRestart(reason, error) {
  console.error(`[${ts()}] ⛔ Erreur fatale (${reason}): ${error?.stack || error}`);
  const plan = planRestart(
    Date.now(),
    Number(process.env.OLYCITY_LAST_CRASH_TS || 0),
    Number(process.env.OLYCITY_CRASH_STREAK || 0),
  );
  // On relance TOUJOURS — un script de fond ne doit jamais abandonner. Le délai
  // (appliqué au démarrage de l'enfant) espace les crashs rapprochés sans
  // jamais renoncer à revenir.
  if (plan.delayMs > 0) {
    console.error(`[${ts()}] Crash rapproché — relance dans ${Math.round(plan.delayMs / 1000)}s.`);
  }
  releaseOwnedInstanceLock();
  const child = spawn(process.execPath, [__filename], {
    cwd: __dirname,
    detached: true,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      OLYCITY_LAST_CRASH_TS: String(plan.crashTs),
      OLYCITY_CRASH_STREAK: String(plan.streak),
      OLYCITY_RESTART_DELAY_MS: String(plan.delayMs),
    },
  });
  child.unref();
  process.exit(1);
}

process.on('uncaughtException', error => crashRestart('uncaughtException', error));
process.on('unhandledRejection', error => crashRestart('unhandledRejection', error));

// Valorant ShooterGame.log paths — contains in-game server port
const SHOOTER_LOG_PATHS = [
  path.join(process.env.LOCALAPPDATA||'', 'VALORANT','saved','Logs','ShooterGame.log'),
  path.join(process.env.LOCALAPPDATA||'', 'VALORANT','Saved','Logs','ShooterGame.log'),
  path.join(process.env.LOCALAPPDATA||'', 'VALORANT','saved','Logs','ShooterGame-backup-2026.06.03-03.04.28.log'),
  path.join(process.env.LOCALAPPDATA||'', 'VALORANT','Saved','Logs','ShooterGame-backup-2026.06.03-03.04.28.log'),
];

// Find in-game port from ShooterGame.log or netstat
function findGamePort() {
  // Method 1: ShooterGame.log
  for (const logPath of SHOOTER_LOG_PATHS) {
    try {
      if (!fs.existsSync(logPath)) continue;
      const stat = fs.statSync(logPath);
      const size = stat.size;
      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(Math.min(100000, size));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - 100000));
      fs.closeSync(fd);
      const log = buf.toString('utf8');
      const patterns = [
        /LogCEF.*Port[:\s]+(\d{4,5})/i,
        /LogNet.*port[:\s]+(\d{4,5})/i,
        /Listening.*:(\d{4,5})/i,
        /SSL.*Port[:\s]+(\d{4,5})/i,
        /"port":(\d{4,5})/i,
        /https:\/\/127\.0\.0\.1:(\d{4,5})/i,
      ];
      for (const pattern of patterns) {
        const match = log.match(pattern);
        if (match) {
          const port = parseInt(match[1]);
          if (port > 2000 && port < 65535 && port !== 2099) return port;
        }
      }
    } catch {}
  }

  // Method 2: netstat — find VALORANT-Win64-Shipping.exe listening ports
  try {
    const netstat = execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], {
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const lines = netstat.split('\n');

    // Get VALORANT PID
    let valorantPid = null;
    try {
      const tasklist = execFileSync('tasklist.exe', [
        '/FI', 'IMAGENAME eq VALORANT-Win64-Shipping.exe',
        '/FO', 'CSV',
        '/NH',
      ], {
        timeout: 2000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      const pidMatch = tasklist.match(/"VALORANT-Win64-Shipping.exe","(\d+)"/);
      if (pidMatch) valorantPid = pidMatch[1];
    } catch {}

    if (valorantPid) {
      for (const line of lines) {
        if (!line.includes(valorantPid)) continue;
        if (!line.includes('LISTENING')) continue;
        const portMatch = line.match(/127\.0\.0\.1:(\d+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          if (port > 2000 && port < 65535) return port;
        }
      }
    }
  } catch {}

  // Method 3: Try common ports
  return null;
}

const LOCKFILE_PATHS = [
  path.join(process.env.LOCALAPPDATA||'', 'Riot Games','Riot Client','Config','lockfile'),
  path.join(process.env.APPDATA||'', '..','Local','Riot Games','Riot Client','Config','lockfile'),
];

const MAP_NAMES = {
  'Ascent':'Ascent','Bonsai':'Split','Duality':'Bind','Triad':'Haven',
  'Port':'Icebox','Foxtrot':'Breeze','Canyon':'Fracture','Pitt':'Pearl',
  'Jam':'Lotus','Juliett':'Sunset','Infinity':'Abyss','Rook':'Corrode',
  'Plummet':'Summit',
  'Range':'Range','Poveglia':'Range',
  'HURM_Alley':'District','HURM_Yard':'Piazza','HURM_Bowl':'Kasbah',
  'HURM_Helix':'Drift','HURM_HighTide':'Glitch',
};

function ts() { return new Date().toLocaleTimeString('fr-FR'); }

function readLockfile() {
  for (const p of LOCKFILE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const [,, port, password] = fs.readFileSync(p,'utf8').trim().split(':');
        return { port: parseInt(port), password };
      }
    } catch {}
  }
  return null;
}

function req(port, password, endpoint) {
  const auth = Buffer.from(`riot:${password}`).toString('base64');
  return new Promise(resolve => {
    const r = https.get({
      hostname:'127.0.0.1', port, path: endpoint,
      agent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 2000,
      headers: { Authorization: `Basic ${auth}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const status = Number(res.statusCode) || 0;
          const ok = status >= 200 && status < 300;
          resolve({ ok, status, data:JSON.parse(d), err:ok ? '' : `HTTP ${status}` });
        }
        catch { resolve({ ok:false, err:'parse error', raw:d.slice(0,100) }); }
      });
    });
    r.on('error', e => resolve({ ok:false, err:e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ ok:false, err:'timeout' }); });
  });
}

function putFB(path, data) {
  const body = JSON.stringify(presenceRecordForPath(path, data));
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const r = https.request({
      hostname:'realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
      path:`/${encodedPath}.json?print=silent`, method:'PUT', timeout: 5000,
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Connection':'close'}
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        const accepted = res.statusCode === 200 || res.statusCode === 204;
        if (!accepted && !putFB._warned) {
          putFB._warned = true;
          console.log(`[FB] ⛔ Écriture refusée (${res.statusCode}) — vérifier les règles Firebase ! ${d.slice(0,80)}`);
        }
        if (accepted) putFB._warned = false;
        finish(accepted);
      });
    });
    r.on('error', ()=>finish(false));
    r.on('timeout', () => {
      if (!putFB._timeoutWarned) {
        putFB._timeoutWarned = true;
        console.log('[FB] Ecriture trop lente - nouvelle tentative au prochain passage');
      }
      r.destroy();
      finish(false);
    });
    r.write(body); r.end();
  });
}

function getFB(path) {
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  return new Promise(resolve => {
    const r = https.get({
      hostname: 'realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
      path: `/${encodedPath}.json`, timeout: 5000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    r.on('error', () => resolve(null));
    r.on('timeout', () => { r.destroy(); resolve(null); });
  });
}

// ─── IDENTITÉ OLYCITY ────────────────────────────────────────────────────────
// Qui est la personne derrière ce PC (choisie une fois à l'installation, voir
// ask-identity.js). C'est elle — et non le Riot ID, qui change au gré des
// renommages — qui sert de clé de suivi côté bot et côté site.
let identity = readIdentity(__dirname);
let identityPromptOpenedAt = 0;
let lastIdentityWarning = 0;

const accountBinder = createAccountBinder({
  putFB,
  getFB,
  log: message => console.log(`[${ts()}] 🔗 ${message}`),
});

// Le script tourne en fenêtre cachée (silent.vbs) : impossible d'y poser une
// question. On ouvre donc une vraie console le temps du choix, une seule fois,
// puis on relit le fichier au fil des polls sans jamais bloquer la boucle.
function openIdentityPrompt() {
  const now = Date.now();
  if (now - identityPromptOpenedAt < 5 * 60 * 1000) return;
  identityPromptOpenedAt = now;
  const script = path.join(__dirname, 'ask-identity.js');
  try {
    // Le process parent est lancé par silent.vbs, donc sans console : hériter
    // de ses handles ne donnerait aucun clavier à readline. `cmd /c start`
    // alloue une vraie fenêtre à laquelle l'invite peut s'attacher.
    // Le titre vide ('') est obligatoire, pas cosmétique : `start` interprète
    // son premier argument entre guillemets comme le titre de la fenêtre, et
    // process.execPath contient un espace (…\OLYCITY Live\runtime\node.exe).
    // Sans ce '', cmd prendrait le chemin de node pour un titre et
    // n'exécuterait rien du tout.
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'start', '', '/wait', process.execPath, script], {
        cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: false,
      })
      : spawn(process.execPath, [script], {
        cwd: __dirname, detached: true, stdio: 'inherit',
      });
    child.unref();
    console.log(`[${ts()}] 👤 Identité OLYCITY inconnue — fenêtre de choix ouverte.`);
  } catch (error) {
    console.log(`[${ts()}] Impossible d'ouvrir la fenêtre d'identification — ${error.message}`);
  }
}

function ensureIdentity() {
  if (identity) return identity;
  identity = readIdentity(__dirname);
  if (identity) {
    console.log(`[${ts()}] 👤 Identité OLYCITY : ${identity.memberName}`);
    return identity;
  }
  const now = Date.now();
  if (now - lastIdentityWarning > 60000) {
    lastIdentityWarning = now;
    console.log(`[${ts()}] ⚠ Aucune identité OLYCITY choisie — le suivi reste anonyme tant que personne ne répond.`);
  }
  openIdentityPrompt();
  return null;
}

// Rattache le compte Riot courant au membre choisi. Idempotent : ne réécrit
// dans Firebase que si le Riot ID (ou le jeu observé) a réellement changé —
// c'est exactement ce qui répare un renommage tout seul.
function bindCurrentAccount(playerName, puuid, game) {
  const current = identity || ensureIdentity();
  if (!current || !playerName) return;
  accountBinder
    .bind({ memberId: current.memberId, memberName: current.memberName, playerName, puuid, game })
    .catch(error => console.log(`[${ts()}] Rattachement du compte impossible — ${error.message}`));
}

function reqNoAuth(port, endpoint) {
  return new Promise(resolve => {
    const r = https.get({
      hostname: '127.0.0.1', port, path: endpoint,
      agent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 1000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok:true, data:JSON.parse(d) }); }
        catch { resolve({ ok:false }); }
      });
    });
    r.on('error', () => resolve({ ok:false }));
    r.on('timeout', () => { r.destroy(); resolve({ ok:false }); });
  });
}

// Load agent UUIDs + client version at startup
let AGENT_UUIDS = {};
let AGENT_ICONS = {};
let RIOT_CLIENT_VERSION = 'unknown';

https.get('https://valorant-api.com/v1/version', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const v = JSON.parse(d);
      // Format: "branch-version-builddate-buildver"
      RIOT_CLIENT_VERSION = v.data?.riotClientVersion || v.data?.version || 'unknown';
      console.log(`[init] ✅ Client version: ${RIOT_CLIENT_VERSION.split('-').slice(0,2).join('-')}`);
    } catch {}
  });
}).on('error', () => {});
let agentsReady = false;
https.get('https://valorant-api.com/v1/agents?isPlayableCharacter=true', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const data = JSON.parse(d);
      data.data?.forEach(a => {
        AGENT_UUIDS[a.uuid.toLowerCase()] = a.displayName;
        AGENT_ICONS[a.uuid.toLowerCase()] = a.displayIcon || '';
      });
      agentsReady = true;
      console.log(`[init] ✅ ${Object.keys(AGENT_UUIDS).length} agents chargés`);
    } catch {}
  });
}).on('error', () => {});

// Fallback static UUIDs
// Agent names loaded from API only — no fallback to avoid wrong assignments

// PVP.net API call with auth
async function pdPost(tokens, apiPath, body) {
  return new Promise(resolve => {
    const bodyStr = JSON.stringify(body);
    const r = https.request({
      hostname: `pd.${tokens.region}.a.pvp.net`,
      path: apiPath, method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'X-Riot-Entitlements-JWT': tokens.entitlementsToken,
        'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
        'X-Riot-ClientVersion': tokens.clientVersion || 'unknown',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(3000); r.on('timeout', () => { r.destroy(); resolve(null); });
    r.write(bodyStr); r.end();
  });
}

async function pdGet(tokens, apiPath) {
  return new Promise(resolve => {
    const r = https.get({
      hostname: `pd.${tokens.region}.a.pvp.net`,
      path: apiPath,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'X-Riot-Entitlements-JWT': tokens.entitlementsToken,
        'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
        'X-Riot-ClientVersion': tokens.clientVersion || 'unknown',
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 429) { resolve(null); return; } // rate limit — silent
        if (res.statusCode !== 200) {
          if (res.statusCode !== 404) console.log(`[pdGet] ${res.statusCode} ${apiPath.split('?')[0]}: ${d.slice(0,60)}`);
          // Tokens expirés/invalides — on les invalide pour forcer un re-fetch
          // au prochain poll (sinon le script boucle indéfiniment sur les mêmes
          // tokens périmés sans jamais se rétablir tout seul).
          if (res.statusCode === 401 || res.statusCode === 403 || d.includes('BAD_CLAIMS')) authTokens = null;
          resolve(null); return;
        }
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    r.on('error', e => { resolve(null); });
    r.setTimeout(3000); r.on('timeout', () => { r.destroy(); resolve(null); });
  });
}

async function pvpGet(tokens, apiPath) {
  // Correct format: glz-eu-1.eu.a.pvp.net (not glz-eu.a.pvp.net)
  const region = tokens.region; // 'eu', 'na', 'ap', 'kr', 'latam', 'br'
  const glzUrl = `https://glz-${region}-1.${region}.a.pvp.net${apiPath}`;
  return new Promise(resolve => {
    const url = new URL(glzUrl);
    const r = https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'X-Riot-Entitlements-JWT': tokens.entitlementsToken,
        'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
        'X-Riot-ClientVersion': tokens.clientVersion || 'unknown',
        'User-Agent': 'ShooterGame/13 Windows/10.0.19041.1.256.64bit',
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // 404 is the normal response when the player is not in this phase.
          if (res.statusCode !== 404) console.log(`[pvpGet] ${res.statusCode} ${url.hostname}${apiPath}: ${d.slice(0,80)}`);
          // Tokens expirés/invalides — on les invalide pour forcer un re-fetch
          // au prochain poll (sinon le script boucle indéfiniment sur les mêmes
          // tokens périmés sans jamais se rétablir tout seul).
          if (res.statusCode === 401 || res.statusCode === 403 || d.includes('BAD_CLAIMS')) authTokens = null;
          resolve(null); return;
        }
        try { resolve(JSON.parse(d)); }
        catch { resolve(null); }
      });
    });
    r.on('error', e => { console.log(`[pvpGet] error: ${e.message}`); resolve(null); });
    r.on('timeout', () => { r.destroy(); resolve(null); });
    r.setTimeout(5000);
  });
}

function tryDecodeBase64(str) {
  // Try base64 first
  try { 
    const d = JSON.parse(Buffer.from(str,'base64').toString());
    if (d && typeof d === 'object') return d;
  } catch {}
  // Try raw JSON
  try {
    const d = JSON.parse(str);
    if (d && typeof d === 'object') return d;
  } catch {}
  return null;
}

let inGame = false;
let selfPuuid = null;
let lastPregameMap = '';
let pregameState = null;
let pregameMissedPolls = 0;
let persistentMatchId = '';
let authTokens = null;
let wsConnected = false;
let lastPlayerCount = -1;
let lastScore = '';
let lastGameInfo = null; // snapshot for history push
let gameStartedAt = null;
let ranksLoaded = false;
let rankMap = {};
let lastKnownRoster = [];
let lastKnownRosterMatchId = '';
const rankHistoryCache = new Map();
// Réduit de 6h à 45 min : au-delà du coût des appels Riot (le but premier de
// ce cache), c'est aussi ce qui plafonne la durée pendant laquelle un
// visiteur peut voir des chiffres de saison en cours périmés si l'endpoint
// MMR complet de Riot a un souci passager (constaté en prod : 500 répétés
// sur /mmr/v1/players/{puuid}, qui alimente historicalPeakTier ET
// currentSeasonStats) — mieux vaut se re-synchroniser plus vite une fois
// l'API redevenue fiable que de rester figé sur un cache de plusieurs heures.
const RANK_HISTORY_CACHE_MS = 45 * 60 * 1000;
let stableSessionKey = null;
let missedPolls = 0;
let roundPhase = '';
let roundStartTime = null;
let lastDiagnosticPush = 0;
let lastDiagnosticSignature = '';
let diagnosticPlayerName = '';
let currentServer = null;
let postGameUpdateTimer = null;
let pendingUpdateVersion = '';

function schedulePostGameUpdate() {
  if (postGameUpdateTimer) clearTimeout(postGameUpdateTimer);
  postGameUpdateTimer = setTimeout(() => {
    postGameUpdateTimer = null;
    updateAndRestart().catch(() => {});
  }, 5000);
}

async function publishDiagnostic(state, details = {}, force = false) {
  const sessionKey = stableSessionKey || authTokens?.puuid || selfPuuid;
  if (!sessionKey) return;

  const playerName = details.playerName || diagnosticPlayerName || '';
  const signature = JSON.stringify({ state, playerName, ...details });
  const now = Date.now();
  if (!force && signature === lastDiagnosticSignature && now - lastDiagnosticPush < 10000) return;

  lastDiagnosticSignature = signature;
  lastDiagnosticPush = now;
  await putFB(`live/clients/${sessionKey}`, {
    online: true,
    ts: now,
    version: SCRIPT_VERSION,
    playerName,
    memberId: identity?.memberId || '',
    member: identity?.memberName || '',
    state,
    riotClient: !!lockPort,
    ...details,
  });
}

function getPregameSide(match, puuid) {
  const allyTeam = match?.AllyTeam;
  let teamId = allyTeam?.TeamID || null;

  if (!teamId && Array.isArray(match?.Teams)) {
    teamId = match.Teams.find(team =>
      (team?.Players || []).some(player => player.Subject === puuid)
    )?.TeamID || null;
  }

  if (teamId === 'Blue') return 'DEFENSE';
  if (teamId === 'Red') return 'ATTAQUE';
  return null;
}

function connectWebSocket(port, password) {
  if (wsConnected) return;
  const ws = new WebSocket(`wss://riot:${password}@127.0.0.1:${port}`, {
    rejectUnauthorized: false
  });

  ws.on('open', () => {
    wsConnected = true;
    console.log(`[${ts()}] 🔌 WebSocket connecté`);
    // Subscribe to all events
    ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
    ws.send(JSON.stringify([5, 'OnJsonApiEvent_riot-messaging-service_v1_message']));
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (!Array.isArray(msg) || msg[0] !== 8) return;
      const evt = msg[2];
      const uri = evt?.uri || '';
      const data = evt?.data;

      // Parse payload
      let payload = data;
      if (data?.Payload) {
        try { payload = JSON.parse(data.Payload); } catch {}
      }

      // Round phase
      if (uri.includes('ares-core-game') && payload?.RoundPhase !== undefined) {
        if (payload.RoundPhase !== roundPhase) {
          roundPhase = payload.RoundPhase;
          roundStartTime = Date.now();
          console.log(`[${ts()}] ⏱  Phase: ${roundPhase}`);
          putFB('live/roundPhase', roundPhase).catch(()=>{});
          putFB('live/roundStartTime', roundStartTime).catch(()=>{});
        }
      }

      // Score from match state
      if (uri.includes('ares-core-game') && payload?.Teams) {
        const blueTeam  = payload.Teams.find(t => t.TeamID === 'Blue');
        const redTeam   = payload.Teams.find(t => t.TeamID === 'Red');
        const score = {
          blue: blueTeam?.RoundsWon || 0,
          red:  redTeam?.RoundsWon  || 0,
        };
        if (JSON.stringify(score) !== lastScore) {
          lastScore = JSON.stringify(score);
          console.log(`[${ts()}] 📊 Score: ${score.blue} - ${score.red}`);
          putFB(`live/sessions/${authTokens?.puuid || selfPuuid || 'unknown'}/score`, score).catch(()=>{});
        }
      }

      // Kill feed via XMPP/MUC messages
      if (uri.includes('riot-messaging-service') || uri.includes('ares-coregame')) {
        try {
          const msgBody = payload?.Body || payload?.body || '';
          if (typeof msgBody === 'string' && msgBody.includes('kill')) {
            const parsed = JSON.parse(msgBody);
            if (parsed?.killFeedEvents || parsed?.kills) {
              const kills = parsed.killFeedEvents || parsed.kills;
              const sKey = stableSessionKey || 'unknown';
              if (sKey !== 'unknown') putFB(`live/sessions/${sKey}/kills`, kills).catch(()=>{});
            }
          }
          // Match state events (round end scores etc)
          if (payload?.MessageType === 'V1MatchStarted' || payload?.MessageType === 'V1RoundStarted') {
            console.log(`[${ts()}] 📡 Event: ${payload.MessageType}`);
          }
          if (payload?.KilledBy !== undefined || payload?.Killer !== undefined) {
            const kill = {
              killer: payload.Killer || payload.KillerDisplayName || '?',
              victim: payload.Deceased || payload.VictimDisplayName || '?',
              ts: Date.now()
            };
            console.log(`[${ts()}] 💀 Kill: ${kill.killer} → ${kill.victim}`);
            const sKey = stableSessionKey || 'unknown';
            if (sKey !== 'unknown') putFB(`live/sessions/${sKey}/lastKill`, kill).catch(()=>{});
          }
        } catch {}
      }

    } catch {}
  });

  ws.on('close', () => {
    wsConnected = false;
    console.log(`[${ts()}] 🔌 WebSocket fermé`);
  });

  ws.on('error', e => {
    wsConnected = false;
  });
}
let lastGamePort = null;
let gameDataLogged = false;
let matchDataLogged = false;
let lastMap = '';
let lockPort = null;
let lastIdentityCheck = 0;

async function refreshSelfIdentity(lock, force = false) {
  const now = Date.now();
  if (!force && selfPuuid && now - lastIdentityCheck < 5000) return false;
  lastIdentityCheck = now;

  const resolvedIdentity = await resolveRiotIdentity({ request:req, getFB, lock, identity });
  const detectedPuuid = resolvedIdentity?.puuid || '';
  if (!detectedPuuid || detectedPuuid === selfPuuid) return false;

  const previousKey = stableSessionKey || selfPuuid;
  if (previousKey && previousKey !== detectedPuuid) {
    await Promise.all([
      putFB(`live/sessions/${previousKey}`, {
        active: false,
        ts: now,
        playerName: diagnosticPlayerName || '',
        memberId: identity?.memberId || '',
        member: identity?.memberName || '',
      }),
      putFB(`live/clients/${previousKey}`, {
        online: false,
        state: 'stopped',
        ts: now,
        playerName: diagnosticPlayerName || '',
        memberId: identity?.memberId || '',
        member: identity?.memberName || '',
        version: SCRIPT_VERSION,
      }),
    ]);
    console.log(`[${ts()}] 🔄 Changement de compte Riot: ${previousKey.slice(0,8)}... → ${detectedPuuid.slice(0,8)}...`);
  } else {
    console.log(`[${ts()}] 👤 PUUID détecté: ${detectedPuuid.slice(0,8)}...`);
  }

  selfPuuid = detectedPuuid;
  stableSessionKey = detectedPuuid;
  authTokens = null;
  inGame = false;
  lastPregameMap = '';
  pregameState = null;
  pregameMissedPolls = 0;
  persistentMatchId = '';
  lastPlayerCount = -1;
  lastScore = '';
  lastGameInfo = null;
  gameStartedAt = null;
  ranksLoaded = false;
  rankMap = {};
  lastKnownRoster = [];
  lastKnownRosterMatchId = '';
  missedPolls = 0;
  roundPhase = '';
  roundStartTime = null;
  diagnosticPlayerName = resolvedIdentity?.playerName || '';
  currentServer = null;
  matchDataLogged = false;
  gameDataLogged = false;
  lastMap = '';
  lastDiagnosticPush = 0;
  lastDiagnosticSignature = '';
  if (identity) {
    identity = writeIdentity({
      ...identity,
      lastPuuid: detectedPuuid,
      lastPlayerName: diagnosticPlayerName || identity.lastPlayerName || '',
    }, __dirname);
  }
  await publishDiagnostic('idle', { error: '' }, true);
  return true;
}
let tries = 0;

async function ensureAuth(lock) {
  if (authTokens) return authTokens;
  const entRes    = await req(lock.port, lock.password, '/entitlements/v1/token');
  const regionRes = await req(lock.port, lock.password, '/riotclient/region-locale');
  if (entRes.ok && entRes.data?.accessToken) {
    const rawRegion = (regionRes.data?.region || regionRes.data?.webRegion || 'EUW').toUpperCase();
    const region = rawRegion.startsWith('EU') ? 'eu' : rawRegion === 'NA' ? 'na' :
                   rawRegion === 'LATAM' ? 'latam' : rawRegion === 'BR' ? 'br' :
                   rawRegion === 'AP' ? 'ap' : rawRegion === 'KR' ? 'kr' : 'eu';
    authTokens = {
      accessToken:       entRes.data.accessToken,
      entitlementsToken: entRes.data.token || '',
      puuid:             entRes.data.subject || selfPuuid || '',
      region,
      clientVersion:     RIOT_CLIENT_VERSION,
    };
  }
  return authTokens;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPostMatchDetails(tokens, matchId) {
  if (!tokens || !matchId) return null;
  for (const delay of [0, 2000, 3000, 5000]) {
    if (delay) await wait(delay);
    const details = await pdGet(tokens, `/match-details/v1/matches/${matchId}`);
    if (details?.matchInfo || details?.players?.length) return details;
  }
  return null;
}

async function fetchPlayerNames(tokens, puuids) {
  if (!tokens || !puuids?.length) return {};
  try {
    const response = await pdPost(tokens, '/name-service/v2/players', [...new Set(puuids)]);
    const names = {};
    if (Array.isArray(response)) {
      response.forEach(player => {
        if (player.Subject && player.GameName) {
          names[player.Subject] = `${player.GameName}#${player.TagLine || ''}`.replace(/#$/, '');
        }
      });
    }
    return names;
  } catch (error) {
    console.log(`[${ts()}] ⚠️ Names post-game: ${error.message}`);
    return {};
  }
}

// Le % de headshots n'est pas dans player.stats — il faut le recalculer à
// partir des dégâts round par round (roundResults[].playerStats[].damage[]).
function headshotPercentByPuuid(details) {
  const totals = new Map(); // puuid -> { head, body, leg }
  (details?.roundResults || []).forEach(round => {
    (round.playerStats || []).forEach(playerStat => {
      const puuid = playerStat.subject;
      if (!puuid) return;
      const entry = totals.get(puuid) || { head: 0, body: 0, leg: 0 };
      (playerStat.damage || []).forEach(dmg => {
        entry.head += dmg.headshots || 0;
        entry.body += dmg.bodyshots || 0;
        entry.leg += dmg.legshots || 0;
      });
      totals.set(puuid, entry);
    });
  });
  const percents = new Map();
  totals.forEach((entry, puuid) => {
    const shots = entry.head + entry.body + entry.leg;
    percents.set(puuid, shots ? Math.round((entry.head / shots) * 100) : 0);
  });
  return percents;
}

function buildDetailedHistory(snapshot, details, tokens, resolvedNames = {}) {
  if (!details) return snapshot;

  const rawPlayers = details.players || [];
  const rawTeams = details.teams || [];
  const hsPercentByPuuid = headshotPercentByPuuid(details);
  const mode = details.matchInfo?.queueID || details.matchInfo?.queueId || snapshot.mode;
  const isDeathmatch = String(mode || '').toLowerCase().includes('deathmatch');
  const snapshotPlayers = new Map((snapshot.players || [])
    .filter(player => player.puuid)
    .map(player => [player.puuid, player]));
  const self = rawPlayers.find(player => player.subject === tokens?.puuid);
  const selfTeamId = self?.teamId || (snapshot.selfTeam === 'ORDER' ? 'Blue' : snapshot.selfTeam === 'CHAOS' ? 'Red' : null);
  const selfTeam = rawTeams.find(team => team.teamId === selfTeamId);
  const blueTeam = rawTeams.find(team => team.teamId === 'Blue');
  const redTeam = rawTeams.find(team => team.teamId === 'Red');
  const mapId = details.matchInfo?.mapId?.split('/')?.pop() || snapshot.map;
  const map = MAP_NAMES[mapId] || snapshot.map || mapId;

  const players = rawPlayers.map(player => {
    const stats = player.stats || {};
    const roundsPlayed = stats.roundsPlayed || 0;
    const previousName = snapshotPlayers.get(player.subject)?.name;
    const detailName = player.gameName ? `${player.gameName}#${player.tagLine || ''}`.replace(/#$/, '') : '';
    return {
      name: resolvedNames[player.subject] || detailName || previousName || player.subject?.slice(0, 8) || '?',
      puuid: player.subject || '',
      agent: AGENT_UUIDS[(player.characterId || '').toLowerCase()] || '?',
      agentId: (player.characterId || '').toLowerCase(),
      team: isDeathmatch ? 'NEUTRAL' : player.teamId === 'Blue' ? 'ORDER' : player.teamId === 'Red' ? 'CHAOS' : 'NEUTRAL',
      stats: {
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        assists: stats.assists || 0,
        score: stats.score || 0,
        roundsPlayed,
        acs: roundsPlayed ? Math.round((stats.score || 0) / roundsPlayed) : 0,
        hsPercent: hsPercentByPuuid.get(player.subject) ?? null,
      },
    };
  });

  return {
    ...snapshot,
    schemaVersion: 2,
    map,
    mode,
    ts: details.matchInfo?.gameStartMillis || snapshot.ts,
    endTs: details.matchInfo?.gameStartMillis && details.matchInfo?.gameLengthMillis
      ? details.matchInfo.gameStartMillis + details.matchInfo.gameLengthMillis
      : snapshot.endTs,
    durationMs: details.matchInfo?.gameLengthMillis || Math.max(0, (snapshot.endTs || 0) - (snapshot.ts || 0)),
    result: isDeathmatch ? 'completed' : selfTeam ? (selfTeam.won ? 'win' : 'loss') : snapshot.result,
    score: blueTeam || redTeam ? {
      blue: blueTeam?.roundsWon || 0,
      red: redTeam?.roundsWon || 0,
    } : snapshot.score,
    selfTeam: isDeathmatch ? 'NEUTRAL' : selfTeamId === 'Blue' ? 'ORDER' : selfTeamId === 'Red' ? 'CHAOS' : snapshot.selfTeam,
    players: players.length ? players : snapshot.players,
    rounds: details.roundResults?.length || 0,
  };
}

async function fetchPostMatchRR(tokens, matchId) {
  if (!tokens?.puuid || !matchId) return null;
  const updates = await pdGet(tokens, `/mmr/v1/players/${tokens.puuid}/competitiveupdates?startIndex=0&endIndex=5&queue=competitive`);
  const match = updates?.Matches?.find(item => (item.MatchID || item.MatchId) === matchId);
  if (!match) return null;
  const earned = match.RankedRatingEarned;
  const before = match.RankedRatingBeforeUpdate;
  const after = match.RankedRatingAfterUpdate;
  return {
    before: before ?? null,
    after: after ?? null,
    delta: earned ?? (before !== undefined && after !== undefined ? after - before : null),
    tier: match.TierAfterUpdate ?? null,
    tierBefore: match.TierBeforeUpdate ?? null,
  };
}

async function poll() {
  if (!agentsReady) return;
  const lock = readLockfile();
  if (!lock) {
    tries++;
    if (tries % 10 === 1) console.log(`[${ts()}] ⏳ Riot Client non détecté`);
    await publishDiagnostic('riot-offline', { riotClient: false, error: 'Client Riot non détecté' });
    return;
  }
  if (lock.port !== lockPort) {
    lockPort = lock.port;
    console.log(`[${ts()}] ✅ Riot Client — port ${lock.port}`);
  }

  const res = await req(lock.port, lock.password, '/chat/v4/presences');
  if (!res.ok) {
    tries++;
    if (tries % 10 === 1) console.log(`[${ts()}] ⚠️  Presence: ${res.err}`);
    await refreshSelfIdentity(lock, !selfPuuid);
    await publishDiagnostic('error', { error: `Presence: ${res.err || 'indisponible'}` });
    return;
  }
  tries = 0;

  // Refresh the Riot identity regularly so account switches do not leave the
  // script filtering presence with the previous account's PUUID.
  await refreshSelfIdentity(lock, !selfPuuid);

  const presences = res.data?.presences || [];

  // Filter: only self presence, or first one if PUUID unknown
  const myPresences = selfPuuid
    ? presences.filter(p => p.puuid === selfPuuid)
    : presences.slice(0, 1);

  const ownIdentity = myPresences.find(p => p.game_name);
  if (ownIdentity) {
    diagnosticPlayerName = `${ownIdentity.game_name}#${ownIdentity.game_tag || ''}`.replace(/#$/, '');
    // Le Riot ID courant est réenregistré sous le membre choisi à
    // l'installation : un renommage se répercute ici, sans réassignation
    // manuelle dans #admin.
    bindCurrentAccount(diagnosticPlayerName, selfPuuid || stableSessionKey, 'valorant');
  }

  let found = null;
  let playerName = '';
  let matchData = null;
  let realMatchId = '';
  let corePlayer = null;
  let coreMatch = null;

  // ===== Détection AGENT SELECT (indépendante de la présence/isInGame) =====
  // Pendant le pick, la présence n'a pas de map — on interroge l'endpoint pregame directement.
  try {
    await ensureAuth(lock);
    if (authTokens?.puuid && stableSessionKey) {
      const publishPregame = async state => {
        const observedPlayerName = playerName || diagnosticPlayerName || '';
        await putFB(`live/sessions/${stableSessionKey}`, {
          active: true, ts: Date.now(),
          map: state.map, mapClean: state.mapClean, mapInternal: state.map,
          mode: state.mode || 'competitive', phase: 'pregame', side: state.side,
          matchId: state.matchId, playerName: observedPlayerName, players: [], activePlayer: {},
          puuid: stableSessionKey || '',
          memberId: identity?.memberId || '',
          member: identity?.memberName || '',
          rank: rankMap[authTokens?.puuid] || null,
          scriptVersion: SCRIPT_VERSION,
          server: state.server || '',
          gamePodId: state.gamePodId || '',
        });
        await publishDiagnostic('agent-select', {
          error: '', map: state.mapClean, matchId: state.matchId, side: state.side,
          server: state.server || '',
        });
      };

      const pg = await pvpGet(authTokens, `/pregame/v1/players/${authTokens.puuid}`);
      if (pg?.MatchID) {
        const pgMatch = await pvpGet(authTokens, `/pregame/v1/matches/${pg.MatchID}`);
        if (pgMatch?.MapID) {
          lastKnownRoster = [];
          lastKnownRosterMatchId = pg.MatchID;
          const pgMap = pgMatch.MapID.split('/').pop() || '';
          const pgMode = (pgMatch.QueueID || pgMatch.Mode || '').replace('/Game/GameModes/','');
          const side = getPregameSide(pgMatch, authTokens.puuid);
          currentServer = riotServer(pgMatch.GamePodID, authTokens.region);

          pregameState = {
            map: pgMap,
            mapClean: MAP_NAMES[pgMap] || pgMap,
            matchId: pg.MatchID,
            side,
            mode: pgMatch.QueueID || 'competitive',
            server: currentServer?.name || '',
            gamePodId: currentServer?.gamePodId || '',
          };
          pregameMissedPolls = 0;
          if (pregameState.mapClean !== lastPregameMap) {
            lastPregameMap = pregameState.mapClean;
            console.log(`[${ts()}] 🗺  Agent Select — ${pregameState.mapClean}${side ? ' · ' + side : ''}`);
          }
          await publishPregame(pregameState);
          missedPolls = 0;
          return; // agent select handled — skip in-game logic this poll
        }
      }

      if (pregameState) {
        corePlayer = await pvpGet(authTokens, `/core-game/v1/players/${authTokens.puuid}`);
        const transition = pregameTransition(
          pregameState,
          corePlayer?.MatchID || '',
          pregameMissedPolls,
        );
        pregameMissedPolls = transition.missedPolls;
        if (transition.action === 'keep-pregame') {
          await publishPregame(pregameState);
          missedPolls = 0;
          return;
        }
        if (transition.action === 'clear-pregame') {
          // Dodge / partie annulée en sélection d'agents : aucune vraie game
          // n'a démarré, donc jamais de "fin de game" classique plus bas dans
          // poll() (celle-ci exige inGame===true, qui ne devient vrai qu'une
          // fois en core-game). Sans ce push, la session restait active:true
          // pour toujours côté Firebase — pas de notif de fin, pas de
          // remboursement des paris.
          const sKey = stableSessionKey || 'unknown';
          if (sKey !== 'unknown') {
            await putFB(`live/sessions/${sKey}`, {
              active: false, ts: Date.now(),
              playerName: playerName || diagnosticPlayerName || '',
              memberId: identity?.memberId || '',
              member: identity?.memberName || '',
              matchId: pregameState.matchId,
            });
          }
          console.log(`[${ts()}] 🚫 Dodge détecté — partie annulée avant le lancement`);
        }
        pregameState = null;
      } else {
        pregameMissedPolls = 0;
      }
    }
  } catch {}


  // Also scan all presences for OLYCITY roster games
  const OLYCITY_ROSTER = ['Drew A Picasso', 'Wong Chi Ming', 'RayBaz', 'M A I R', 'baby hayabusa', 'VENOM X RAMEEZ'];
  const rosterGames = [];
  for (const p of presences) {
    if (!p.game_name) continue;
    const isRoster = OLYCITY_ROSTER.some(name => p.game_name?.includes(name.split(' ')[0]) || p.game_name?.includes(name));
    if (!isRoster || p.puuid === selfPuuid) continue;
    for (const [, val] of Object.entries(p)) {
      if (typeof val !== 'string' || val.length < 10) continue;
      const d = tryDecodeBase64(val);
      if (d?.location?.includes('/Game/Maps/')) {
        const mapRaw = d.location.replace('social_location_', '').split('/').pop();
        const mode = (d.mode || '').replace('social_mode_', '');
        rosterGames.push({ name: `${p.game_name}#${p.game_tag}`, map: MAP_NAMES[mapRaw] || mapRaw, mode });
        break;
      }
    }
  }
  if (rosterGames.length > 0) {
    await putFB('live/rosterGames', rosterGames).catch(() => {});
  }

  for (const p of myPresences) {
    let presenceHasGameData = false;

    // Decode ALL string fields
    for (const [key, val] of Object.entries(p)) {
      if (typeof val !== 'string' || val.length < 10) continue;
      const d = tryDecodeBase64(val);
      if (!d) continue;

      if (d.location && d.mode) {
        found = d;
        presenceHasGameData = true;
      }
      if (d.matchPresenceData) {
        matchData = d.matchPresenceData;
        presenceHasGameData = true;
      }
    }

    // Only set playerName from the presence that has game data
    if (presenceHasGameData && p.game_name) {
      playerName = `${p.game_name}#${p.game_tag}`;
    }
  }

  // Presence data is incomplete in some queues (notably Deathmatch). Always use
  // core-game as a second source before deciding that no game is running.
  try {
    await ensureAuth(lock);
    if (authTokens?.puuid) {
      corePlayer = corePlayer || await pvpGet(authTokens, `/core-game/v1/players/${authTokens.puuid}`);
      if (corePlayer?.MatchID) {
        realMatchId = corePlayer.MatchID;
        persistentMatchId = realMatchId;
        coreMatch = await pvpGet(authTokens, `/core-game/v1/matches/${realMatchId}`);
        pregameState = null;
        pregameMissedPolls = 0;

        if (!playerName) {
          const ownPresence = myPresences.find(p => p.game_name);
          if (ownPresence) playerName = `${ownPresence.game_name}#${ownPresence.game_tag || ''}`.replace(/#$/, '');
        }
      }
    }
  } catch {}

  // Determine if in game
  const location   = found?.location || '';
  const mode       = (found?.mode || '').replace('social_mode_','');
  const coreMapRaw = coreMatch?.MapID?.split('/')?.pop() || '';
  const coreModeId = coreMatch?.ModeID?.split('/')?.pop()?.split('.')?.[0] || '';
  const coreMode   = /deathmatch/i.test(coreModeId) ? 'deathmatch' : coreModeId;
  const mapRaw     = coreMapRaw || location.replace('social_location_','').split('/').pop() || matchData?.matchMap?.split('/')?.pop() || '';
  const mapDisplay = MAP_NAMES[mapRaw] || mapRaw || '';
  const queueId    = coreMatch?.MatchmakingData?.QueueID || coreMatch?.QueueID || matchData?.queueId || mode || coreMode || '';
  const isShootingRange = /shootingrange/i.test(coreModeId) || mapRaw === 'Range' || /range/i.test(location);
  const isInGame   = !isShootingRange && (!!corePlayer?.MatchID || !!(mapRaw && mapRaw !== 'Range' && mapRaw !== ''));

  if (!isInGame) {
    missedPolls = (missedPolls || 0) + 1;
    if (inGame && missedPolls >= 3) { // 3 missed polls = ~6s grace period
      inGame = false;
      lastMap = '';
      missedPolls = 0;
      console.log(`[${ts()}] 🏠 Fin de game`);
      const postMatchTokens = authTokens ? { ...authTokens } : null;
      lastPregameMap = ''; pregameState = null; pregameMissedPolls = 0;
      const sKey = stableSessionKey || 'unknown';
      // À ce stade la présence Riot ne rapporte déjà plus le joueur "en jeu"
      // (c'est justement ce qui déclenche cette branche), donc `playerName`
      // — recalculé à chaque poll depuis la présence — est vide ici. On
      // retombe sur la dernière identité connue pendant la partie, sans quoi
      // le bot Discord ne peut identifier à qui appartient le résultat et
      // abandonne silencieusement la notification de fin de partie.
      const endingPlayerName = playerName || lastGameInfo?.player || diagnosticPlayerName || '';
      if (sKey !== 'unknown') await putFB(`live/sessions/${sKey}`, {
        active: false, ts: Date.now(), playerName: endingPlayerName,
        // Ce PUT remplace la session entière : sans ça, le membre publié
        // pendant la game serait effacé juste avant que le bot lise le résultat.
        memberId: identity?.memberId || '',
        member: identity?.memberName || '',
        matchId: lastGameInfo?.matchId || '',
      });
      await publishDiagnostic('game-ended', { error: '', map: lastGameInfo?.map || '' }, true);

      // Push game to history (deduped by matchId)
      if (lastGameInfo && lastGameInfo.matchId) {
        let result = 'unknown';
        try {
          const sc = JSON.parse(lastScore || '{}');
          if (sc.blue !== undefined && lastGameInfo.selfTeam) {
            const mine   = lastGameInfo.selfTeam === 'ORDER' ? sc.blue : sc.red;
            const theirs = lastGameInfo.selfTeam === 'ORDER' ? sc.red  : sc.blue;
            if (mine > theirs) result = 'win';
            else if (mine < theirs) result = 'loss';
            else result = 'draw';
            lastGameInfo.score = sc;
          }
        } catch {}
        lastGameInfo.result = result;
        lastGameInfo.endTs = Date.now();

        const details = await fetchPostMatchDetails(postMatchTokens, lastGameInfo.matchId);
        const postMatchNames = await fetchPlayerNames(postMatchTokens, (details?.players || []).map(player => player.subject).filter(Boolean));
        lastGameInfo = buildDetailedHistory(lastGameInfo, details, postMatchTokens, postMatchNames);
        const rr = await fetchPostMatchRR(postMatchTokens, lastGameInfo.matchId);
        if (rr) lastGameInfo.rr = rr;

        const histKey = lastGameInfo.matchId.replace(/[.#$\[\]\/]/g, '-');
        const reporterKey = String(lastGameInfo.playerPuuid || stableSessionKey || 'unknown').replace(/[.#$\[\]\/]/g, '-');
        const historySummary = valorantHistorySummary(lastGameInfo);
        await putFB(`live/history/${histKey}/reports/${reporterKey}`, lastGameInfo);
        await putFB(`historyIndex/valorant/${histKey}/reports/${reporterKey}`, historySummary);
        await putFB(`historyIndex/valorant/${histKey}/ts`, historySummary.ts);
        console.log(`[${ts()}] 📜 Game enregistrée — ${lastGameInfo.map} (${lastGameInfo.result})${details ? ' · détails OK' : ' · résumé local'}`);

        // Résumé de fin de game pour le bot Discord (paris + notif de résultat)
        if (sKey !== 'unknown') {
          const selfPuuid = lastGameInfo.playerPuuid || postMatchTokens?.puuid || stableSessionKey;
          const self = (lastGameInfo.players || []).find(player => player.puuid === selfPuuid);
          await putFB(`live/sessions/${sKey}/result`, {
            result: lastGameInfo.result,
            matchId: lastGameInfo.matchId,
            kills: self?.stats.kills ?? null,
            deaths: self?.stats.deaths ?? null,
            assists: self?.stats.assists ?? null,
            acs: self?.stats.acs ?? null,
            hsPercent: self?.stats.hsPercent ?? null,
            agent: self?.agent || '',
            agentIcon: AGENT_ICONS[self?.agentId] || '',
            rr: lastGameInfo.rr ?? null,
            map: lastGameInfo.map,
            mode: lastGameInfo.mode,
            durationSeconds: Math.round((lastGameInfo.durationMs || 0) / 1000),
            score: lastGameInfo.score || null,
          });
        }

        lastGameInfo = null;
        gameStartedAt = null;
        lastScore = '';
      }
      persistentMatchId = '';
      lastKnownRoster = [];
      lastKnownRosterMatchId = '';
      authTokens = null;
      currentServer = null;
      schedulePostGameUpdate();
    }
    await publishDiagnostic('idle', { error: '', map: '' });
    return;
  }
  missedPolls = 0;

  if (!inGame || mapRaw !== lastMap) {
    inGame   = true;
    lastMap  = mapRaw;
    gameStartedAt = Date.now();
    matchDataLogged = false;
    gameDataLogged = false;
    authTokens = null;
    ranksLoaded = false;
    rankMap = {};
    connectWebSocket(lock.port, lock.password);
    console.log(`[${ts()}] 🎮 EN GAME — ${mapDisplay} (${mapRaw}) | ${queueId} | ${playerName}`);
  }

  // Get auth tokens (réutilise ensureAuth)
  let players = [];
  await ensureAuth(lock);

  // Fetch current match from PVP.net
  if (authTokens && isInGame) {
    try {
      // Try core-game first, then pre-game
      let matchData = corePlayer || await pvpGet(authTokens, `/core-game/v1/players/${authTokens.puuid}`);

      if (!matchData?.MatchID) {
        matchData = await pvpGet(authTokens, `/pregame/v1/players/${authTokens.puuid}`);

      }
      if (matchData?.MatchID) pregameState = null; // game started

      if (matchData?.MatchID) {
        realMatchId = matchData.MatchID;
        persistentMatchId = realMatchId; // persist across polls
        const match = coreMatch?.MatchID === matchData.MatchID
          ? coreMatch
          : await pvpGet(authTokens, `/core-game/v1/matches/${matchData.MatchID}`);

        if (match?.Players) {
          currentServer = riotServer(match.GamePodID, authTokens.region);
          // Fetch player names from name service
          const puuids = match.Players.map(p => p.Subject).filter(Boolean);
          let nameMap = {};
          // rankMap is global — populated async
          try {
            const namesRes = await pdPost(authTokens, '/name-service/v2/players', puuids);

            if (Array.isArray(namesRes)) {
              namesRes.forEach(n => { 
                if (n.GameName) nameMap[n.Subject] = `${n.GameName}#${n.TagLine}`;
              });
            }
          } catch(e) {
            console.log(`[${ts()}] ⚠️  Names: ${e.message}`);
          }

          // Fetch ranks once per game — sequential to avoid rate limit
          if (!ranksLoaded && puuids.length > 1) {
            ranksLoaded = true;
            const puuidsCopy = [...puuids];
            const tokensCopy = {...authTokens};
            const stableMapRaw = mapRaw;
            const stableMapDisplay = mapDisplay;
            const stableMode = queueId;
            const stableMatchId = realMatchId;
            const stablePlayerName = playerName;
            const stableServer = currentServer ? { ...currentServer } : null;
            (async () => {
              await new Promise(r => setTimeout(r, 2000));
              let count = 0;
              for (const puuid of puuidsCopy) {
                await new Promise(r => setTimeout(r, 500));
                const cachedHistory = rankHistoryCache.get(puuid);
                const hasFreshHistory = cachedHistory?.expiresAt > Date.now();
                let mmr = hasFreshHistory ? cachedHistory.data : null;
                const historyRequest = mmr
                  ? Promise.resolve(mmr)
                  : pdGet(tokensCopy, `/mmr/v1/players/${puuid}`);
                const [freshMmr, updates, xp] = await Promise.all([
                  historyRequest,
                  pdGet(tokensCopy, `/mmr/v1/players/${puuid}/competitiveupdates?startIndex=0&endIndex=5&queue=competitive`),
                  pdGet(tokensCopy, `/account-xp/v1/players/${puuid}`),
                ]);
                mmr = freshMmr;
                if (!hasFreshHistory && mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID) {
                  rankHistoryCache.set(puuid, {
                    data: mmr,
                    expiresAt: Date.now() + RANK_HISTORY_CACHE_MS,
                  });
                }

                // Recent matches remain useful for the current RR and its evolution.
                // If Riot withholds season history (notably for some anonymous players),
                // buildRankSnapshot transparently falls back to the best recent tier.
                const rank = buildRankSnapshot(mmr, updates, xp?.Progress?.Level);
                if (rank) {
                  rankMap[puuid] = rank;
                  count++;
                }
              }
              if (count > 0) {
                console.log(`[${ts()}] 🏅 Rangs chargés: ${count}/${puuidsCopy.length}`);
                const updatedPlayers = puuidsCopy.map((puuid, i) => ({
                  ...(players[i] || {}),
                  rank: rankMap[puuid] || null,
                }));
                const sKey = tokensCopy.puuid || 'unknown';
                if (sKey !== 'unknown') {
                  // Push full session to guarantee SSE detects the change
                  await putFB(`live/sessions/${sKey}`, {
                    active: true,
                    ts: Date.now(),
                    map: stableMapRaw, mapClean: stableMapDisplay, mapInternal: stableMapRaw,
                    mode: stableMode, matchId: stableMatchId,
                    playerName: stablePlayerName,
                    players: updatedPlayers,
                    activePlayer: { name: stablePlayerName },
                    scriptVersion: SCRIPT_VERSION,
                    server: stableServer?.name || '',
                    gamePodId: stableServer?.gamePodId || '',
                  });
                }
              } else {
                console.log(`[${ts()}] ⚠️  Rangs indisponibles`);
              }
            })();
          }

          // Extract score
          const teams = match.Teams || [];
          const blueScore = teams.find(t => t.TeamID === 'Blue')?.Score || 0;
          const redScore  = teams.find(t => t.TeamID === 'Red')?.Score || 0;
          lastScore = JSON.stringify({ blue: blueScore, red: redScore });

          players = match.Players.map(p => {
            // Match agent UUID (first 8 chars)
            const charId = (p.CharacterID || '').toLowerCase();
            // Exact UUID match only — no partial matching (causes wrong agents)
            const agentName = AGENT_UUIDS[charId] || '?';
            return {
              name:    nameMap[p.Subject] || p.Subject?.slice(0,8) || '?',
              puuid:   p.Subject || '',
              agent:   agentName,
              agentId: charId,
              team:    p.TeamID === 'Blue' ? 'ORDER' : p.TeamID === 'Red' ? 'CHAOS' : 'NEUTRAL',
              alive:   true, hp: 100, maxHp: 150,
              kills:   0, deaths: 0, assists: 0,
              ult: false, x: 0, y: 0,
              incognito: !nameMap[p.Subject],
              rank: rankMap[p.Subject] || null,
            };
          });
          if (!gameDataLogged) {
            gameDataLogged = true;
            console.log(`[${ts()}] 🎯 Match data: ${players.length} joueurs trouvés`);
            players.forEach(p => console.log(`   ${p.team === 'ORDER' ? '🔵' : '🔴'} ${p.name} — ${p.agent}`));
          }
        }
      }
    } catch (e) {
      if (!gameDataLogged) console.log(`[${ts()}] ⚠️  PVP.net: ${e.message}`);
    }
  }

  // Try to get in-game data from ShooterGame log (fallback)
  let activePlayer = { name: playerName, agent: matchData?.characterId || '', hp: 100, maxHp: 100 };

  const gamePort = findGamePort();
  // If no port found from log/netstat, try scanning
  let activeGamePort = gamePort;
  if (!activeGamePort && isInGame) {
    for (const tryPort of [2999, 21337, 21338, 21339, 21340, 21392]) {
      const test = await reqNoAuth(tryPort, '/liveclientdata/activeplayer');
      if (test.ok) { activeGamePort = tryPort; break; }
    }
  }

  if (activeGamePort && activeGamePort !== lastGamePort) {
    lastGamePort = activeGamePort;
    console.log(`[${ts()}] 🎮 Port in-game trouvé: ${activeGamePort}`);
  }

  if (activeGamePort) {
    const gameData = await reqNoAuth(activeGamePort, '/liveclientdata/allgamedata');
    if (gameData.ok && gameData.data?.allPlayers) {
      players = (gameData.data.allPlayers || []).map(p => ({
        name:    p.summonerName,
        agent:   p.championName,
        team:    p.team,
        alive:   !p.isDead,
        hp:      p.stats?.currentHealth || 0,
        maxHp:   p.stats?.maxHealth || 150,
        kills:   p.scores?.kills || 0,
        deaths:  p.scores?.deaths || 0,
        assists: p.scores?.assists || 0,
        ult:     (p.abilities?.ultimate?.currentCharges || 0) >= (p.abilities?.ultimate?.maxCharges || 1),
        x: p.position?.x || 0,
        y: p.position?.y || 0,
      }));
      const ap = gameData.data.activePlayer;
      if (ap) {
        activePlayer = {
          name:   ap.summonerName || playerName,
          agent:  ap.championName || '',
          hp:     ap.stats?.currentHealth || 100,
          maxHp:  ap.stats?.maxHealth || 150,
          ult:    (ap.abilities?.ultimate?.currentCharges||0) >= (ap.abilities?.ultimate?.maxCharges||1),
          credits: ap.currentGold || 0,
        };
      }
      if (!gameDataLogged) {
        gameDataLogged = true;
        console.log(`[${ts()}] 🎯 In-game data: ${players.length} joueurs | ${activePlayer.agent}`);
      }
    }
  }

  const currentMatchId = persistentMatchId || realMatchId || '';
  if (players.length > 0 && currentMatchId) {
    lastKnownRoster = players.map(player => ({ ...player }));
    lastKnownRosterMatchId = currentMatchId;
  } else if (currentMatchId && currentMatchId === lastKnownRosterMatchId && lastKnownRoster.length > 0) {
    players = lastKnownRoster.map(player => ({ ...player }));
  }

  if (!stableSessionKey && (authTokens?.puuid || selfPuuid)) stableSessionKey = authTokens?.puuid || selfPuuid;
  const sessionKey = stableSessionKey || 'unknown';
  if (sessionKey === 'unknown') return; // don't push until we have a real key
  await putFB(`live/sessions/${sessionKey}`, {
    active:      true,
    ts:          Date.now(),
    map:         mapRaw,
    mapDisplay:  mapDisplay,
    mapInternal: mapRaw,
    mapClean:    mapDisplay,
    mode:        queueId,
    matchId:     pregameState?.matchId || persistentMatchId || realMatchId || '',
    playerName:  playerName,
    puuid:       stableSessionKey || '',
    memberId:    identity?.memberId || '',
    member:      identity?.memberName || '',
    players,
    activePlayer,
    rank:         rankMap[authTokens?.puuid || selfPuuid] || null,
    score:        JSON.parse(lastScore || '{}'),
    phase:       pregameState ? 'pregame' : '',
    scriptVersion: SCRIPT_VERSION,
    server:       currentServer?.name || '',
    gamePodId:    currentServer?.gamePodId || '',
    ...(pregameState ? { map: pregameState.map, mapClean: pregameState.mapClean, mapInternal: pregameState.map, mode: 'agent-select', side: pregameState.side } : {}),
  });
  await publishDiagnostic('in-game', {
    error: '', map: mapDisplay, matchId: persistentMatchId || realMatchId || '',
    server: currentServer?.name || '',
  });

  // Snapshot for history (pushed at game end)
  if (players.length > 0) {
    const selfP = players.find(p => p.puuid === (authTokens?.puuid || stableSessionKey));
    const currentMatchId = persistentMatchId || realMatchId || '';
    const snapshot = {
      ts: gameStartedAt || Date.now(),
      map: mapDisplay,
      mode: queueId,
      matchId: currentMatchId,
      player: playerName,
      playerPuuid: authTokens?.puuid || stableSessionKey || '',
      selfTeam: selfP?.team || null, // ORDER=Blue, CHAOS=Red
      players: players.map(p => ({
        name: p.name, puuid: p.puuid || '', agent: p.agent, agentId: p.agentId || '',
        team: p.team, incognito: !!p.incognito,
      })),
    };
    if (!lastGameInfo || (currentMatchId && lastGameInfo.matchId !== currentMatchId)) {
      lastGameInfo = snapshot;
    } else {
      lastGameInfo = { ...lastGameInfo, ...snapshot, ts: lastGameInfo.ts || snapshot.ts };
    }
  }

  if (!inGame || players.length !== lastPlayerCount) {
    lastPlayerCount = players.length;
    console.log(`[${ts()}] ✅ ${mapDisplay} | ${queueId} | ${players.length} joueurs | WS:${wsConnected?'✓':'✗'}`);
  }
}

let updateCheckRunning = false;

function restartWithInstalledUpdate(version) {
  console.log(`[${ts()}] Mise à jour v${version} prête — redémarrage automatique en arrière-plan...`);
  releaseOwnedInstanceLock();
  spawnSilentLauncher();
  process.exit(0);
  return true;
}

async function updateAndRestart() {
  if (updateCheckRunning) return false;
  if (pendingUpdateVersion) {
    if (restartDecision(inGame, pendingUpdateVersion) === 'defer') return false;
    return restartWithInstalledUpdate(pendingUpdateVersion);
  }
  updateCheckRunning = true;
  try {
    const result = await autoUpdate(SCRIPT_VERSION, __dirname);
    if (!result.updated) return false;

    if (restartDecision(inGame, result.version) === 'defer') {
      pendingUpdateVersion = result.version;
      console.log(`[${ts()}] Mise à jour v${result.version} téléchargée en arrière-plan — redémarrage automatique après la partie`);
      return false;
    }

    return restartWithInstalledUpdate(result.version);
  } catch (error) {
    console.log(`[${ts()}] Mise à jour indisponible — ${error.message}`);
    return false;
  } finally {
    updateCheckRunning = false;
  }
}

async function start() {
  // Espacement après un crash rapproché (cf. restart-policy.js) : l'enfant
  // relancé patiente ici plutôt que de boucler à chaud.
  const restartDelay = Number(process.env.OLYCITY_RESTART_DELAY_MS || 0);
  if (restartDelay > 0) await new Promise(resolve => setTimeout(resolve, restartDelay));
  // Après une minute sans nouveau crash, la série est considérée éteinte.
  setTimeout(() => { delete process.env.OLYCITY_CRASH_STREAK; }, 60_000).unref?.();

  if (restartForLogRotationIfNeeded()) return;

  const stopLegacy = () => {
    const stopped = stopLegacyLiveProcesses();
    if (stopped > 0) console.log(`[${ts()}] Ancien script OLYCITY arrêté: ${stopped}`);
  };
  stopLegacy();
  for (const delay of [5000, 15000]) {
    const timer = setTimeout(stopLegacy, delay);
    timer.unref();
  }

  if (await updateAndRestart()) return;

  try {
    const startup = ensureStartupLauncher(__dirname);
    if (startup.changed) console.log(`[${ts()}] Démarrage Windows auto-réparé`);
  } catch (error) {
    console.log(`[${ts()}] Démarrage Windows indisponible — ${error.message}`);
  }

  console.log('\n  ╔══════════════════════════════╗');
  console.log(`  ║  OLYCITY LIVE v${SCRIPT_VERSION} 🔴    ║`);
  console.log('  ╚══════════════════════════════╝\n');

  // Première chose : savoir à qui on a affaire. Si personne n'a encore
  // répondu (mise à jour d'une installation existante), une fenêtre s'ouvre —
  // le suivi continue en attendant, il sera simplement anonyme.
  if (ensureIdentity()) {
    console.log(`[${ts()}] 👤 OLYCITY Live tourne pour ${identity.memberName}`);
  }

  let cleanupRunning = false;
  const runPresenceCleanup = async () => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try {
      const removed = await cleanupStalePresence({ getFB, putFB });
      if (removed > 0) console.log(`[${ts()}] 🧹 ${removed} ancienne(s) présence(s) Live supprimée(s)`);
    } finally {
      cleanupRunning = false;
    }
  };
  runPresenceCleanup().catch(() => {});
  const cleanupTimer = setInterval(() => runPresenceCleanup().catch(() => {}), PRESENCE_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  let lolPollRunning = false;
  const pollLolOnce = async () => {
    if (lolPollRunning) return false;
    lolPollRunning = true;
    try {
      await lolWatcher.poll();
      return true;
    } catch (error) {
      console.log(`[${ts()}] LoL - erreur temporaire: ${error.message}`);
      return false;
    } finally {
      lolPollRunning = false;
    }
  };

  setInterval(poll, 2000);
  setInterval(pollLolOnce, 3000);
  // Relit olycity-identity.json tant que le choix n'a pas été fait, pour
  // prendre en compte la réponse sans avoir à redémarrer le script.
  const identityWatcher = setInterval(() => {
    if (identity) { clearInterval(identityWatcher); return; }
    ensureIdentity();
  }, 10000);
  identityWatcher.unref?.();
  setInterval(updateAndRestart, 30 * 60 * 1000);
  poll();
  pollLolOnce();
}

start();

let shuttingDown = false;
async function markSessionInactiveAndExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const sessionKey = stableSessionKey || authTokens?.puuid || selfPuuid;
  if (sessionKey) {
    await putFB(`live/sessions/${sessionKey}`, {
      active: false,
      ts: Date.now(),
      memberId: identity?.memberId || '',
      member: identity?.memberName || '',
      stoppedBy: signal,
    });
    await putFB(`live/clients/${sessionKey}`, {
      online: false,
      ts: Date.now(),
      version: SCRIPT_VERSION,
      state: 'stopped',
      riotClient: false,
      stoppedBy: signal,
    });
  }
  await lolWatcher.markInactive();
  await lolWatcher.markClientOffline();
  releaseOwnedInstanceLock();
  process.exit(0);
}

process.on('SIGINT', () => markSessionInactiveAndExit('SIGINT'));
process.on('SIGTERM', () => markSessionInactiveAndExit('SIGTERM'));
