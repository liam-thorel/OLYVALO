/**
 * OLYCITY · valorant-api.com client
 * Fetches agents, maps, and provides image accessors.
 */

const BASE = 'https://valorant-api.com/v1';
const CACHE_KEY = 'olycity-valorant-visuals';

export const valorantApi = {
  agents: {},
  maps: {},

  async load({ timeoutMs = 3_500 } = {}) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached?.agents && cached?.maps) {
        this.agents = cached.agents;
        this.maps = cached.maps;
      }
    } catch {}

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let agJson;
    let mapJson;
    try {
      const [agRes, mapRes] = await Promise.all([
        fetch(`${BASE}/agents?isPlayableCharacter=true`, { signal:controller.signal }),
        fetch(`${BASE}/maps`, { signal:controller.signal }),
      ]);
      if (!agRes.ok || !mapRes.ok) throw new Error('valorant-api unreachable');
      [agJson, mapJson] = await Promise.all([agRes.json(), mapRes.json()]);
    } catch (error) {
      console.warn('[OLYCITY] Visuels Valorant en cache ou indisponibles', error);
      return Boolean(Object.keys(this.agents).length || Object.keys(this.maps).length);
    } finally { clearTimeout(timer); }

    agJson.data.forEach(a => {
      this.agents[a.displayName] = {
        portrait: a.bustPortrait || a.fullPortrait || a.displayIcon,
        fullPortrait: a.fullPortrait,
        background: a.background,
        gradientColors: a.backgroundGradientColors || [],
        icon: a.displayIcon,
        role: a.role?.displayName,
        desc: a.description, // official Valorant description
        abilities: a.abilities || [],
      };
    });

    mapJson.data.forEach(m => {
      this.maps[m.displayName] = {
        splash: m.splash,
        icon: m.displayIcon,
      };
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ agents:this.agents, maps:this.maps })); } catch {}
    return true;
  },

  agentImg(name) {
    return this.agents[name]?.portrait || this.agents[name]?.icon || null;
  },

  agentFullImg(name) {
    return this.agents[name]?.fullPortrait || this.agents[name]?.portrait || null;
  },

  agentBackground(name) {
    return this.agents[name]?.background || null;
  },

  agentGradient(name) {
    const colors = this.agents[name]?.gradientColors || [];
    if (colors.length >= 2) {
      return `linear-gradient(135deg, #${colors[0]}cc 0%, #${colors[1]}99 40%, #${colors[colors.length-1]}44 100%)`;
    }
    return null;
  },

  agentData(name) {
    return this.agents[name] || this.agents[name.replace('/', '')] || null;
  },

  mapSplash(name) {
    return this.maps[name]?.splash || null;
  },

  mapIcon(name) {
    return this.maps[name]?.icon || null;
  },
};
