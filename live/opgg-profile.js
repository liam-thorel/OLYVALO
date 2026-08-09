const https = require('https');

const OP_GG_HOST = 'op.gg';
const SOLO_QUEUE = 'SOLORANKED';

function decodeEntities(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractJsonObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function flightChunks(html) {
  const chunks = [];
  const pattern = /<script[^>]*>self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g;
  let match;
  while ((match = pattern.exec(html))) {
    try { chunks.push(JSON.parse(match[1])); } catch {}
  }
  return chunks;
}

function findSoloQueueData(html) {
  const candidates = [];
  for (const chunk of flightChunks(html)) {
    let offset = 0;
    while ((offset = chunk.indexOf('"data":{', offset)) >= 0) {
      const start = offset + '"data":'.length;
      const source = extractJsonObject(chunk, start);
      offset = start + 1;
      if (!source || !source.includes('"my_champion_stats"')) continue;
      try {
        const data = JSON.parse(source);
        if (data.game_type === SOLO_QUEUE && Array.isArray(data.my_champion_stats)) candidates.push(data);
      } catch {}
    }
  }
  return candidates.sort((left, right) => Number(right.season_id || 0) - Number(left.season_id || 0))[0] || null;
}

function rankFromDescription(html) {
  const encoded = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || '';
  const description = decodeEntities(encoded);
  const tierMatch = description.match(/\/\s*(Iron|Bronze|Silver|Gold|Platinum|Emerald|Diamond|Master|Grandmaster|Challenger)\s+([^/]+?)LP\s*\/\s*(\d+)Win\s+(\d+)Lose/i);
  if (!tierMatch) return null;
  const tier = tierMatch[1].toUpperCase();
  const values = [...tierMatch[2].matchAll(/\d+/g)].map(match => Number(match[0]));
  const wins = Number(tierMatch[3]);
  const losses = Number(tierMatch[4]);
  const divisions = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
  return {
    tier,
    division: ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : (divisions[values[0]] || ''),
    lp: values.at(-1) ?? null,
    wins,
    losses,
    games: wins + losses,
    winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
  };
}

function parseOpggSoloProfile(html, riotId = '') {
  const data = findSoloQueueData(html);
  if (!data) {
    const title = decodeEntities(html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || '');
    if (riotId && title.toLocaleLowerCase().includes(riotId.toLocaleLowerCase())) {
      return {
        playerName: riotId,
        rank: null,
        soloQueue: { games: 0, wins: 0, losses: 0, winRate: 0 },
        topChampions: [],
        seasonId: 0,
        source: 'op.gg',
        seasonVerified: true,
      };
    }
    throw new Error(`Statistiques SoloQ OP.GG introuvables pour ${riotId || 'ce compte'}`);
  }
  const aggregate = data.my_champion_stats.find(champion => Number(champion.id) === 0) || {};
  const games = Number(data.play ?? aggregate.play ?? 0);
  const wins = Number(data.win ?? aggregate.win ?? 0);
  const losses = Number(data.lose ?? aggregate.lose ?? Math.max(0, games - wins));
  const topChampions = data.my_champion_stats
    .filter(champion => Number(champion.id) > 0 && champion.name)
    .sort((left, right) => Number(right.play || 0) - Number(left.play || 0) || Number(right.win_rate || 0) - Number(left.win_rate || 0))
    .slice(0, 3)
    .map(champion => ({
      championId: Number(champion.champion_id || champion.id),
      name: champion.name,
      image: String(champion.image_url || '').replace(
        /^https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/([^/]+)\/champion\//,
        'https://ddragon.leagueoflegends.com/cdn/$1/img/champion/',
      ),
      games: Number(champion.play || 0),
      wins: Number(champion.win || 0),
      losses: Number(champion.lose ?? Math.max(0, Number(champion.play || 0) - Number(champion.win || 0))),
      winRate: Math.round(Number(champion.win_rate || 0)),
      kda: Number(Number(champion.kda?.kda || 0).toFixed(2)),
    }));
  return {
    playerName: riotId,
    rank: rankFromDescription(html),
    soloQueue: {
      games,
      wins,
      losses,
      winRate: games ? Math.round((wins / games) * 100) : 0,
    },
    topChampions,
    seasonId: Number(data.season_id || 0),
    source: 'op.gg',
    seasonVerified: true,
  };
}

function getPage(pathname, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: OP_GG_HOST,
      path: pathname,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OLYCITY-Live',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
      },
      timeout: 10_000,
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        const target = new URL(response.headers.location, `https://${OP_GG_HOST}`);
        getPage(`${target.pathname}${target.search}`, redirects + 1).then(resolve, reject);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode === 200) resolve(body);
        else reject(new Error(`OP.GG HTTP ${response.statusCode}`));
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('OP.GG timeout')));
  });
}

async function fetchOpggSoloProfile(riotId, region = 'euw') {
  const [gameName, tagLine] = String(riotId).split('#');
  if (!gameName || !tagLine) throw new Error(`Riot ID invalide: ${riotId}`);
  const account = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
  const html = await getPage(`/lol/summoners/${encodeURIComponent(String(region).toLowerCase())}/${account}/champions?queue_type=${SOLO_QUEUE}`);
  return parseOpggSoloProfile(html, riotId);
}

module.exports = { fetchOpggSoloProfile, parseOpggSoloProfile };
