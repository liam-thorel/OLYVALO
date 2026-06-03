const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

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
    const netstat = execSync('netstat -ano -p TCP 2>nul', { timeout: 3000 }).toString();
    const lines = netstat.split('\n');

    // Get VALORANT PID
    let valorantPid = null;
    try {
      const tasklist = execSync('tasklist /FI "IMAGENAME eq VALORANT-Win64-Shipping.exe" /FO CSV /NH 2>nul', { timeout: 2000 }).toString();
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
  'Jam':'Split','Bonsai':'Ascent','Triad':'Haven','Duality':'Bind',
  'Foxtrot':'Breeze','Canyon':'Fracture','Pitt':'Pearl','Lotus':'Lotus',
  'Range':'Range','Juliett':'Sunset','Infinity':'Icebox','Poveglia':'Abyss',
  'Whisper':'Abyss',
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
        try { resolve({ ok:true, status:res.statusCode, data:JSON.parse(d) }); }
        catch { resolve({ ok:false, err:'parse error', raw:d.slice(0,100) }); }
      });
    });
    r.on('error', e => resolve({ ok:false, err:e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ ok:false, err:'timeout' }); });
  });
}

function putFB(path, data) {
  const body = JSON.stringify(data);
  return new Promise(resolve => {
    const r = https.request({
      hostname:'realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
      path:`/${path}.json`, method:'PUT',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res => { res.on('data',()=>{}); res.on('end',resolve); });
    r.on('error', ()=>resolve());
    r.write(body); r.end();
  });
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
https.get('https://valorant-api.com/v1/agents?isPlayableCharacter=true', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const data = JSON.parse(d);
      data.data?.forEach(a => {
        AGENT_UUIDS[a.uuid.toLowerCase()] = a.displayName;
      });
      console.log(`[init] ✅ ${Object.keys(AGENT_UUIDS).length} agents chargés`);
    } catch {}
  });
}).on('error', () => {});

// Fallback static UUIDs
const AGENT_UUIDS_FALLBACK = {
  'e370fa57-4757-3604-3648-499e1f642d3f':'Gekko','569fdd95-4d10-43ab-ca70-79becc718b46':'Ghost',
  '6f2a04ca-43e0-be17-7f36-b3908627744d':'Skye','117ed9e3-49f3-6512-3ccf-0cada7e3823b':'Cypher',
  '320b2a48-4d9b-a075-30f1-1f93a9b638fa':'Sova','1e58de9c-4950-5125-93e9-a0aee9f98746':'Killjoy',
  '707eab51-4836-f488-046a-cda6bf494859':'Viper','eb93336a-449b-9c1e-0ac7-dc5b18b7d752':'Phoenix',
  '41fb69c1-4189-7b37-f117-bcaf1e96f1bf':'Astra','9f0d8ba9-4140-b941-57d3-a7ad57c6b417':'Brimstone',
  'bb2a4828-46eb-8cd1-e765-15848195d751':'Neon','0e38b510-41a8-5780-5e8f-568b2a4f2d6c':'Yoru',
  '601dbbe7-43ce-be57-2a40-4abd24953621':'Kay/O','22697a3d-45bf-8dd7-4fec-84a9e28c69d7':'Chamber',
  '95b78ed7-4637-86d9-7e41-71ba8c293152':'Harbor','e54d6684-0f09-a7e7-b67d-d6fb82225a35':'Fade',
  '1dbf2edd-4729-0984-3115-daa5eed44993':'Breach','add6443a-41bd-e414-f6ad-e58d267f4e95':'Jett',
  '117ed9e3-49f3-6512-3ccf-0cada7e3823b':'Cypher','dade69b4-4f5a-8528-247b-219e5a1facd6':'Raze',
  'f94c3b30-42be-e959-889c-5aa313dba261':'Reyna','8e253930-4c05-31dd-1b6c-968525494517':'Omen',
  '7f94d92c-4234-0a36-9646-3a87eb8b5eec':'Yoru','de19439c-40cc-8b6e-f2de-5e2b7507f659':'Miks',
  '39e54099-c384-7dc1-a8e0-2cfe2c9c3c5a':'Sage','5f8d3a7f-467b-97f3-062c-13acf203c006':'Waylay',
  'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc':'Clove','efba5359-4016-a1e5-7626-b1ae1a4aab37':'Vyse',
};
// Merge fallback into dynamic dict immediately
Object.assign(AGENT_UUIDS, AGENT_UUIDS_FALLBACK);

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
        if (res.statusCode !== 200) {
          console.log(`[pdGet] ${res.statusCode} pd.${tokens.region}.a.pvp.net${apiPath}: ${d.slice(0,80)}`);
          resolve(null); return;
        }
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    r.on('error', e => { console.log(`[pdGet] error: ${e.message}`); resolve(null); });
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
          console.log(`[pvpGet] ${res.statusCode} ${url.hostname}${apiPath}: ${d.slice(0,80)}`);
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
let authTokens = null;
let wsConnected = false;
let lastPlayerCount = -1;
let lastScore = '';
let roundPhase = '';
let roundStartTime = null;

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
          putFB('live/score', score).catch(()=>{});
        }
      }

      // Kill feed from MUC messages
      if (uri.includes('messaging-service') && payload?.Body) {
        try {
          const body = JSON.parse(payload.Body);
          if (body?.kills) {
            putFB('live/lastKills', body.kills).catch(()=>{});
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
let tries = 0;

async function poll() {
  const lock = readLockfile();
  if (!lock) {
    tries++;
    if (tries % 10 === 1) console.log(`[${ts()}] ⏳ Riot Client non détecté`);
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
    return;
  }
  tries = 0;

  // Get own PUUID to filter only self presence
  if (!selfPuuid) {
    const session = await req(lock.port, lock.password, '/chat/v1/session');
    if (session.ok && session.data?.puuid) {
      selfPuuid = session.data.puuid;
      console.log(`[${ts()}] 👤 PUUID détecté: ${selfPuuid.slice(0,8)}...`);
    }
  }

  const presences = res.data?.presences || [];

  // Filter: only self presence, or first one if PUUID unknown
  const myPresences = selfPuuid
    ? presences.filter(p => p.puuid === selfPuuid)
    : presences.slice(0, 1);

  let found = null;
  let playerName = '';
  let matchData = null;

  // Also scan all presences for OLYCITY roster games
  const OLYCITY_ROSTER = ['Drew A Picasso', 'Wong Chi Ming', 'RayBaz', 'MrScooby', 'baby hayabusa', 'VENOM X RAMEEZ'];
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

  // Determine if in game
  const location   = found?.location || '';
  const mode       = (found?.mode || '').replace('social_mode_','');
  const mapRaw     = location.replace('social_location_','').split('/').pop() || matchData?.matchMap?.split('/')?.pop() || '';
  const mapDisplay = MAP_NAMES[mapRaw] || mapRaw || '';
  const queueId    = matchData?.queueId || mode || '';
  const isInGame   = !!(mapRaw && mapRaw !== 'Range' && mapRaw !== '');

  if (!isInGame) {
    if (inGame) {
      inGame = false;
      lastMap = '';
      console.log(`[${ts()}] 🏠 Fin de game`);
      await putFB('live', { active:false, ts:Date.now() });
    }
    return;
  }

  if (!inGame || mapRaw !== lastMap) {
    inGame   = true;
    lastMap  = mapRaw;
    matchDataLogged = false;
    gameDataLogged = false;
    authTokens = null;
    connectWebSocket(lock.port, lock.password);
    console.log(`[${ts()}] 🎮 EN GAME — ${mapDisplay} (${mapRaw}) | ${queueId} | ${playerName}`);
  }

  // Get auth tokens from Riot Client for PVP.net API
  let players = [];
  if (!authTokens) {
    // /entitlements/v1/token has everything: accessToken, token (entitlements), subject (PUUID)
    const entRes   = await req(lock.port, lock.password, '/entitlements/v1/token');
    const regionRes = await req(lock.port, lock.password, '/riotclient/region-locale');

    if (entRes.ok && entRes.data?.accessToken) {
      // EUW/EUNE → eu, NA/LATAM/BR → na, AP → ap
      const rawRegion = (regionRes.data?.region || regionRes.data?.webRegion || 'EUW').toUpperCase();
      const region = rawRegion.startsWith('EU') ? 'eu' : rawRegion === 'NA' ? 'na' :
                     rawRegion === 'LATAM' ? 'latam' : rawRegion === 'BR' ? 'br' :
                     rawRegion === 'AP' ? 'ap' : rawRegion === 'KR' ? 'kr' : 'eu';
      authTokens = {
        accessToken:       entRes.data.accessToken,
        entitlementsToken: entRes.data.token || '',
        puuid:             entRes.data.subject || selfPuuid || '',
        region,
      };
      console.log(`[${ts()}] ✅ Auth OK — région: ${region} (${rawRegion}) | PUUID: ${authTokens.puuid.slice(0,8)}`);
    } else {
      console.log(`[${ts()}] ❌ Entitlements échoué: ${JSON.stringify(entRes.data||'').slice(0,80)}`);
    }
  }

  // Fetch current match from PVP.net
  if (authTokens && isInGame) {
    try {
      // Try core-game first, then pre-game
      let matchData = await pvpGet(authTokens, `/core-game/v1/players/${authTokens.puuid}`);

      if (!matchData?.MatchID) {
        matchData = await pvpGet(authTokens, `/pregame/v1/players/${authTokens.puuid}`);

      }
      if (matchData?.MatchID) {
        const match = await pvpGet(authTokens, `/core-game/v1/matches/${matchData.MatchID}`);

        if (match?.Players) {
          // Fetch player names from name service
          const puuids = match.Players.map(p => p.Subject).filter(Boolean);
          let nameMap = {};
          let rankMap = {};
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

          // Fetch ranks via competitiveupdates (works in-game)
          try {
            await Promise.all(puuids.map(async puuid => {
              const r = await pdGet(authTokens, `/mmr/v1/players/${puuid}/competitiveupdates?startIndex=0&endIndex=1&queue=competitive`);
              if (r?.Matches?.length > 0) {
                const last = r.Matches[0];
                rankMap[puuid] = {
                  tier: last.TierAfterUpdate,
                  rr:   last.RankedRatingAfterUpdate || 0,
                };
              }
            }));
            const ranked = Object.keys(rankMap).length;
            if (ranked > 0) console.log(`[${ts()}] 🏅 Rangs: ${ranked}/${puuids.length}`);
          } catch(e) {
            console.log(`[${ts()}] ⚠️  Ranks: ${e.message}`);
          }

          // Extract score
          const teams = match.Teams || [];
          const blueScore = teams.find(t => t.TeamID === 'Blue')?.Score || 0;
          const redScore  = teams.find(t => t.TeamID === 'Red')?.Score || 0;
          await putFB('live/score', { blue: blueScore, red: redScore });

          players = match.Players.map(p => {
            // Match agent UUID (first 8 chars)
            const charId = (p.CharacterID || '').toLowerCase();
            const agentName = AGENT_UUIDS[charId] ||
              Object.entries(AGENT_UUIDS).find(([k]) => charId.startsWith(k.slice(0,8)))?.[1] ||
              charId.slice(0,8) || '?';
            return {
              name:    nameMap[p.Subject] || p.Subject?.slice(0,8) || '?',
              puuid:   p.Subject || '',
              agent:   agentName,
              team:    p.TeamID === 'Blue' ? 'ORDER' : 'CHAOS',
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

  await putFB('live', {
    active:      true,
    ts:          Date.now(),
    map:         mapRaw,
    mapDisplay:  mapDisplay,
    mapInternal: mapRaw,
    mapClean:    mapDisplay,
    mode:        queueId,
    playerName:  playerName,
    players,
    activePlayer,
  });

  if (!inGame || players.length !== lastPlayerCount) {
    lastPlayerCount = players.length;
    console.log(`[${ts()}] ✅ ${mapDisplay} | ${queueId} | ${players.length} joueurs | WS:${wsConnected?'✓':'✗'}`);
  }
}

console.log('\n  ╔══════════════════════════════╗');
console.log('  ║  OLYCITY LIVE v4  🔴         ║');
console.log('  ╚══════════════════════════════╝\n');

setInterval(poll, 2000);
poll();
