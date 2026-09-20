export const state = {
  COMPS_DATA: [],
  ROSTER: [],
  // Comptes et puuids enregistrés depuis l'admin (Firebase `rosterOverlay`).
  // Les cartes du roster n'en tenaient pas compte : tout compte ajouté
  // ailleurs que dans le dépôt restait invisible à l'écran.
  ROSTER_OVERLAY: null,
  MEMBERS: [],
  ROLES: {},
  ROLE_LABEL: {},
  ROLE_FULL: {},
  S_TIER: [],
  GLOBAL_NOTES: [],
  AGENT_FR: {},
  PLAYER_STATS: {},
  currentPage: 'home',
  currentProfile: null,
  currentMapIdx: 0,
  LINEUPS: {},
  META: {},
  currentCompIdx: {},
};
