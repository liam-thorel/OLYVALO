/**
 * OLYCITY · Renderers
 * Pure data → HTML functions.
 */

import { valorantApi } from './api.js';
import { state } from './main.js';
import { formatRelTime } from './storage.js';

// ─── Agent YouTube trailers (IDs officiels Riot) ──
// Fallback sur background art si YouTube bloque l'embed
const AGENT_TRAILERS = {
  'Jett':      { id:'jGVAILACiMk' },
  'Raze':      { id:'EVyXT6RcFTM' },
  'Viper':     { id:'9dOSy0EhLfQ' },
  'Skye':      { id:'C3QTyMXi-WE' },
  'KAY/O':     { id:'eU1l7eBy2_Y' },
  'Chamber':   { id:'FUoqAn5T4h4' },
  'Killjoy':   { id:'ua-iIRQDY8g' },
  'Yoru':      { id:'GdOEQv-zQVw' },
  'Astra':     { id:'-ylVnuPWlJM' },
  'Gekko':     { id:'lLHBF24FciI' },
  'Clove':     { id:'GMUMNyoHAug' },
  'Sage':      { id:'WhHNMPiGAzE' },
  'Miks':      { id:'0K4BhoKYVHs' },
  // IDs confirmés
  'Omen':      { id:'_jJdWy6bDj4' },
  'Cypher':    { id:'9N_iC-Yc0FA' },
  'Sova':      { id:'OZ76UP-c8Ao' },
  'Breach':    { id:'Rux0HjzKQbw' },
  'Reyna':     { id:'PlpqhZiumDM' },
  'Phoenix':   { id:'ttJMFW2wUQM' },
  'Brimstone': { id:'7yHnJ_oNxTI' },
  'Neon':      { id:'dtx8CgjRmqE' },
  'Fade':      { id:'e7VOQ1l20eo' },
  'Harbor':    { id:'qRao6FARFRo', start:57 },
  'Deadlock':  { id:'UK7Tdob8HQw' },
  'Iso':       { id:'8OgcHAv6Jvk' },
  'Waylay':    { id:'njK6KgRNr2k' },
  'Tejo':      { id:'dRuRID5JoQY' },
  'Vyse':      { id:'BEpcN-eE8ms' },
};

function trailerSrc(t) {
  if (!t) return null;
  const start = t.start ? ('&start=' + t.start) : '';
  return 'https://www.youtube.com/embed/' + t.id + '?autoplay=1&mute=1&loop=1&playlist=' + t.id + '&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0' + start;
}

// ─── helpers ─────────────────────────────────────
function displayName(name) {
  return name === 'KAY/O' ? 'KAYO' : name;
}

function rankColorDot(tierName) {
  if (!tierName) return '';
  const colors = {
    iron:'#4a4a4a', bronze:'#a55a2e', silver:'#888',
    gold:'#dba03b', platinum:'#3d9999', diamond:'#b16fd6',
    ascendant:'#3fa05a', immortal:'#a32d2d', radiant:'#fff5a8', unrated:'#666',
  };
  const lower = tierName.toLowerCase();
  const tier = Object.keys(colors).find(t => lower.includes(t)) || 'unrated';
  return `<span style="display:inline-block;width:10px;height:10px;background:${colors[tier]};border-radius:50%;flex-shrink:0"></span>`;
}

function agilityBar(value, max = 5) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 80 ? 'var(--S)' : pct >= 60 ? 'var(--gold)' : 'var(--D)';
  return `<div class="agility-bar-track"><div class="agility-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

// ─── AGENT CARD (within comp) ────────────────────
export function agentCardHTML(name) {
  const r = state.ROLES[name] || 'D';
  const rl = state.ROLE_LABEL[r] || '';
  const portrait = valorantApi.agentImg(name);
  const display = displayName(name);
  const apiData = valorantApi.agentData(name);

  // Hover tooltip: first 2 abilities cost
  const abilities = apiData?.abilities || [];
  const tooltipAbils = abilities.slice(0, 3).map(a => {
    const slot = { Ability1:'Q', Ability2:'E', Grenade:'C', Ultimate:'X' }[a.slot] || '';
    return `<span class="agent-tooltip-ab"><span class="ab-key">${slot}</span>${a.displayName || ''}</span>`;
  }).join('');

  const imgEl = portrait
    ? `<img src="${portrait}" alt="${display}" loading="lazy">`
    : `<div class="portrait-ph">${display[0]}</div>`;

  return `<div class="agent-card ${r}" data-agent="${name}" onclick="window.OLYCITY.showAgentPage('${name}')">
    <div class="agent-card-inner">
      <div class="portrait-frame">
        ${imgEl}
        <div class="role-corner">${state.ROLE_FULL[r]}</div>
        <div class="role-stripe"></div>
        <div class="agent-hover-tooltip">
          <span class="tooltip-name">${display}</span>
          <span class="tooltip-role">${state.ROLE_FULL[r]}</span>
          ${tooltipAbils}
          <span class="tooltip-cta">Cliquer pour le codex complet →</span>
        </div>
      </div>
      <div class="agent-footer">
        <span class="agent-name">${display}</span>
        <span class="agent-role">${rl}</span>
      </div>
    </div>
  </div>`;
}

// ─── AGILITY STATS ───────────────────────────────
function agilityHTML(agility) {
  if (!agility) return '';
  const metrics = [
    { key: 'antiRush',  label: 'Anti-Rush',  icon: '⚡' },
    { key: 'postPlant', label: 'Post-Plant',  icon: '◆' },
    { key: 'retake',    label: 'Retake',      icon: '↩' },
    { key: 'split',     label: 'Split Push',  icon: '↔' },
  ];
  const bars = metrics.map(m => `
    <div class="agility-row">
      <span class="agility-icon">${m.icon}</span>
      <span class="agility-label">${m.label}</span>
      ${agilityBar(agility[m.key])}
      <span class="agility-val">${agility[m.key]}/5</span>
    </div>`).join('');
  return `<div class="agility-box">
    <div class="agility-title">Efficacité de la comp</div>
    ${bars}
    <div style="font-family:'Tomorrow',sans-serif;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--dim);margin-top:10px;text-align:right">
      ★ Estimation OLYCITY
    </div>
  </div>`;
}

// ─── COMP PANEL ──────────────────────────────────
export function compHTML(comp, mapIdx, compIdx) {
  const cid = `comp-${mapIdx}-${compIdx}`;
  const agents = comp.agents.map(n => agentCardHTML(n)).join('');
  const tierCls = comp.tier === 'S' ? 'tier-s' : 'tier-a';
  const isFav = state.FAVS.includes(cid);

  // VODs/stats link — désactivé, en attente d'une meilleure source
  const vodsHTML = '';

  return `
    <div class="comp-panel ${compIdx === 0 ? 'active' : ''}" id="panel-${mapIdx}-${compIdx}">
      <div class="comp-card">
        <div class="comp-header">
          <div class="comp-label-row">
            <span class="comp-tier ${tierCls}">${comp.tierLabel}</span>
            <span class="comp-name">${comp.label}</span>
            ${comp.updatedAt ? `<span class="comp-updated">Maj ${comp.updatedAt}</span>` : ''}
          </div>
          <div class="comp-meta">
            <div class="winrate-pill">
              <div class="winrate-bar"><div class="winrate-bar-fill" style="width:${comp.winrate}%"></div></div>
              <span class="winrate-val">${comp.winrate.toFixed(1)}%</span>
              <span class="winrate-lbl">WR</span>
            </div>
            <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${cid}" onclick="window.OLYCITY.toggleFav('${cid}')">★</button>
          </div>
        </div>
        <div class="agents-grid">${agents}</div>
        <div class="comp-bottom">
          <div class="comp-bottom-left">
            <div class="tip-box">
              <span class="tip-icon">5-STACK</span>
              <span class="tip-text">${comp.tip}</span>
            </div>
            ${vodsHTML}
          </div>
          ${agilityHTML(comp.agility)}
        </div>
        <div class="comp-card-footer">
          <span class="comp-source">Source : ${comp.source}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="share-comp-btn" onclick="window.OLYCITY.shareComp(${mapIdx},${compIdx},this)" title="Copier le lien vers cette comp">
              ↗ Partager
            </button>
            <button class="compare-btn" data-cid="${cid}" onclick="window.OLYCITY.selectCompare(${mapIdx},${compIdx},this)" title="Comparer cette comp">
              ⇄ Comparer
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── LINEUPS INDIVIDUELS ─────────────────────────
function lineupsHTML(legacyData, mapName) {
  // Use new individual lineup data from state.LINEUPS
  const mapLineups = state.LINEUPS?.[mapName];
  if (!mapLineups || Object.keys(mapLineups).length === 0) return '';

  const agents = Object.keys(mapLineups);

  // Agent filter tabs
  const tabs = agents.map((agent, i) => {
    const img = valorantApi.agentImg(agent);
    const imgEl = img ? `<img src="${img}" alt="${agent}">` : '';
    return `<button class="lineup-agent-tab ${i === 0 ? 'active' : ''}"
      data-map="${mapName}" data-agent="${agent}"
      onclick="window.OLYCITY.switchLineupAgent('${mapName}','${agent}',this)">
      ${imgEl}${agent}
    </button>`;
  }).join('');

  // Cards for first agent by default
  const cardsHTML = (agentName) => {
    const lineups = mapLineups[agentName] || [];
    return lineups.map((l, idx) => {
      const embedId = `lineup-embed-${mapName.replace(/\s/g,'')}-${agentName}-${idx}`;
      const src = 'https://www.youtube.com/embed/' + l.videoId
        + '?start=' + (l.start || 0)
        + '&autoplay=0&rel=0&modestbranding=1&controls=1';
      // Build data attrs for modal (escape single quotes)
      const safeDesc = l.desc.replace(/'/g, '&#39;');
      const safeName = l.name.replace(/'/g, '&#39;');
      return `<div class="lineup-v2-card" style="cursor:pointer" onclick="window.OLYCITY.openVideoModal('${l.videoId}',${l.start||0},'${safeName}','${l.type}','${l.diff}','${safeDesc}')">
        <div class="lineup-embed-wrap" style="pointer-events:none">
          <iframe src="${src}" loading="lazy" title="${l.name}" style="position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:none"></iframe>
          <div style="position:absolute;inset:0;background:rgba(10,12,16,.3);display:flex;align-items:center;justify-content:center;transition:background .2s">
            <div style="width:48px;height:48px;background:var(--red);clip-path:polygon(20% 0%,100% 50%,20% 100%);padding-left:4px"></div>
          </div>
        </div>
        <div class="lineup-v2-info">
          <div class="lineup-v2-header">
            <span class="lineup-v2-name">${l.name}</span>
            <span class="lineup-type-badge ${l.type}">${l.type}</span>
            <span class="lineup-diff-badge">${l.diff}</span>
          </div>
          <p class="lineup-v2-desc">${l.desc}</p>
        </div>
      </div>`;
    }).join('');
  };

  // Render all agents' cards, hide non-active ones
  const allCards = agents.map((agent, i) =>
    `<div class="lineup-agent-cards ${i === 0 ? '' : 'hidden'}" data-lineup-map="${mapName}" data-lineup-agent="${agent}">
      <div class="lineup-cards-grid">${cardsHTML(agent)}</div>
    </div>`
  ).join('');

  return `<div class="lineup-section-v2">
    <div class="sub-section-title">
      <span class="sub-tag">Lineups</span>
      <span class="sub-title">Positions clés</span>
      <div class="sub-line"></div>
    </div>
    <div class="lineup-agent-tabs">${tabs}</div>
    ${allCards}
  </div>`;
}

// ─── STRATEGIES SECTION ──────────────────────────
function strategyHTML(strats) {
  if (!strats?.length) return '';
  const typeColors = { default: 'var(--S)', fast: 'var(--D)', mid: 'var(--C)' };
  const cards = strats.map(s => {
    const color = typeColors[s.type] || 'var(--muted)';
    const steps = s.steps.map((step, i) =>
      `<div class="strat-step"><span class="strat-step-num">${i + 1}</span>${step}</div>`
    ).join('');
    return `<div class="strat-card">
      <div class="strat-header">
        <span class="strat-icon" style="color:${color}">${s.icon}</span>
        <span class="strat-name" style="color:${color}">${s.name}</span>
        <span class="strat-type">${s.type.toUpperCase()}</span>
      </div>
      <p class="strat-desc">${s.desc}</p>
      <div class="strat-steps">${steps}</div>
    </div>`;
  }).join('');

  return `<div class="strategies-section">
    <div class="sub-section-title">
      <span class="sub-tag">Strats</span>
      <span class="sub-title">Stratégies de site</span>
      <div class="sub-line"></div>
    </div>
    <div class="strat-grid">${cards}</div>
  </div>`;
}

// ─── ECO GUIDE ───────────────────────────────────
function ecoHTML(eco) {
  if (!eco) return '';
  const rounds = [
    { key: 'pistol', label: 'Pistolet',    icon: '🔫', color: 'var(--muted)' },
    { key: 'eco',    label: 'Éco',         icon: '💸', color: 'var(--D)' },
    { key: 'force',  label: 'Force Buy',   icon: '⚠',  color: 'var(--gold)' },
    { key: 'full',   label: 'Full Buy',    icon: '✓',  color: 'var(--S)' },
  ];
  const cards = rounds.map(r => {
    const d = eco[r.key];
    if (!d) return '';
    const agents = d.agents?.map(a => {
      const img = valorantApi.agentImg(a);
      return img
        ? `<img class="eco-agent-icon" src="${img}" alt="${a}" title="${a}">`
        : `<span class="eco-agent-icon-ph">${a[0]}</span>`;
    }).join('') || '';
    return `<div class="eco-card">
      <div class="eco-card-header">
        <span class="eco-round-label" style="color:${r.color}">${r.icon} ${r.label}</span>
        ${agents ? `<div class="eco-agents">${agents}</div>` : ''}
      </div>
      <p class="eco-tip">${d.tip}</p>
      ${d.buy ? `<div class="eco-buy"><span class="eco-buy-label">Achat :</span> ${d.buy}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="eco-section">
    <div class="sub-section-title">
      <span class="sub-tag">Éco</span>
      <span class="sub-title">Guide d'achat par round</span>
      <div class="sub-line"></div>
    </div>
    <div class="eco-grid">${cards}</div>
  </div>`;
}

// ─── MAP SECTION ─────────────────────────────────
export function mapSectionHTML(data, idx) {
  const splash = valorantApi.mapSplash(data.map);
  const splashEl = splash
    ? `<img class="map-hero-img" src="${splash}" alt="${data.map}" loading="lazy">`
    : `<div class="map-hero-img" style="background:var(--surf3)"></div>`;
  const tags = data.tags.map(t => `<span class="map-tag">${t}</span>`).join('');
  const tabs = data.comps.map((c, ci) => {
    const isFun = c.tier === 'F';
    const cls = isFun ? 'fun-tab' : '';
    const emoji = isFun ? '🎉 ' : '';
    return `<button class="comp-tab ${ci === 0 ? 'active' : ''} ${cls}"
      onclick="window.OLYCITY.switchComp(${idx},${ci},this)">${emoji}${c.label}</button>`;
  }).join('');
  const panels = data.comps.map((c, ci) => compHTML(c, idx, ci)).join('');
  const notes = data.notes.map(n =>
    `<div class="note-row"><span class="note-marker"></span>${n}</div>`
  ).join('');

  const hasLineups = !!(state.LINEUPS?.[data.map] && Object.keys(state.LINEUPS[data.map]).length > 0);
  const lineupsTabLabel = hasLineups
    ? `📹 Lineups <span style="font-size:9px;opacity:.7">(${Object.keys(state.LINEUPS[data.map]).join(', ')})</span>`
    : '📹 Lineups';

  return `
    <section class="map-section ${idx === 0 ? 'active' : ''}" id="map-${idx}">
      <div class="map-hero">
        <div class="map-hero-img-wrap">${splashEl}</div>
        <div class="map-hero-grid"></div>
        <div class="map-hero-overlay"></div>
        <div class="map-hero-content">
          <div class="map-hero-left">
            <div class="map-hero-sub">${data.region}</div>
            <div class="map-hero-title">${data.map}</div>
            <div class="map-hero-tags">${tags}</div>
          </div>
          <div class="map-hero-stats">
            <div class="map-stat"><div class="map-stat-val">${data.comps.length}</div><div class="map-stat-lbl">Comps</div></div>
            <div class="map-stat"><div class="map-stat-val">${data.stats.difficulty}</div><div class="map-stat-lbl">Difficulté</div></div>
            <div class="map-stat" style="max-width:160px"><div class="map-stat-val" style="font-size:clamp(14px,1.5vw,22px)">${data.stats.sides}</div><div class="map-stat-lbl">Équilibre</div></div>
            ${data.stats.bestSite ? `<div class="map-stat"><div class="map-stat-val" style="font-size:clamp(14px,1.5vw,22px);color:var(--red)">${data.stats.bestSite}</div><div class="map-stat-lbl">Meilleur site ATK</div></div>` : ''}
          </div>
        </div>
      </div>

      <!-- Section tabs: Comps / Strats & Éco / Lineups -->
      <div class="map-section-tabs">
        <button class="map-section-tab active" onclick="window.OLYCITY.switchMapTab('${idx}','comps',this)">◈ Comps</button>
        <button class="map-section-tab" onclick="window.OLYCITY.switchMapTab('${idx}','strats',this)">◆ Strats & Éco</button>
        ${hasLineups ? `<button class="map-section-tab" onclick="window.OLYCITY.switchMapTab('${idx}','lineups',this)">📹 Lineups</button>` : ''}
        <button class="map-section-tab" onclick="window.OLYCITY.switchMapTab('${idx}','callouts',this)">◉ Callouts</button>
        <button class="map-section-tab" onclick="window.OLYCITY.switchMapTab('${idx}','notes',this)">★ Notes</button>
      </div>

      <!-- COMPS TAB -->
      <div class="map-section-panel active" id="maptab-${idx}-comps">
        <div class="comp-tabs">${tabs}</div>
        ${panels}
      </div>

      <!-- STRATS & ÉCO TAB -->
      <div class="map-section-panel" id="maptab-${idx}-strats">
        ${strategyHTML(data.strategies)}
        ${ecoHTML(data.eco)}
      </div>

      <!-- LINEUPS TAB -->
      ${hasLineups ? `<div class="map-section-panel" id="maptab-${idx}-lineups">
        ${lineupsHTML(data.lineups, data.map)}
      </div>` : ''}

      <!-- CALLOUTS TAB -->
      <div class="map-section-panel" id="maptab-${idx}-callouts">
        ${calloutsHTML(data.map)}
      </div>

      <!-- NOTES TAB -->
      <div class="map-section-panel" id="maptab-${idx}-notes">
        <div class="notes-card" style="margin-top:0;border-top:none">
          <div class="notes-card-title">Notes Meta — ${data.map}</div>
          <div class="notes-list">${notes}</div>
        </div>
      </div>

    </section>`;
}

// ─── ROSTER ──────────────────────────────────────
export function rosterHTML() {
  return state.ROSTER.map((p) => {
    // Priorité aux vrais top agents de l'acte (depuis sync), fallback sur JSON
    const stats = state.PLAYER_STATS[p.name] || {};
    const displayMains = (Array.isArray(stats.topAgents) && stats.topAgents.length > 0)
      ? stats.topAgents.slice(0, 3).filter(Boolean)
      : (p.mains || []).filter(Boolean);

    const mains = displayMains.map(name => {
      const img = valorantApi.agentImg(name);
      const display = displayName(name);
      const imgEl = img
        ? `<img src="${img}" alt="${display}" loading="lazy">`
        : `<div class="portrait-ph" style="font-size:18px">${display[0]}</div>`;
      return `<div class="player-main" onclick="window.OLYCITY.showAgentPage('${name}')" title="${display}">
        ${imgEl}
        <div class="player-main-name">${display}</div>
      </div>`;
    }).join('');

    const rankDisplay = stats.rank ? `
      <div class="player-rank">
        ${rankColorDot(stats.rank)}
        <span class="player-rank-text">${stats.rank}</span>
        ${stats.rr != null ? `<span class="player-rank-rr">${stats.rr}rr</span>` : ''}
      </div>` : '';

    const hasStats = stats.wr != null || stats.kda != null;
    const actLabel = stats.wrGames != null ? `${stats.wrGames}G · acte` : null;
    const liveStatsRow = hasStats ? `
      <div class="player-stats-row">
        <div class="player-stat">
          <span class="player-stat-val ${(stats.wr ?? 0) >= 50 ? 'green' : 'red'}">${stats.wr != null ? stats.wr + '%' : '—'}</span>
          <span class="player-stat-lbl">WR${actLabel ? ` · ${stats.wrGames}G` : ''}</span>
        </div>
        <div class="player-stat">
          <span class="player-stat-val ${parseFloat(stats.kda) >= 1 ? 'green' : 'red'}">${stats.kda ?? '—'}</span>
          <span class="player-stat-lbl">KDA${stats.games > 0 ? ` · ${stats.games}G` : ''}</span>
        </div>
        <div class="player-stat">
          <span class="player-stat-val gold">${stats.wrWins ?? '—'}</span>
          <span class="player-stat-lbl">Wins acte</span>
        </div>
      </div>` : '';

    const syncTime = stats.syncedAt
      ? `<span class="player-sync-time">Sync · ${formatRelTime(stats.syncedAt)}</span>` : '';

    const trackerUrl = p.riot
      ? `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.riot.name)}%23${encodeURIComponent(p.riot.tag)}/overview`
      : null;
    const trackerBtn = trackerUrl
      ? `<a class="tracker-btn" href="${trackerUrl}" target="_blank" rel="noopener"><span>↗</span> Tracker</a>`
      : '';

    const syncBtn = p.riot ? `
      <div class="player-actions">
        <button class="player-sync-btn" data-player="${p.name}" onclick="window.OLYCITY.syncPlayer('${p.name}')">
          <span class="sync-spin">↻</span> Sync
        </button>
        ${trackerBtn}
      </div>
      ${syncTime}` : '';

    return `<div class="player-card" data-player-name="${p.name}">
      <div class="player-banner">
        <div class="player-banner-deco"></div>
        <div class="player-banner-glow"></div>
        ${rankDisplay}
        <span class="player-tag">${p.tag}</span>
      </div>
      <div class="player-body">
        <div class="player-name">${p.name}</div>
        <div class="player-role">${p.role}</div>
        <div class="player-mains">${mains}</div>
        ${liveStatsRow}
        ${syncBtn}
      </div>
    </div>`;
  }).join('');
}

// ─── S-TIER ──────────────────────────────────────
export function stierHTML() {
  return state.S_TIER.map(name => {
    const img = valorantApi.agentImg(name);
    const imgEl = img
      ? `<img src="${img}" alt="${name}" loading="lazy">`
      : `<div class="portrait-ph" style="font-size:28px">${name[0]}</div>`;
    const role = state.ROLES[name] || 'D';
    const roleLabel = state.ROLE_FULL[role] || '';
    // Count how many comps use this agent
    const pickCount = state.COMPS_DATA.reduce((acc, map) =>
      acc + map.comps.filter(c => c.agents.includes(name)).length, 0);
    const mapsUsed = state.COMPS_DATA
      .filter(map => map.comps.some(c => c.agents.includes(name)))
      .map(m => m.map.slice(0,3).toUpperCase())
      .join(' · ');
    return `<div class="stier-card" title="${name}" onclick="window.OLYCITY.showAgentPage('${name}')">
      <div class="stier-frame">
        ${imgEl}
        <span class="stier-badge">S-TIER</span>
        ${mapsUsed ? `<div class="stier-maps">${mapsUsed}</div>` : ''}
      </div>
      <span class="stier-name">${name}</span>
      <span class="stier-role">${roleLabel}</span>
    </div>`;
  }).join('');
}

// ─── GLOBAL NOTES ────────────────────────────────
export function globalNotesHTML() {
  return state.GLOBAL_NOTES.map(n =>
    `<div class="gs-card"><span class="gs-icon">◆</span>${n}</div>`
  ).join('');
}

// ─── NAV MAPS ────────────────────────────────────
export function navMapsHTML() {
  return state.COMPS_DATA.map((d, i) => {
    const icon = valorantApi.mapIcon(d.map);
    const iconEl = icon ? `<img src="${icon}" alt="">` : '';
    return `<button class="nav-map-btn ${i === 0 ? 'active' : ''}" onclick="window.OLYCITY.showMap(${i},this)" data-map-idx="${i}">
      <div class="nav-map-icon">${iconEl}</div>${d.map}
    </button>`;
  }).join('');
}

// ─── ABILITY CARD (agent page) ───────────────────
function abilityCardHTML(slot, frData, apiAbility, isUlt) {
  const apiName = apiAbility?.displayName || '';
  const apiIcon = apiAbility?.displayIcon;
  const frName = frData?.name || apiName;
  const cost = frData?.cost || '—';
  const desc = frData?.desc || apiAbility?.description || 'Description indisponible.';
  const iconEl = apiIcon ? `<img src="${apiIcon}" alt="${frName}">` : '';
  return `<div class="ability-card ${isUlt ? 'ultimate' : ''}">
    <div class="ab-header">
      <div class="ab-icon-wrap">${iconEl}</div>
      <div class="ab-info">
        <div class="ab-slot">${slot}</div>
        <div class="ab-name">${frName}</div>
        <div class="ab-cost">${cost}</div>
      </div>
    </div>
    <div class="ab-desc">${desc}</div>
  </div>`;
}

export function getCompsUsingAgent(name) {
  const usage = [];
  state.COMPS_DATA.forEach((map, mi) => {
    map.comps.forEach((comp, ci) => {
      if (comp.agents.includes(name)) {
        usage.push({ map: map.map, mapIdx: mi, compIdx: ci, label: comp.label, tier: comp.tier, winrate: comp.winrate });
      }
    });
  });
  return usage;
}

export function getPlayersUsingAgent(name) {
  return state.ROSTER.filter(p => p.mains.includes(name));
}

// ─── AGENT PAGE ──────────────────────────────────
export function agentPageHTML(name) {
  const apiData = valorantApi.agentData(name);
  const frData = state.AGENT_FR[name] || {};
  const role = frData.role || state.ROLES[name] || 'D';
  const roleLabel = state.ROLE_FULL[role];
  const display = displayName(name);
  const fullPortrait = valorantApi.agentFullImg(name);
  const bgImg = apiData?.portrait || '';

  const apiAbilities = apiData?.abilities || [];
  const SLOTS_FR = { Ability1:'Compétence 1', Ability2:'Compétence 2', Grenade:'Signature', Ultimate:'Ulti' };

  const abilitiesHTML = ['Ability1','Ability2','Grenade','Ultimate'].map(slot => {
    const apiAb = apiAbilities.find(a => a.slot === slot);
    if (!apiAb && !frData.abilities) return '';
    const apiName = apiAb?.displayName || '';
    let frAb = null;
    if (frData.abilities) {
      frAb = frData.abilities[apiName] || null;
      if (!frAb) {
        const frKeys = Object.keys(frData.abilities);
        const slotIdx = ['Ability1','Ability2','Grenade','Ultimate'].indexOf(slot);
        if (frKeys[slotIdx]) frAb = frData.abilities[frKeys[slotIdx]];
      }
    }
    return abilityCardHTML(SLOTS_FR[slot], frAb, apiAb, slot === 'Ultimate');
  }).filter(Boolean).join('');

  const usage = getCompsUsingAgent(name);
  const usageHTML = usage.length > 0
    ? usage.map(u => {
        const mapBg = valorantApi.mapSplash(u.map);
        const bgStyle = mapBg ? `background-image:url(${mapBg})` : '';
        return `<div class="usage-card" onclick="window.OLYCITY.goToComp(${u.mapIdx},${u.compIdx})">
          <div class="usage-map-thumb" style="${bgStyle}"></div>
          <div class="usage-card-inner">
            <div class="usage-map">${u.map}</div>
            <div class="usage-comp-label">${u.label}</div>
            <div class="usage-meta">
              <span class="usage-tier ${u.tier}">${u.tier}-TIER</span>
              <span class="usage-wr">${u.winrate.toFixed(1)}% WR</span>
              <span class="usage-go">→</span>
            </div>
          </div>
        </div>`;
      }).join('')
    : `<div style="color:var(--muted);font-size:13px">Aucune comp OLYCITY n'utilise actuellement cet agent.</div>`;

  const players = getPlayersUsingAgent(name);
  const playersHTML = players.length > 0
    ? players.map(p => `<span class="played-pill">${p.name}<span class="pill-role">${p.tag}</span></span>`).join('')
    : `<span class="played-none">Aucun joueur OLYCITY n'a cet agent en main.</span>`;

  const pickCount = usage.length;
  const avgWR = usage.length > 0
    ? (usage.reduce((s, u) => s + u.winrate, 0) / usage.length).toFixed(1) : '—';
  const fullEl = fullPortrait
    ? `<img class="agent-portrait-full" src="${fullPortrait}" alt="${display}">`  : '';
  // Background cinématique : vidéo YouTube en loop si dispo, sinon background art
  const bgArt = valorantApi.agentBackground(name);
  const gradient = valorantApi.agentGradient(name);
  // trailerId replaced by trailer object above

  // YouTube embed : muted autoplay loop, sans contrôles
  const trailer = AGENT_TRAILERS[name] || AGENT_TRAILERS[displayName(name)];
  const src = trailerSrc(trailer);
  const videoEl = src ? `
    <div class="agent-hero-video-wrap">
      <div class="agent-hero-video-cover" id="agent-video-cover"></div>
      <iframe
        class="agent-hero-video"
        src="${src}"
        allow="autoplay; encrypted-media"
        frameborder="0"
        title="${displayName(name)} cinematic"
        onload="setTimeout(()=>{const c=document.getElementById('agent-video-cover');if(c)c.classList.add('loaded')},1200)"
      ></iframe>
      <div class="agent-hero-video-block"></div>
    </div>` : '';

  // Fallback visible si la vidéo ne charge pas
  const hasVideo = !!trailer;
  const bgEl = bgArt
    ? `<div class="agent-hero-bg ${hasVideo ? 'has-video' : ''}" style="background-image:url(${bgArt})"></div>`
    : fullPortrait
      ? `<div class="agent-hero-bg ${hasVideo ? 'has-video' : ''}" style="background-image:url(${fullPortrait});background-size:contain;background-repeat:no-repeat;background-position:80% center;"></div>`
      : '';

  const gradientOverlay = gradient
    ? `<div style="position:absolute;inset:0;background:${gradient};opacity:.25;pointer-events:none;z-index:4;mix-blend-mode:screen"></div>`
    : '';

  return `
    <div class="agent-hero">
      ${videoEl}
      ${bgEl}
      ${gradientOverlay}
      <div class="agent-hero-grain"></div>
      <div class="agent-hero-scan"></div>
      <div class="agent-hero-gradient"></div>
      <div class="agent-hero-grid"></div>
      <div class="agent-hero-content">
        <div class="agent-info">
          <button class="agent-back-btn" onclick="window.OLYCITY.closeAgentPage()">← Retour</button>
          <div class="agent-page-eyebrow">Agent · OLYCITY Codex</div>
          <h1 class="agent-page-name">${display}</h1>
          <div class="agent-page-role-row">
            <span class="agent-role-badge ${role}">${roleLabel}</span>
            ${frData.origin ? `<span class="agent-origin">Origine : ${frData.origin}</span>` : ''}
          </div>
          <p class="agent-bio">${frData.bio || apiData?.desc || 'Biographie en cours de traduction.'}</p>
          <div class="agent-quick-stats">
            <div class="aqs"><div class="aqs-val">${pickCount}</div><div class="aqs-lbl">Comp${pickCount>1?'s':''} OLYCITY</div></div>
            <div class="aqs"><div class="aqs-val">${avgWR}${avgWR!=='—'?'%':''}</div><div class="aqs-lbl">WR moyen</div></div>
            <div class="aqs"><div class="aqs-val">${players.length}</div><div class="aqs-lbl">Joueur${players.length>1?'s':''}</div></div>
          </div>
          ${(()=>{
            const lmaps=Object.entries(state.LINEUPS||{}).filter(([m,ag])=>ag[name]).map(([m])=>m);
            if(!lmaps.length) return '';
            return `<div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:16px'>`
              +lmaps.map(m=>{
                const mi=state.COMPS_DATA.findIndex(d=>d.map===m);
                return `<button style='background:transparent;border:1px solid rgba(63,207,207,.3);color:var(--S);cursor:pointer;padding:5px 12px;font-family:Tomorrow,sans-serif;font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;transition:all .15s' onclick='window.OLYCITY.goToLineups(${mi},\"${name}\")'>📹 Lineups ${m}</button>`;
              }).join('')
              +'</div>';
          })()}
        </div>
        <div class="agent-portrait-wrap">
          <div class="agent-portrait-glow"></div>
          ${fullEl}
        </div>
      </div>
    </div>
    <div class="agent-body">
      <div class="abilities-section">
        <div class="section-title-with-tag">
          <span class="sec-tag">Compétences</span>
          <h2 class="sec-title">Kit complet</h2>
          <div class="sec-line"></div>
        </div>
        <div class="ab-grid">${abilitiesHTML}</div>
      </div>
      <div class="usage-section">
        <div class="section-title-with-tag">
          <span class="sec-tag">Comps OLYCITY</span>
          <h2 class="sec-title">Dans quelles compos il joue</h2>
          <div class="sec-line"></div>
        </div>
        <div class="usage-grid">${usageHTML}</div>
      </div>
      <div class="usage-section">
        <div class="section-title-with-tag">
          <span class="sec-tag">Le Roster</span>
          <h2 class="sec-title">Joueurs OLYCITY qui le main</h2>
          <div class="sec-line"></div>
        </div>
        <div class="played-by">
          <span class="played-by-lbl">Mains :</span>
          <div class="played-by-pills">${playersHTML}</div>
        </div>
      </div>
    </div>`;
}

// ─── MINI ROSTER (home page) ─────────────────────
export function miniRosterHTML() {
  return state.ROSTER.map(p => {
    const img = valorantApi.agentImg(p.mains?.[0]);
    const imgEl = img
      ? `<img src="${img}" alt="${p.mains?.[0] || ''}">`
      : `<div style="width:100%;height:100%;background:var(--surf3);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--dim)">${p.name[0]}</div>`;
    const stats = state.PLAYER_STATS[p.name] || {};
    const rankEl = stats.rank
      ? `<span class="mini-player-rank">${stats.rank.split(' ').slice(0,1)[0]}</span>`
      : '';
    return `<div class="mini-player" onclick="window.OLYCITY.nav('roster')">
      <div class="mini-player-avatar">${imgEl}</div>
      <div class="mini-player-info">
        <div class="mini-player-name">${p.name}</div>
        <div class="mini-player-role">${p.tag}</div>
      </div>
      ${rankEl}
    </div>`;
  }).join('');
}

// ─── CALLOUTS MAP ────────────────────────────────
export function calloutsHTML(mapName) {
  const data = state.CALLOUTS?.[mapName];
  if (!data?.zones?.length) return '';

  const zones = data.zones;
  const W = 1024, H = 1024; // square viewbox matching Riot's minimap aspect ratio

  // Get the official minimap from valorant-api.com
  const minimapUrl = valorantApi.mapMinimap(mapName);

  // Background: official minimap image if available, else dark grid
  const bg = minimapUrl
    ? `<image href="${minimapUrl}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect width="${W}" height="${H}" fill="#0d1117"/>`;

  // Dark overlay so labels stay readable over the map
  const overlay = `<rect width="${W}" height="${H}" fill="rgba(10,12,16,.35)"/>`;

  // Zone dots + labels
  const labels = zones.map(z => {
    const cx = (z.x / 100) * W;
    const cy = (z.y / 100) * H;
    const r = z.major ? 10 : 6;
    const fontSize = z.major ? 13 : 10;
    const textLen = z.label.length * (fontSize * 0.62);
    const bgW = textLen + 14;
    const bgH = fontSize + 8;
    const pulse = z.major ? `<circle r="${r+6}" fill="none" stroke="${z.color}" stroke-width="1.5" opacity=".5">
      <animate attributeName="r" from="${r+4}" to="${r+12}" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" from=".5" to="0" dur="2s" repeatCount="indefinite"/>
    </circle>` : '';
    return `
      <g class="callout-label" transform="translate(${cx},${cy})" style="cursor:default">
        ${pulse}
        <circle r="${r}" fill="${z.color}" opacity="${z.major ? '.95' : '.8'}"/>
        ${z.major ? `<circle r="${r+5}" fill="none" stroke="${z.color}" stroke-width="1.5" opacity=".5"/>` : ''}
        <rect x="${-bgW/2}" y="${-bgH-r-4}" width="${bgW}" height="${bgH}"
          rx="3" fill="rgba(6,8,12,.88)" stroke="${z.color}" stroke-width="1" opacity=".9"/>
        <text x="0" y="${-r-7}" text-anchor="middle"
          font-family="Tomorrow,sans-serif" font-size="${fontSize}" font-weight="${z.major ? '700' : '500'}"
          letter-spacing="${z.major ? '1.5' : '0.5'}"
          fill="${z.major ? '#fff' : 'rgba(255,255,255,.85)'}">
          ${z.label}
        </text>
      </g>`;
  }).join('');

  const svgContent = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    ${bg}
    ${overlay}
    ${labels}
  </svg>`;

  const legend = [
    { color: '#ff4656', label: 'Spawn ATK' },
    { color: '#3fcfcf', label: 'Spawn DEF / CT' },
    { color: '#f5c842', label: 'Site A' },
    { color: '#a87fff', label: 'Site B / Site C' },
    { color: '#ff8200', label: 'Mid' },
  ].map(l => `<div class="callout-legend-item">
    <div class="callout-legend-dot" style="background:${l.color}"></div>${l.label}
  </div>`).join('');

  const apiNote = minimapUrl ? '' :
    `<div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:1px;color:var(--dim);margin-top:8px">
      Minimap non disponible — valorant-api.com n'a pas encore indexé cette map
    </div>`;

  return `<div class="callouts-section">
    <div class="callout-map-wrap" style="max-width:700px">${svgContent}</div>
    <div class="callout-legend">${legend}</div>
    ${apiNote}
  </div>`;
}

// ─── AGENTS PAGE ──────────────────────────────────
export function agentsFiltersHTML() {
  const roles = [
    { key: 'all', label: 'Tous' },
    { key: 'D',   label: 'Duelliste' },
    { key: 'I',   label: 'Initiateur' },
    { key: 'S',   label: 'Sentinelle' },
    { key: 'C',   label: 'Contrôleur' },
  ];
  return roles.map(r =>
    `<button class="agent-filter-btn ${r.key !== 'all' ? r.key : ''} ${r.key === 'all' ? 'active' : ''}"
      data-role="${r.key}"
      onclick="window.OLYCITY.filterAgents('${r.key}', this)">
      ${r.label}
    </button>`
  ).join('');
}

export function agentsGridHTML(filter = 'all', search = '') {
  const allAgents = Object.keys(valorantApi.agents).sort();
  const q = search.toLowerCase().trim();

  const filtered = allAgents.filter(name => {
    const role = state.ROLES[name] || 'D';
    const matchRole = filter === 'all' || role === filter;
    const matchSearch = !q || name.toLowerCase().includes(q);
    return matchRole && matchSearch;
  });

  if (filtered.length === 0) {
    return `<div class="agents-empty">Aucun agent trouvé</div>`;
  }

  return filtered.map(name => agentCardHTML(name)).join('');
}

// ─── SAVED COMPS ─────────────────────────────────
export function savedCompsHTML() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('olycity-saved-comps') || '[]'); } catch(e) {}

  if (saved.length === 0) {
    return `<div class="saved-comps-section">
      <div class="sub-section-title">
        <span class="sub-tag">Sauvegardées</span>
        <span class="sub-title">Mes comps custom</span>
        <div class="sub-line"></div>
      </div>
      <div class="no-saved">Aucune comp sauvegardée — crée-en une dans le builder ci-dessus</div>
    </div>`;
  }

  const cards = saved.map((comp, i) => {
    const agents = (comp.agents || []).map(name => {
      const img = valorantApi.agentImg(name);
      return `<div class="saved-comp-agent">
        ${img ? `<img src="${img}" alt="${name}" title="${name}">` : ''}
      </div>`;
    }).join('');
    const date = comp.createdAt
      ? new Date(comp.createdAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' })
      : '—';
    return `<div class="saved-comp-card">
      <div class="saved-comp-name">${comp.name}</div>
      <div class="saved-comp-agents">${agents}</div>
      <div class="saved-comp-date">Créée le ${date} · ${comp.agents?.length || 0} agents</div>
      <div class="saved-comp-actions">
        <button class="saved-comp-btn load" onclick="window.OLYCITY.builderLoad(${i})">↺ Charger</button>
        <button class="saved-comp-btn del" onclick="window.OLYCITY.savedCompDelete(${i})">✕ Supprimer</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="saved-comps-section">
    <div class="sub-section-title">
      <span class="sub-tag">Sauvegardées</span>
      <span class="sub-title">Mes comps custom (${saved.length})</span>
      <div class="sub-line"></div>
    </div>
    <div class="saved-comps-grid">${cards}</div>
  </div>`;
}

// ─── COMP COMPARISON ─────────────────────────────
export function compCompareHTML(compA, compB) {
  const metrics = [
    { key:'antiRush',  label:'Anti-Rush',  icon:'⚡' },
    { key:'postPlant', label:'Post-Plant',  icon:'◆'  },
    { key:'retake',    label:'Retake',      icon:'↩'  },
    { key:'split',     label:'Split Push',  icon:'↔'  },
  ];
  const barColor = v => v >= 4 ? 'var(--S)' : v >= 3 ? 'var(--gold)' : 'var(--D)';

  function agentsCol(comp) {
    return (comp.agents || []).map(name => {
      const img = valorantApi.agentImg(name);
      return `<div class="comp-compare-agent" onclick="window.OLYCITY.showAgentPage('${name}')">
        ${img ? `<img src="${img}" alt="${name}">` : ''}
        <span>${displayName(name)}</span>
      </div>`;
    }).join('');
  }

  function agilityCol(comp, isLeft) {
    return metrics.map(m => {
      const val = comp.agility?.[m.key] || 0;
      const pct = (val/5)*100;
      // For left col, bar grows right-to-left to face the center
      const barStyle = isLeft
        ? `width:${pct}%;background:${barColor(val)};right:0;left:auto`
        : `width:${pct}%;background:${barColor(val)}`;
      const track = isLeft
        ? `<div class="comp-compare-bar" style="direction:rtl"><div class="comp-compare-fill" style="${barStyle}"></div></div>`
        : `<div class="comp-compare-bar"><div class="comp-compare-fill" style="${barStyle}"></div></div>`;
      return `<div class="comp-compare-metric" style="${isLeft ? 'flex-direction:row-reverse;text-align:right' : ''}">
        <span class="comp-compare-num">${val}/5</span>
        ${track}
      </div>`;
    }).join('');
  }

  // Center diff badges
  const diffs = metrics.map(m => {
    const vA = compA.agility?.[m.key] || 0;
    const vB = compB.agility?.[m.key] || 0;
    const d = vA - vB;
    const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'eq';
    const label = d > 0 ? `+${d}` : d < 0 ? `${d}` : '=';
    return `<div style="display:flex;align-items:center;gap:4px;height:28px">
      <span class="diff-badge ${cls}">${label}</span>
    </div>`;
  }).join('');

  const tierA = compA.tier === 'S' ? 'tier-s' : 'tier-a';
  const tierB = compB.tier === 'S' ? 'tier-s' : 'tier-a';

  return `<div class="comp-compare-panel active">
    <div class="comp-compare-header">
      <div class="comp-compare-title">
        ⇄ Comparaison
        <span class="comp-compare-subtitle">Sélectionne 2 comps · les diff sont au centre</span>
      </div>
      <button class="comp-compare-close" onclick="window.OLYCITY.closeCompare()">✕ Fermer</button>
    </div>
    <div class="comp-compare-grid">

      <div class="comp-compare-col">
        <div class="comp-compare-col-title">
          <span class="comp-tier ${tierA}">${compA.tierLabel}</span>${compA.label}
        </div>
        <div class="comp-compare-agents">${agentsCol(compA)}</div>
        <div class="comp-compare-wr">${compA.winrate.toFixed(1)}%</div>
        <div class="comp-compare-wr-lbl">Win rate</div>
        <div class="comp-compare-agility" style="margin-top:16px">${agilityCol(compA, true)}</div>
        <div class="comp-compare-tip">${compA.tip}</div>
      </div>

      <div class="comp-compare-center">
        <div style="font-family:'Tomorrow',sans-serif;font-size:8px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;margin-bottom:8px">WR</div>
        <div class="diff-badge ${compA.winrate > compB.winrate ? 'pos' : compA.winrate < compB.winrate ? 'neg' : 'eq'}" style="margin-bottom:24px">
          ${compA.winrate > compB.winrate ? '+' : ''}${(compA.winrate - compB.winrate).toFixed(1)}%
        </div>
        <div class="comp-compare-diffs">${diffs}</div>
      </div>

      <div class="comp-compare-col">
        <div class="comp-compare-col-title">
          <span class="comp-tier ${tierB}">${compB.tierLabel}</span>${compB.label}
        </div>
        <div class="comp-compare-agents">${agentsCol(compB)}</div>
        <div class="comp-compare-wr">${compB.winrate.toFixed(1)}%</div>
        <div class="comp-compare-wr-lbl">Win rate</div>
        <div class="comp-compare-agility" style="margin-top:16px">${agilityCol(compB, false)}</div>
        <div class="comp-compare-tip">${compB.tip}</div>
      </div>

    </div>
  </div>`;
}

// ─── COMP BUILDER ────────────────────────────────
export function compBuilderHTML(slots = [null,null,null,null,null]) {
  const roleLabels = { D:'Duelliste', I:'Initiateur', S:'Sentinelle', C:'Contrôleur' };
  const slotsHTML = slots.map((agent, i) => {
    if (agent) {
      const img = valorantApi.agentImg(agent);
      const role = state.ROLES[agent] || 'D';
      return `<div class="comp-builder-slot filled">
        ${img ? `<img src="${img}" alt="${agent}">` : ''}
        <span class="comp-builder-slot-name">${displayName(agent)}</span>
        <span class="comp-builder-slot-role">${roleLabels[role] || ''}</span>
        <button class="comp-builder-slot-remove" onclick="window.OLYCITY.builderRemove(${i})">✕</button>
      </div>`;
    }
    return `<div class="comp-builder-slot" onclick="window.OLYCITY.builderFocusSlot(${i})" id="builder-slot-${i}">
      <span class="comp-builder-slot-empty">Slot ${i+1}<br>Cliquer pour<br>assigner</span>
    </div>`;
  }).join('');

  // All agents sorted
  const allAgents = Object.keys(valorantApi.agents).sort();
  const usedSet = new Set(slots.filter(Boolean));
  const agentsHTML = allAgents.map(name => {
    const img = valorantApi.agentImg(name);
    const used = usedSet.has(name) ? 'used' : '';
    return `<div class="comp-builder-agent ${used}" data-agent="${name}" onclick="window.OLYCITY.builderAddAgent('${name}')">
      ${img ? `<img src="${img}" alt="${name}">` : ''}
      <span class="comp-builder-agent-name">${displayName(name)}</span>
    </div>`;
  }).join('');

  // Agility preview
  const agilityKeys = ['antiRush','postPlant','retake','split'];
  const agilityLabels = ['Anti-Rush','Post-Plant','Retake','Split'];
  const roleScores = {
    D: { antiRush:2, postPlant:2, retake:3, split:4 },
    I: { antiRush:4, postPlant:3, retake:3, split:3 },
    S: { antiRush:4, postPlant:4, retake:2, split:2 },
    C: { antiRush:3, postPlant:5, retake:3, split:3 },
  };
  const filled = slots.filter(Boolean);
  const agilityHTML = agilityKeys.map((k, idx) => {
    let score = 0;
    filled.forEach(a => { const r = state.ROLES[a]||'D'; score += (roleScores[r]?.[k] || 3); });
    const avg = filled.length > 0 ? Math.min(5, Math.round(score / filled.length)) : 0;
    const color = avg >= 4 ? 'green' : avg <= 2 ? 'red' : '';
    return `<div class="cba-stat">
      <span class="cba-val ${color}">${avg > 0 ? avg+'/5' : '—'}</span>
      <span class="cba-lbl">${agilityLabels[idx]}</span>
    </div>`;
  }).join('');

  return `<div class="comp-builder-section">
    <div class="comp-builder-title">Comp Builder</div>
    <div class="comp-builder-slots">${slotsHTML}</div>
    <div style="font-family:'Tomorrow',sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px">
      Choisir les agents :
    </div>
    <div class="comp-builder-agents">${agentsHTML}</div>
    <div class="comp-builder-footer">
      <button class="comp-builder-clear" onclick="window.OLYCITY.builderClear()">✕ Reset</button>
      <button class="comp-builder-save" onclick="window.OLYCITY.builderSave()">★ Sauvegarder</button>
      ${filled.length >= 2 ? `<button class="compare-btn" onclick="window.OLYCITY.builderCompare()" style="margin-left:4px">⇄ Comparer avec une comp meta</button>` : ''}
      <div class="comp-builder-agility">${agilityHTML}</div>
    </div>
  </div>`;
}
