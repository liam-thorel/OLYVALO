"""
OLYCITY LIVE — Valorant → Firebase
Script Python, buildable en .exe avec PyInstaller
"""
import os, json, time, ssl, threading, base64
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError
from urllib.parse import urlparse
import http.client, socket

# ─── Config ──────────────────────────────────────────
FIREBASE_URL = "realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app"
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def ts():
    return time.strftime("%H:%M:%S")

def log(msg):
    print(f"[{ts()}] {msg}", flush=True)

# ─── Lockfile ────────────────────────────────────────
LOCKFILE_PATHS = [
    Path(os.environ.get("LOCALAPPDATA","")) / "Riot Games" / "Riot Client" / "Config" / "lockfile",
    Path(os.environ.get("APPDATA","")) / ".." / "Local" / "Riot Games" / "Riot Client" / "Config" / "lockfile",
]

def read_lockfile():
    for p in LOCKFILE_PATHS:
        try:
            if p.exists():
                parts = p.read_text().strip().split(":")
                return {"port": int(parts[2]), "password": parts[3]}
        except: pass
    return None

# ─── HTTPS helpers ───────────────────────────────────
def riot_get(port, password, path):
    try:
        auth = base64.b64encode(f"riot:{password}".encode()).decode()
        conn = http.client.HTTPSConnection("127.0.0.1", port, context=SSL_CTX, timeout=3)
        conn.request("GET", path, headers={"Authorization": f"Basic {auth}"})
        r = conn.getresponse()
        return json.loads(r.read()) if r.status == 200 else None
    except: return None

def pvp_get(tokens, path):
    try:
        region = tokens.get("region","eu")
        host = f"glz-{region}-1.{region}.a.pvp.net"
        conn = http.client.HTTPSConnection(host, 443, context=SSL_CTX, timeout=5)
        conn.request("GET", path, headers={
            "Authorization": f"Bearer {tokens['accessToken']}",
            "X-Riot-Entitlements-JWT": tokens.get("entitlementsToken",""),
            "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9",
        })
        r = conn.getresponse()
        if r.status == 200: return json.loads(r.read())
        if r.status not in (404,): log(f"pvpGet {r.status} {path[:50]}")
        return None
    except Exception as e:
        if "NOTFOUND" not in str(e) and "refused" not in str(e).lower(): log(f"pvpGet err: {e}")
        return None

def pd_get(tokens, path):
    try:
        region = tokens.get("region","eu")
        host = f"pd.{region}.a.pvp.net"
        conn = http.client.HTTPSConnection(host, 443, context=SSL_CTX, timeout=5)
        conn.request("GET", path, headers={
            "Authorization": f"Bearer {tokens['accessToken']}",
            "X-Riot-Entitlements-JWT": tokens.get("entitlementsToken",""),
            "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9",
        })
        r = conn.getresponse()
        if r.status == 200: return json.loads(r.read())
        return None
    except: return None

def pd_put(tokens, path, body):
    try:
        region = tokens.get("region","eu")
        host = f"pd.{region}.a.pvp.net"
        data = json.dumps(body).encode()
        conn = http.client.HTTPSConnection(host, 443, context=SSL_CTX, timeout=5)
        conn.request("PUT", path, body=data, headers={
            "Authorization": f"Bearer {tokens['accessToken']}",
            "X-Riot-Entitlements-JWT": tokens.get("entitlementsToken",""),
            "Content-Type": "application/json",
            "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9",
        })
        r = conn.getresponse()
        if r.status == 200: return json.loads(r.read())
        return None
    except: return None

def put_firebase(path, data):
    try:
        body = json.dumps(data).encode()
        conn = http.client.HTTPSConnection(FIREBASE_URL, 443, context=ssl.create_default_context(), timeout=5)
        conn.request("PUT", f"/{path}.json", body=body, headers={"Content-Type":"application/json"})
        conn.getresponse().read()
    except: pass

# ─── Agent names from API ─────────────────────────────
AGENT_UUIDS = {}
def load_agents():
    global AGENT_UUIDS
    try:
        r = urlopen("https://valorant-api.com/v1/agents?isPlayableCharacter=true", timeout=5)
        d = json.loads(r.read())
        for a in d.get("data",[]):
            AGENT_UUIDS[a["uuid"].lower()] = a["displayName"]
        log(f"✅ {len(AGENT_UUIDS)} agents chargés")
    except: pass

MAP_NAMES = {
    "Jam":"Split","Bonsai":"Ascent","Triad":"Haven","Duality":"Bind",
    "Foxtrot":"Breeze","Canyon":"Fracture","Pitt":"Pearl","Lotus":"Lotus",
    "Range":"Range","Juliett":"Sunset","Infinity":"Icebox","Poveglia":"Abyss",
}

# ─── State ───────────────────────────────────────────
state = {
    "in_game": False, "stable_key": None, "auth": None,
    "ranks_loaded": False, "rank_map": {}, "last_map": "",
    "missed_polls": 0, "last_player_count": -1,
    "game_data_logged": False, "last_score": "",
    "client_version": "unknown",
}

def decode_b64(s):
    try: return json.loads(base64.b64decode(s).decode("utf-8","ignore"))
    except:
        try: return json.loads(s)
        except: return None

def poll():
    lock = read_lockfile()
    if not lock:
        if not hasattr(poll,"_warned"):
            log("⏳ Riot Client non détecté")
            poll._warned = True
        return
    
    if getattr(poll,"_last_port",None) != lock["port"]:
        poll._last_port = lock["port"]
        state["auth"] = None
        log(f"✅ Riot Client — port {lock['port']}")
    
    # Self PUUID
    if not state["stable_key"]:
        s = riot_get(lock["port"], lock["password"], "/chat/v1/session")
        if s and s.get("puuid"):
            state["stable_key"] = s["puuid"]
            log(f"👤 PUUID: {state['stable_key'][:8]}...")
    
    # Presence
    pres = riot_get(lock["port"], lock["password"], "/chat/v4/presences")
    if not pres: return
    
    # Find own game data
    found = None
    player_name = ""
    match_data = None
    for p in pres.get("presences",[]):
        if p.get("game_name"): player_name = f"{p['game_name']}#{p['game_tag']}"
        for val in p.values():
            if not isinstance(val, str) or len(val) < 10: continue
            d = decode_b64(val)
            if not d: continue
            if d.get("location") and d.get("mode"): found = d
            if d.get("matchPresenceData"): match_data = d["matchPresenceData"]
    
    location = found.get("location","") if found else ""
    map_raw = location.replace("social_location_","").split("/")[-1] if location else ""
    map_display = MAP_NAMES.get(map_raw, map_raw)
    mode = (found.get("mode","") if found else "").replace("social_mode_","")
    is_in_game = bool(map_raw and map_raw != "Range")
    
    if not is_in_game:
        state["missed_polls"] = state.get("missed_polls",0) + 1
        if state["in_game"] and state["missed_polls"] >= 3:
            state.update({"in_game":False,"last_map":"","missed_polls":0,"ranks_loaded":False,"rank_map":{},"game_data_logged":False,"auth":None})
            log("🏠 Fin de game")
            if state["stable_key"]:
                put_firebase(f"live/sessions/{state['stable_key']}", {"active":False,"ts":int(time.time()*1000),"playerName":player_name})
        return
    
    state["missed_polls"] = 0
    
    if not state["in_game"] or map_raw != state["last_map"]:
        state.update({"in_game":True,"last_map":map_raw,"game_data_logged":False,"auth":None,"ranks_loaded":False,"rank_map":{}})
        log(f"🎮 EN GAME — {map_display} ({map_raw}) | {mode} | {player_name}")
    
    if not state["stable_key"]: return
    
    # Auth tokens
    if not state["auth"]:
        ent = riot_get(lock["port"], lock["password"], "/entitlements/v1/token")
        reg = riot_get(lock["port"], lock["password"], "/riotclient/region-locale")
        if ent and ent.get("accessToken"):
            raw_region = (reg.get("region","EUW") if reg else "EUW").upper()
            region = {"EU":"eu","EUW":"eu","EUNE":"eu","NA":"na","AP":"ap","KR":"kr","LATAM":"latam","BR":"br"}.get(raw_region,"eu")
            state["auth"] = {
                "accessToken": ent["accessToken"],
                "entitlementsToken": ent.get("token",""),
                "puuid": ent.get("subject", state["stable_key"]),
                "region": region,
                "clientVersion": state["client_version"],
            }
            log(f"✅ Auth OK — région: {region} ({raw_region})")
    
    # Match data
    players = []
    if state["auth"]:
        match = pvp_get(state["auth"], f"/core-game/v1/players/{state['auth']['puuid']}")
        if match and match.get("MatchID"):
            match_info = pvp_get(state["auth"], f"/core-game/v1/matches/{match['MatchID']}")
            if match_info and match_info.get("Players"):
                puuids = [p["Subject"] for p in match_info["Players"] if p.get("Subject")]
                
                # Names
                name_map = {}
                names_res = pd_put(state["auth"], "/name-service/v2/players", puuids)
                if isinstance(names_res, list):
                    for n in names_res:
                        if n.get("GameName"): name_map[n["Subject"]] = f"{n['GameName']}#{n['TagLine']}"
                
                for p in match_info["Players"]:
                    char_id = (p.get("CharacterID","")).lower()
                    agent = AGENT_UUIDS.get(char_id) or next((v for k,v in AGENT_UUIDS.items() if char_id.startswith(k[:8])), char_id[:8])
                    players.append({
                        "name": name_map.get(p["Subject"], p["Subject"][:8]),
                        "puuid": p["Subject"],
                        "agent": agent,
                        "team": "ORDER" if p.get("TeamID","") == "Blue" else "CHAOS",
                        "alive": True, "hp": 100, "maxHp": 150,
                        "incognito": p["Subject"] not in name_map,
                        "rank": state["rank_map"].get(p["Subject"]),
                    })
                
                if not state["game_data_logged"]:
                    state["game_data_logged"] = True
                    log(f"🎯 Match data: {len(players)} joueurs trouvés")
                    for pl in players: log(f"   {'🔵' if pl['team']=='ORDER' else '🔴'} {pl['name']} — {pl['agent']}")
                
                # Ranks (once)
                if not state["ranks_loaded"] and len(puuids) > 1:
                    state["ranks_loaded"] = True
                    def fetch_ranks(puuids_copy, auth_copy):
                        time.sleep(2)
                        count = 0
                        for puuid in puuids_copy:
                            time.sleep(0.5)
                            r = pd_get(auth_copy, f"/mmr/v1/players/{puuid}/competitiveupdates?startIndex=0&endIndex=1&queue=competitive")
                            if r and r.get("Matches"):
                                last = r["Matches"][0]
                                state["rank_map"][puuid] = {"tier": last.get("TierAfterUpdate",0), "rr": last.get("RankedRatingAfterUpdate",0)}
                                count += 1
                        if count: log(f"🏅 Rangs chargés: {count}/{len(puuids_copy)}")
                    threading.Thread(target=fetch_ranks, args=(puuids.copy(), dict(state["auth"])), daemon=True).start()
    
    count = len(players)
    if count != state["last_player_count"]:
        state["last_player_count"] = count
        log(f"✅ {map_display} | {mode} | {count} joueurs")
    
    # Push to Firebase
    put_firebase(f"live/sessions/{state['stable_key']}", {
        "active": True,
        "ts": int(time.time() * 1000),
        "map": map_raw,
        "mapClean": map_display,
        "mapInternal": map_raw,
        "mode": mode,
        "matchId": match_data.get("matchMap","") if match_data else "",
        "playerName": player_name,
        "players": players,
        "activePlayer": {"name": player_name, "agent": "", "hp": 100, "maxHp": 150},
    })

# ─── Main ─────────────────────────────────────────────
if __name__ == "__main__":
    print()
    print("  OLYCITY LIVE")
    print("  ========================")
    print("  Valorant -> Firebase -> Site")
    print()
    print("  En attente de Valorant...")
    print("  Ctrl+C pour arreter.")
    print()
    
    threading.Thread(target=load_agents, daemon=True).start()
    
    # Load client version
    try:
        r = urlopen("https://valorant-api.com/v1/version", timeout=5)
        d = json.loads(r.read())
        state["client_version"] = d.get("data",{}).get("riotClientVersion","unknown")
        log(f"✅ Client version: {state['client_version'].split('-')[0]}")
    except: pass
    
    while True:
        try:
            poll()
        except Exception as e:
            pass
        time.sleep(2)
