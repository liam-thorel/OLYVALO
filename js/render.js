/**
 * OLYCITY · Renderers
 * Pure data → HTML functions.
 */

import { valorantApi } from './api.js';
import { state } from './state.mjs?v=20260806-lol-roster';
import { formatRelTime } from './storage.js';
import { avatarLayersHTML } from './avatars.mjs?v=20260720-avatars';

// ─── Agent YouTube trailers (IDs officiels Riot) ──
// Fallback sur background art si YouTube bloque l'embed
const AGENT_TRAILERS = {
  'Jett':      { id:'xU2U73Tk-DM' },
  'Raze':      { id:'2-uAL__pp_U' },
  'Viper':     { id:'9dOSy0EhLfQ' },
  'Skye':      { id:'C3QTyMXi-WE' },
  'KAY/O':     { id:'eU1l7eBy2_Y' },
  'Chamber':   { id:'FUoqAn5T4h4' },
  'Killjoy':   { id:'ua-iIRQDY8g' },
  'Yoru':      { id:'GdOEQv-zQVw' },
  'Astra':     { id:'-ylVnuPWlJM' },
  'Gekko':     { id:'lLHBF24FciI' },
  'Clove':     { id:'GMUMNyoHAug' },
  'Sage':      { id:'1aRwM_QsqQI' },
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
  'Veto':      { id:'Q4ZdRYQmHvM' },
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
// ─── COMP PANEL ──────────────────────────────────
export function compHTML(comp, mapIdx, compIdx) {
  const presets = Array.isArray(comp.teamPresets) ? comp.teamPresets : [];
  const presetIndex = Math.min(comp.selectedPreset || 0, Math.max(0, presets.length - 1));
  const preset = presets[presetIndex];
  const displayedAgents = preset?.agents || comp.agents;
  const agents = displayedAgents.map(n => {
    const isKey = !preset && comp.key === n;
    const card = agentCardHTML(n);
    if (!isKey) return card;
    // Wrap key agent with a "key pick" indicator
    return card.replace('class="agent-card"', 'class="agent-card key-agent"');
  }).join('');
  const tierCls = comp.tier === 'S' ? 'tier-s' : comp.tier === 'FUN' ? 'tier-f' : comp.tier === 'PRO' ? 'tier-pro' : 'tier-a';
  const reference = preset?.url ? { url:preset.url } : comp.vods?.[0];
  const source = preset ? `${preset.team} · ${preset.event}` : comp.source;
  const presetDate = preset?.date
    ? new Intl.DateTimeFormat('fr-FR', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${preset.date}T12:00:00`))
    : '';
  const presetPicker = presets.length ? `
        <div class="pro-team-picker" role="tablist" aria-label="Choisir une composition professionnelle">
          ${presets.map((team, index) => `
            <button class="pro-team-btn ${index === presetIndex ? 'active' : ''}" type="button" role="tab"
              aria-selected="${index === presetIndex}" title="Composition de ${team.team}"
              onclick="window.OLYCITY.switchProPreset(${mapIdx},${compIdx},${index},this)">
              <img src="${team.logo}" alt="" loading="lazy">
              <span><strong>${team.tag}</strong><small>${team.team}</small></span>
            </button>`).join('')}
        </div>
        <div class="pro-match-meta">
          <img src="${preset.logo}" alt="Logo ${preset.team}">
          <div><strong>${preset.team}</strong><span>${preset.event} · contre ${preset.opponent} · ${preset.score} · ${presetDate}</span></div>
        </div>` : '';
  const plan = comp.tip ? `
        <details class="comp-mobile-details">
          <summary><span>Plan de jeu</span><strong>Voir</strong></summary>
        </details>
        <div class="comp-bottom">
          <div class="comp-bottom-left">
            <div class="tip-box">
              <span class="tip-icon">5-STACK</span>
              <span class="tip-text">${comp.tip}</span>
            </div>
          </div>
        </div>` : '';
  const referenceLink = reference
    ? `<a class="comp-reference" href="${reference.url}" target="_blank" rel="noopener noreferrer">${comp.tier === 'PRO' ? 'Voir le match' : 'Voir la source'} ↗</a>`
    : '';
  return `
    <div class="comp-panel ${compIdx === 0 ? 'active' : ''}" id="panel-${mapIdx}-${compIdx}">
      <div class="comp-card">
        <div class="comp-header">
          <div class="comp-label-row">
            <span class="comp-tier ${tierCls}">${comp.tierLabel}</span>
            <span class="comp-name">${comp.label}</span>
            ${comp.patch && state.META?.currentPatch && comp.patch !== state.META.currentPatch
              ? `<span class="comp-outdated" title="Comp du patch ${comp.patch}">⚠ Patch ${comp.patch}</span>`
              : comp.updatedAt ? `<span class="comp-updated">Maj ${comp.updatedAt}</span>` : ''}
          </div>
        </div>
        ${presetPicker}
        <div class="agents-grid">${agents}</div>
        <div class="comp-card-actions">
          <button class="share-comp-btn" onclick="window.OLYCITY.shareComp(${mapIdx},${compIdx},this)">↗ Partager</button>
        </div>
        ${plan}
        <div class="comp-card-footer">
          <span class="comp-source">Source : ${source}</span>
          ${referenceLink}
        </div>
      </div>
    </div>`;
}

// ─── LINEUPS INDIVIDUELS ─────────────────────────
function lineupsHTML(mapName) {
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
      return `<div class="lineup-v2-card" style="cursor:pointer"
        data-vid="${l.videoId}" data-start="${l.start||0}"
        data-name="${l.name.replace(/"/g,'&quot;')}"
        data-type="${l.type}" data-diff="${l.diff}"
        data-desc="${l.desc.replace(/"/g,'&quot;')}"
        onclick="window.OLYCITY.openLineupCard(this)">
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

// ─── MAP SECTION ─────────────────────────────────
export function mapSectionHTML(data, idx) {
  const splash = valorantApi.mapSplash(data.map);
  const splashEl = splash
    ? `<img class="map-hero-img" src="${splash}" alt="${data.map}" loading="lazy">`
    : `<div class="map-hero-img" style="background:var(--surf3)"></div>`;
  const tags = data.tags.map(t => `<span class="map-tag">${t}</span>`).join('');
  const tabs = data.comps.map((c, ci) => {
    const isFun = c.tier === 'FUN' || c.tier === 'F';
    const isPro = c.tier === 'PRO';
    const cls = isFun ? 'fun-tab' : isPro ? 'pro-tab' : '';
    const emoji = isFun ? '🎉 ' : isPro ? '🏆 ' : '';
    return `<button class="comp-tab ${ci === 0 ? 'active' : ''} ${cls}"
      onclick="window.OLYCITY.switchComp(${idx},${ci},this)">${emoji}${c.label}</button>`;
  }).join('');
  const panels = data.comps.map((c, ci) => compHTML(c, idx, ci)).join('');
  const notes = data.notes.map(n =>
    `<div class="note-row"><span class="note-marker"></span>${n}</div>`
  ).join('');

  const hasLineups = !!(state.LINEUPS?.[data.map] && Object.keys(state.LINEUPS[data.map]).length > 0);
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
            <div class="map-stat"><div class="map-stat-val">${data.stats.difficulty}</div><div class="map-stat-lbl">Difficulté</div></div>
            <div class="map-stat" style="max-width:160px"><div class="map-stat-val" style="font-size:clamp(14px,1.5vw,22px)">${data.stats.sides}</div><div class="map-stat-lbl">Équilibre</div></div>
            ${data.stats.bestSite ? `<div class="map-stat"><div class="map-stat-val" style="font-size:clamp(14px,1.5vw,22px);color:var(--red)">${data.stats.bestSite}</div><div class="map-stat-lbl">Meilleur site ATK</div></div>` : ''}
          </div>
        </div>
      </div>

      <!-- Navigation volontairement limitée aux compos et aux lineups utiles. -->
      <div class="map-section-tabs">
        <button class="map-section-tab active" onclick="window.OLYCITY.switchMapTab('${idx}','comps',this)">◈ Comps</button>
        ${hasLineups ? `<button class="map-section-tab" onclick="window.OLYCITY.switchMapTab('${idx}','lineups',this)">📹 Lineups</button>` : ''}
      </div>

      <!-- COMPS TAB -->
      <div class="map-section-panel active" id="maptab-${idx}-comps">
        <div class="comp-tabs">${tabs}</div>
        ${panels}
        <details class="map-notes-card">
          <summary><span>Conseils pour ${data.map}</span><strong>${data.notes.length} repères</strong></summary>
          <div class="notes-list">${notes}</div>
        </details>
      </div>

      <!-- LINEUPS TAB -->
      ${hasLineups ? `<div class="map-section-panel" id="maptab-${idx}-lineups">
        ${lineupsHTML(data.map)}
      </div>` : ''}

    </section>`;
}

// ─── ROSTER ──────────────────────────────────────
export function rosterHTML() {
  return state.ROSTER.map((p) => {
    const stats = state.PLAYER_STATS[p.name] || {};
    const syncedAgentStats = Array.isArray(stats.topAgentStats) && stats.topAgentStats.length
      ? stats.topAgentStats
      : (stats.topAgents || []).map(name => ({ name, games: null }));
    // Après une vraie sync paginée, le top 3 de l'acte remplace les agents
    // manuels. Le JSON reste un fallback utile pour un compte privé/inactif.
    const displayMains = syncedAgentStats.length
      ? syncedAgentStats
      : (p.mains || []).filter(Boolean).map(name => ({ name, games: null }));

    const mains = displayMains.slice(0, 3).map(agent => {
      const name = typeof agent === 'string' ? agent : agent.name;
      const img = valorantApi.agentImg(name);
      const display = displayName(name);
      const hasGames = agent?.games !== null && agent?.games !== undefined && Number.isFinite(Number(agent.games));
      const gamesLabel = hasGames ? ` · ${agent.games} parties` : '';
      const imgEl = img
        ? `<img src="${img}" alt="${display}" loading="lazy">`
        : `<div class="portrait-ph" style="font-size:18px">${display[0]}</div>`;
      return `<div class="player-main" onclick="window.OLYCITY.showAgentPage('${name}')" title="${display}${gamesLabel}">
        ${imgEl}
        <div class="player-main-name">${display}${hasGames ? ` · ${agent.games}G` : ''}</div>
      </div>`;
    }).join('');

    const rankDisplay = stats.rank ? `
      <div class="player-rank">
        ${rankColorDot(stats.rank)}
        <span class="player-rank-text">${stats.rank}</span>
        ${stats.rr != null ? `<span class="player-rank-rr">${stats.rr}rr</span>` : ''}
      </div>` : '';

    const hasStats = stats.wr != null || stats.kd != null || stats.kda != null || stats.acs != null;
    const actLabel = stats.wrGames != null ? `${stats.wrGames}G · acte` : null;
    const ratio = stats.kd ?? stats.kda;
    const thirdMetric = stats.acs ?? stats.wrWins;
    const thirdLabel = stats.acs != null ? 'ACS' : 'Wins acte';
    const liveStatsRow = hasStats ? `
      <div class="player-stats-row">
        <div class="player-stat">
          <span class="player-stat-val ${(stats.wr ?? 0) >= 50 ? 'green' : 'red'}">${stats.wr != null ? stats.wr + '%' : '—'}</span>
          <span class="player-stat-lbl">WR${actLabel ? ` · ${stats.wrGames}G` : ''}</span>
        </div>
        <div class="player-stat">
          <span class="player-stat-val ${parseFloat(ratio) >= 1 ? 'green' : 'red'}">${ratio ?? '—'}</span>
          <span class="player-stat-lbl">K/D${stats.games > 0 ? ` · ${stats.games}G` : ''}</span>
        </div>
        <div class="player-stat">
          <span class="player-stat-val gold">${thirdMetric ?? '—'}</span>
          <span class="player-stat-lbl">${thirdLabel}</span>
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
        <div class="player-banner-avatar">${avatarLayersHTML(p.name, p.avatar, valorantApi.agentImg(p.mains?.[0]))}</div>
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
  }).join('') + `<div class="player-card add-player-card" onclick="window.OLYCITY.showAddPlayerForm()">
    <div class="player-banner add-player-banner">
      <div class="add-player-question">?</div>
    </div>
    <div class="player-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:90px">
      <div class="add-player-icon">+</div>
      <div class="player-name" style="font-size:14px;letter-spacing:3px;color:var(--dim)">NOUVEAU</div>
      <div class="player-role" style="text-align:center;letter-spacing:2px;font-size:9px">Ajouter un joueur</div>
    </div>
  </div>`;
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
    const splash = valorantApi.mapSplash(d.map);
    const icon   = valorantApi.mapIcon(d.map);
    return `<button class="nav-map-btn ${i === 0 ? 'active' : ''}"
      onclick="window.OLYCITY.showMap(${i},this)" data-map-idx="${i}"
      ${splash ? `style="--map-splash:url(${splash})"` : ''}>
      ${icon ? `<div class="nav-map-icon"><img src="${icon}" alt=""></div>` : ''}
      <span class="nav-map-label">${d.map}</span>
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
        usage.push({ map: map.map, mapIdx: mi, compIdx: ci, label: comp.label, tier: comp.tier });
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
  const pronoun = ['Jett','Raze','Sage','Viper','Skye','Reyna','Astra','Neon','Fade','Killjoy','Clove','Deadlock','Waylay','Vyse'].includes(name) ? 'elle joue' : 'il joue';
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
              <span class="usage-tier ${u.tier}">${u.tier === 'S' ? 'RANKED' : u.tier}</span>
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
  const mapCount = new Set(usage.map(item => item.map)).size;
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
      <iframe
        class="agent-hero-video"
        src="${src}"
        allow="autoplay; encrypted-media"
        frameborder="0"
        title="${displayName(name)} cinematic"
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
          <p class="agent-bio">${frData.bio || apiData?.desc || 'Biographie indisponible.'}</p>
            <div class="agent-quick-stats">
              <div class="aqs"><div class="aqs-val">${pickCount}</div><div class="aqs-lbl">Comp${pickCount>1?'s':''} OLYCITY</div></div>
            <div class="aqs"><div class="aqs-val">${mapCount}</div><div class="aqs-lbl">Map${mapCount>1?'s':''}</div></div>
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
                    <h2 class="sec-title">Dans quelles compos ${pronoun}</h2>
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

// ─── GUEST CARD ──────────────────────────────────
export function guestCardHTML() {
  return `<div class="guest-card-full">
    <div class="guest-card-full-inner">
      <div class="guest-card-left">
        <div class="guest-card-title">Recherche de joueur</div>
        <div class="guest-card-subtitle">Entre un Riot ID pour voir le profil d'un fill ou d'un ennemi</div>
        <div class="guest-input-row">
          <input type="text" id="guest-name" class="guest-input" placeholder="Pseudo" autocomplete="off">
          <span class="guest-input-sep">#</span>
          <input type="text" id="guest-tag" class="guest-tag-input" placeholder="TAG" autocomplete="off">
        </div>
      </div>
      <div class="guest-card-btns">
        <a class="guest-link-btn tracker" href="#" target="_blank" rel="noopener"
          onclick="return window.OLYCITY.guestOpen('tracker', event)">
          <span class="guest-btn-icon">↗</span>
          <span class="guest-btn-text">
            <span class="guest-btn-name">Tracker.gg</span>
            <span class="guest-btn-sub">Stats · Historique · Rank</span>
          </span>
        </a>
    </div>
  </div>`;
}
