const MODE_LABELS = Object.freeze({
  competitive: 'Compétitif',
  unrated: 'Non classé',
  swiftplay: 'Vélocité',
  spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch',
  hurm: 'Team Deathmatch',
  ggteam: 'Intensification',
  onefa: 'Réplication',
  snowball: 'Bataille de boules de neige',
  newmap: 'Nouvelle carte',
  premier: 'Premier',
  custom: 'Partie personnalisée',
  aros: 'All Random One Site',
  dodgeball: 'K.-O.',
  fortcollins: 'Retake',
  skirmish: 'Escarmouche',
  skirmishascension: 'Escarmouche : Ascension',
  bottraining: 'Partie contre des bots',
  npe: 'Entraînement de base',
  standard: 'Standard',
});

const DIRECT_ALIASES = Object.freeze({
  competitive: 'competitive',
  unrated: 'unrated',
  swiftplay: 'swiftplay',
  spikerush: 'spikerush',
  deathmatch: 'deathmatch',
  hurm: 'hurm',
  ggteam: 'ggteam',
  onefa: 'onefa',
  snowball: 'snowball',
  newmap: 'newmap',
  premier: 'premier',
  custom: 'custom',
  aros: 'aros',
  dodgeball: 'dodgeball',
  fortcollins: 'fortcollins',
  skirmish: 'skirmish',
  skirmishascension: 'skirmishascension',
  teamdeathmatch: 'hurm',
  tdm: 'hurm',
  escalation: 'ggteam',
  replication: 'onefa',
  retake: 'fortcollins',
  knockout: 'dodgeball',
  allrandomonesite: 'aros',
});

function modeToken(value) {
  return String(value || '')
    .trim()
    .replace(/^social_mode_/i, '')
    .split('/').pop()
    .split('.')[0]
    .replace(/_primaryasset.*$/i, '')
    .replace(/_gamemode.*$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function canonicalFromToken(token) {
  if (!token) return '';
  if (DIRECT_ALIASES[token]) return DIRECT_ALIASES[token];
  if (token.includes('deathmatch')) return 'deathmatch';
  if (token.includes('quickbomb')) return 'spikerush';
  if (token.includes('gungame')) return 'ggteam';
  if (token.includes('oneforall')) return 'onefa';
  if (token.includes('snowballfight')) return 'snowball';
  if (token.includes('skirmishascension')) return 'skirmishascension';
  if (token.includes('skirmish')) return 'skirmish';
  if (token.includes('fortcollins')) return 'fortcollins';
  if (token.includes('dodgeball')) return 'dodgeball';
  if (token.includes('bottraining')) return 'bottraining';
  if (token.includes('npev2') || token.includes('newplayerexperience')) return 'npe';
  if (token.includes('bomb')) return 'standard';
  return '';
}

function normalizeValorantMode(...candidates) {
  let firstUnknown = '';
  let genericFallback = '';
  for (const candidate of candidates) {
    const token = modeToken(candidate);
    if (!token) continue;
    const canonical = canonicalFromToken(token);
    // Bomb is shared by ranked/unrated/custom games: do not discard a more
    // precise queue found in another field just because its asset is known.
    if (canonical === 'standard') {
      genericFallback = canonical;
      continue;
    }
    if (canonical) return canonical;
    if (!firstUnknown) firstUnknown = token;
  }
  return genericFallback || firstUnknown;
}

function valorantModeLabel(mode) {
  const canonical = normalizeValorantMode(mode);
  if (MODE_LABELS[canonical]) return MODE_LABELS[canonical];
  if (!canonical) return 'Mode Riot';
  return canonical.replace(/\b\w/g, letter => letter.toUpperCase());
}

function valorantModeFamily(mode) {
  const canonical = normalizeValorantMode(mode);
  if (canonical === 'deathmatch') return 'free-for-all';
  if (canonical === 'hurm') return 'team-deathmatch';
  if (['competitive', 'unrated', 'swiftplay', 'premier', 'newmap', 'custom', 'standard'].includes(canonical)) return 'tactical';
  return canonical ? 'arcade' : 'unknown';
}

function supportsStandardComps(mode) {
  return ['competitive', 'unrated', 'swiftplay', 'premier', 'newmap', 'custom', 'standard']
    .includes(normalizeValorantMode(mode));
}

module.exports = {
  MODE_LABELS,
  modeToken,
  normalizeValorantMode,
  valorantModeLabel,
  valorantModeFamily,
  supportsStandardComps,
};
