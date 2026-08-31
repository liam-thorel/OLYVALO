/**
 * SONDE — loadouts (skins) des joueurs d'une partie Valorant en cours.
 *
 * Lecture seule : rien n'est publié vers Firebase, rien n'est modifié sur le
 * PC. Le but est de répondre à une seule question avant de construire quoi que
 * ce soit dessus : l'endpoint des loadouts renvoie-t-il AUSSI les adversaires,
 * ou seulement l'équipe alliée ?
 *
 * À lancer pendant une partie (pas en agent select : les loadouts adverses
 * n'existent qu'une fois la game lancée).
 *
 *   node probe-loadouts.js
 *
 * Écrit un rapport lisible dans la console et le JSON brut dans
 * sonde-loadouts.json, à côté du script.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const LOCKFILE_PATHS = [
  path.join(process.env.LOCALAPPDATA || '', 'Riot Games', 'Riot Client', 'Config', 'lockfile'),
  path.join(process.env.APPDATA || '', '..', 'Local', 'Riot Games', 'Riot Client', 'Config', 'lockfile'),
];

const CLIENT_PLATFORM = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

function readLockfile() {
  for (const p of LOCKFILE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const [, , port, password] = fs.readFileSync(p, 'utf8').trim().split(':');
        return { port: Number.parseInt(port, 10), password };
      }
    } catch { /* chemin suivant */ }
  }
  return null;
}

function localGet(port, password, endpoint) {
  const auth = Buffer.from(`riot:${password}`).toString('base64');
  return new Promise(resolve => {
    const r = https.get({
      hostname: '127.0.0.1', port, path: endpoint,
      agent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 3000,
      headers: { Authorization: `Basic ${auth}` },
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    r.on('error', () => resolve({ status: 0, data: null }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, data: null }); });
  });
}

// Renvoie { status, data } — le status compte autant que le corps ici : c'est
// lui qui distingue « Riot a fermé l'endpoint » de « pas en partie ».
function glzGet(tokens, apiPath) {
  return new Promise(resolve => {
    const r = https.get({
      hostname: `glz-${tokens.region}-1.${tokens.region}.a.pvp.net`,
      path: apiPath,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Riot-Entitlements-JWT': tokens.entitlementsToken,
        'X-Riot-ClientPlatform': CLIENT_PLATFORM,
        'X-Riot-ClientVersion': tokens.clientVersion,
        'User-Agent': 'ShooterGame/13 Windows/10.0.19041.1.256.64bit',
      },
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: null, raw: d.slice(0, 200) }); }
      });
    });
    r.on('error', error => resolve({ status: 0, data: null, raw: error.message }));
    r.setTimeout(5000, () => { r.destroy(); resolve({ status: 0, data: null, raw: 'délai dépassé' }); });
  });
}

function publicJson(url) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (error) { reject(error); }
      });
    });
    r.setTimeout(8000, () => r.destroy(new Error('délai dépassé')));
    r.on('error', reject);
  });
}

// Le format exact des loadouts n'est pas garanti : on explore l'objet plutôt
// que de supposer une profondeur. Renvoie tous les UUID rencontrés sous une
// clé "Item", c'est-à-dire les objets réellement équipés.
function collectEquippedIds(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach(child => collectEquippedIds(child, found));
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'Item' && value && typeof value.ID === 'string') found.add(value.ID.toLowerCase());
    collectEquippedIds(value, found);
  }
  return found;
}

// Cherche un PUUID à n'importe quelle profondeur : si les loadouts en portent
// un, le rattachement joueur→skins ne dépend plus de l'ordre du tableau.
function findSubject(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  for (const key of ['Subject', 'subject', 'PlayerID', 'Puuid', 'PUUID']) {
    if (typeof node[key] === 'string' && node[key].includes('-')) return node[key];
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findSubject(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const line = () => console.log('─'.repeat(64));

// Exporté pour tests/probe-loadouts.test.cjs : la sonde n'est lançable que sur
// un PC en partie, mais son analyse de la réponse doit être vérifiable ici. Une
// erreur de lecture donnerait une fausse réponse à « a-t-on les ennemis ? ».
module.exports = { collectEquippedIds, findSubject };
if (require.main !== module) return;

(async () => {
  console.log('\n🔍 SONDE — skins des joueurs en partie\n');

  const lock = readLockfile();
  if (!lock) {
    console.log('❌ Riot Client introuvable (lockfile absent). Lance Valorant, puis relance la sonde.');
    return;
  }

  const ent = await localGet(lock.port, lock.password, '/entitlements/v1/token');
  const regionRes = await localGet(lock.port, lock.password, '/riotclient/region-locale');
  if (!ent.data?.accessToken) {
    console.log('❌ Impossible de récupérer les jetons d’authentification locaux.');
    return;
  }

  const rawRegion = String(regionRes.data?.region || regionRes.data?.webRegion || 'EU').toUpperCase();
  const region = rawRegion.startsWith('EU') ? 'eu' : rawRegion === 'NA' ? 'na'
    : rawRegion === 'LATAM' ? 'latam' : rawRegion === 'BR' ? 'br'
      : rawRegion === 'AP' ? 'ap' : rawRegion === 'KR' ? 'kr' : 'eu';

  const versionRes = await publicJson('https://valorant-api.com/v1/version').catch(() => null);
  const tokens = {
    accessToken: ent.data.accessToken,
    entitlementsToken: ent.data.token || '',
    puuid: ent.data.subject || '',
    region,
    clientVersion: versionRes?.data?.riotClientVersion || 'unknown',
  };
  console.log(`✅ Authentifié · région ${region} · client ${tokens.clientVersion}`);

  const player = await glzGet(tokens, `/core-game/v1/players/${tokens.puuid}`);
  const matchId = player.data?.MatchID;
  if (!matchId) {
    console.log(`\n❌ Aucune partie en cours (HTTP ${player.status}).`);
    console.log('   La sonde doit tourner PENDANT une game — pas en agent select,');
    console.log('   les loadouts adverses n’existent qu’une fois la partie lancée.');
    return;
  }
  console.log(`✅ Partie en cours · ${matchId}`);

  const match = await glzGet(tokens, `/core-game/v1/matches/${matchId}`);
  const players = match.data?.Players || [];
  const myTeam = players.find(p => p.Subject === tokens.puuid)?.TeamID || null;
  console.log(`✅ ${players.length} joueurs dans la partie · mon équipe : ${myTeam || '?'}`);

  line();
  console.log('LA QUESTION : les loadouts adverses sont-ils renvoyés ?');
  line();

  const loadouts = await glzGet(tokens, `/core-game/v1/matches/${matchId}/loadouts`);
  console.log(`\nGET /core-game/v1/matches/{id}/loadouts → HTTP ${loadouts.status}`);

  if (loadouts.status !== 200 || !loadouts.data) {
    console.log('\n❌ RÉPONSE : l’endpoint ne répond pas comme attendu.');
    console.log(`   Corps : ${loadouts.raw || JSON.stringify(loadouts.data)?.slice(0, 200) || '(vide)'}`);
    console.log('\n   Si c’est un 404 ou un 403, Riot a probablement fermé l’accès :');
    console.log('   la fonctionnalité n’est alors pas réalisable, et on s’arrête là.');
    fs.writeFileSync(path.join(__dirname, 'sonde-loadouts.json'),
      JSON.stringify({ matchId, status: loadouts.status, raw: loadouts.raw || null }, null, 2));
    return;
  }

  const list = loadouts.data.Loadouts || loadouts.data.loadouts || [];
  console.log(`   ${list.length} loadout(s) renvoyé(s) pour ${players.length} joueur(s)`);

  // Rattachement : soit le loadout porte un PUUID, soit on s'aligne sur
  // l'ordre du tableau Players — le probe dit lequel des deux est disponible.
  const bySubject = list.map(entry => findSubject(entry));
  const carriesSubject = bySubject.filter(Boolean).length;
  console.log(`   ${carriesSubject}/${list.length} portent un PUUID identifiable`);
  console.log(carriesSubject === list.length
    ? '   → rattachement direct par PUUID, l’ordre du tableau n’a pas d’importance'
    : '   → rattachement par POSITION dans le tableau (même index que Players)');

  const teamOfIndex = index => {
    const subject = bySubject[index];
    const player2 = subject
      ? players.find(p => p.Subject === subject)
      : players[index];
    return player2?.TeamID || '?';
  };

  const teams = list.map((_, index) => teamOfIndex(index));
  const allies = teams.filter(t => t === myTeam).length;
  const enemies = teams.filter(t => t !== myTeam && t !== '?').length;

  console.log(`\n   Alliés  : ${allies}`);
  console.log(`   Ennemis : ${enemies}`);

  line();
  if (enemies > 0) {
    console.log('✅ RÉPONSE : OUI — les skins des adversaires sont accessibles.');
  } else if (list.length > 0) {
    console.log('⚠️  RÉPONSE : NON — seuls les alliés sont renvoyés.');
    console.log('   Affichable pour l’équipe OLYCITY, mais pas pour les ennemis.');
  } else {
    console.log('❌ RÉPONSE : aucun loadout renvoyé.');
  }
  line();

  // ─── Ce qu'on pourrait afficher, et ce que ça pèse ────────────────────────
  const equipped = collectEquippedIds(list);
  console.log(`\n📦 ${equipped.size} objets équipés distincts trouvés dans la réponse.`);

  const [skinLevels, weapons] = await Promise.all([
    publicJson('https://valorant-api.com/v1/weapons/skinlevels').catch(() => null),
    publicJson('https://valorant-api.com/v1/weapons').catch(() => null),
  ]);

  if (skinLevels?.data) {
    const byId = new Map(skinLevels.data.map(s => [s.uuid.toLowerCase(), s]));
    const resolved = [...equipped].map(id => byId.get(id)).filter(Boolean);
    console.log(`   dont ${resolved.length} résolus en skins nommés via valorant-api.com`);
    console.log(`   (images disponibles : ${resolved.filter(s => s.displayIcon).length})`);
    console.log('\n   Échantillon :');
    resolved.slice(0, 12).forEach(skin => {
      console.log(`     · ${skin.displayName}`);
    });
    if (resolved.length === 0) {
      console.log('     (aucun — la structure diffère de celle attendue, voir le JSON brut)');
    }
  } else {
    console.log('   ⚠️ valorant-api.com injoignable : résolution des noms non vérifiée.');
  }

  // Le site ne peut pas recevoir 10 loadouts complets à chaque poll : on mesure
  // le coût réel pour décider quoi publier.
  const fullBytes = Buffer.byteLength(JSON.stringify(list));
  console.log(`\n📏 Charge utile brute : ${(fullBytes / 1024).toFixed(1)} Ko pour ${list.length} joueurs`);
  console.log(`   → ${(fullBytes / Math.max(list.length, 1) / 1024).toFixed(1)} Ko par joueur si on publiait tout.`);
  if (weapons?.data) {
    console.log(`   ${weapons.data.length} armes au catalogue — un sous-ensemble (couteau + arme`);
    console.log('   principale) suffirait probablement pour l’affichage sur le site.');
  }

  const out = path.join(__dirname, 'sonde-loadouts.json');
  fs.writeFileSync(out, JSON.stringify({
    matchId,
    myTeam,
    players: players.map(p => ({ subject: p.Subject, team: p.TeamID, character: p.CharacterID })),
    loadoutsStatus: loadouts.status,
    loadouts: loadouts.data,
  }, null, 2));

  console.log(`\n💾 JSON brut écrit dans :\n   ${out}`);
  console.log('\n⚠️  Ce fichier contient les PUUID des 10 joueurs de la partie.');
  console.log('   Envoie-le en privé, ne le publie pas tel quel.\n');
})().catch(error => {
  console.error('\n❌ Erreur inattendue :', error.message);
  console.error(error.stack);
});
