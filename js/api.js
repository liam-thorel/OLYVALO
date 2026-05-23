/**
 * OLYCITY · valorant-api.com client
 * Fetches agents, maps, and provides image accessors.
 */

const BASE = 'https://valorant-api.com/v1';

export const valorantApi = {
  agents: {},
  maps: {},

  async load() {
    const [agRes, mapRes] = await Promise.all([
      fetch(`${BASE}/agents?isPlayableCharacter=true`),
      fetch(`${BASE}/maps`),
    ]);
    if (!agRes.ok || !mapRes.ok) throw new Error('valorant-api unreachable');
    const [agJson, mapJson] = await Promise.all([agRes.json(), mapRes.json()]);

    agJson.data.forEach(a => {
      this.agents[a.displayName] = {
        portrait: a.bustPortrait || a.fullPortrait || a.displayIcon,
        fullPortrait: a.fullPortrait,
        background: a.background,
        gradientColors: a.backgroundGradientColors || [],
        icon: a.displayIcon,
        role: a.role?.displayName,
        desc: a.description,
        abilities: a.abilities || [],
      };
    });

    mapJson.data.forEach(m => {
      this.maps[m.displayName] = {
        splash: m.splash,
        icon: m.displayIcon,
      };
    });
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
