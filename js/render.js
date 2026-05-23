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
  'Jett':      'jGVAILACiMk',
  'Raze':      'EVyXT6RcFTM',
  'Viper':     '9dOSy0EhLfQ',
  'Skye':      'C3QTyMXi-WE',
  'KAY/O':     'eU1l7eBy2_Y',
  'Chamber':   'FUoqAn5T4h4',
  'Killjoy':   'ua-iIRQDY8g',
  'Yoru':      'GdOEQv-zQVw',
  'Astra':     '-ylVnuPWlJM',
  'Gekko':     'lLHBF24FciI',
  'Clove':     'GMUMNyoHAug',
  'Neon':      '1CdS3f28JaA',
  'Fade':      'ZCjJJPEhUkw',
  'Deadlock':  'jSTRw4bByJk',
  'Iso':       'lETDDgFnNtA',
  'Harbor':    'aJPMKlZT_BY',
  'Sage':      'WhHNMPiGAzE',
  'Omen':      'q5pCn72r4Qs',
  'Cypher':    '7TNavET4WUI',
  'Sova':      'IXLdrGXj4p0',
  'Breach':    'E5v7-s7TYYE',
  'Reyna':     'RXY6PjCvgYU',
  'Phoenix':   '6xCh2TqXzWM',
  'Brimstone': 'mBZB0oFHJjA',
  'Waylay':    'aJPMKlZT_BY',
  'Tejo':      'jSTRw4bByJk',
  'Miks':      '0K4BhoKYVHs',
  'Vyse':      'jSTRw4bByJk',
};

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
  </div>`;
}

// ─── COMP PANEL ──────────────────────────────────
export function compHTML(comp, mapIdx, compIdx) {
  const cid = `comp-${mapIdx}-${compIdx}`;
  const agents = comp.agents.map(n => agentCardHTML(n)).join('');
  const tierCls = comp.tier === 'S' ? 'tier-s' : 'tier-a';
  const isFav = state.FAVS.includes(cid);

  const vodsHTML = comp.vods?.length
    ? `<div class="comp-vods">${comp.vods.map(v =>
        `<a href="${v.url}" target="_blank" rel="noopener" class="vod-link">▶ ${v.label}</a>`
      ).join('')}</div>`
    : '';

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
        <div class="comp-source">Source : ${comp.source}</div>
      </div>
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
  const tabs = data.comps.map((c, ci) =>
    `<button class="comp-tab ${ci === 0 ? 'active' : ''}" onclick="window.OLYCITY.switchComp(${idx},${ci},this)">${c.label}</button>`
  ).join('');
  const panels = data.comps.map((c, ci) => compHTML(c, idx, ci)).join('');
  const notes = data.notes.map(n =>
    `<div class="note-row"><span class="note-marker"></span>${n}</div>`
  ).join('');

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
            <div class="map-stat"><div class="map-stat-val">${data.stats.sides}</div><div class="map-stat-lbl">Côté favorisé</div></div>
          </div>
        </div>
      </div>

      <div class="comp-tabs">${tabs}</div>
      ${panels}

      ${strategyHTML(data.strategies)}
      ${ecoHTML(data.eco)}

      <div class="notes-card">
        <div class="notes-card-title">Notes Meta — ${data.map}</div>
        <div class="notes-list">${notes}</div>
      </div>
    </section>`;
}

// ─── ROSTER ──────────────────────────────────────
export function rosterHTML() {
  return state.ROSTER.map((p) => {
    const mains = (p.mains || []).filter(Boolean).map(name => {
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

    const stats = state.PLAYER_STATS[p.name] || {};
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
  const trailerId = AGENT_TRAILERS[name] || AGENT_TRAILERS[displayName(name)];

  // YouTube embed : muted autoplay loop, pas de contrôles, pas de suggestions
  const videoEl = trailerId ? `
    <div class="agent-hero-video-wrap">
      <iframe
        class="agent-hero-video"
        src="https://www.youtube.com/embed/${trailerId}?autoplay=1&mute=1&loop=1&playlist=${trailerId}&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&start=0"
        allow="autoplay; encrypted-media"
        frameborder="0"
        loading="lazy"
        title="${displayName(name)} cinematic"
      ></iframe>
    </div>` : '';

  // Fallback visible si la vidéo ne charge pas
  const bgEl = bgArt
    ? `<div class="agent-hero-bg ${trailerId ? 'has-video' : ''}" style="background-image:url(${bgArt})"></div>`
    : fullPortrait
      ? `<div class="agent-hero-bg ${trailerId ? 'has-video' : ''}" style="background-image:url(${fullPortrait});background-size:contain;background-repeat:no-repeat;background-position:80% center;"></div>`
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
