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
  // Ancien format, lu seulement : une entrée par NOM DE MEMBRE, décrivant son
  // compte principal.
  PLAYER_STATS: {},
  // Statistiques par COMPTE, indexées sur le PUUID (voir account-stats.mjs).
  ACCOUNT_STATS: {},
  // Compte affiché sur la carte de chaque joueur. Vide = son principal.
  SELECTED_ACCOUNT: {},
  currentPage: 'home',
  currentProfile: null,
  currentMapIdx: 0,
  LINEUPS: {},
  META: {},
  currentCompIdx: {},
};
