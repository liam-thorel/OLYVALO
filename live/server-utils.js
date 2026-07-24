const SERVER_NAMES = [
  ['paris', 'Paris'],
  ['frankfurt', 'Francfort'],
  ['london', 'Londres'],
  ['madrid', 'Madrid'],
  ['stockholm', 'Stockholm'],
  ['warsaw', 'Varsovie'],
  ['istanbul', 'Istanbul'],
  ['bahrain', 'Bahreïn'],
  ['dubai', 'Dubaï'],
  ['capetown', 'Le Cap'],
  ['cape-town', 'Le Cap'],
  ['tokyo', 'Tokyo'],
  ['singapore', 'Singapour'],
  ['hongkong', 'Hong Kong'],
  ['hong-kong', 'Hong Kong'],
  ['mumbai', 'Mumbai'],
  ['sydney', 'Sydney'],
  ['seoul', 'Séoul'],
  ['manila', 'Manille'],
  ['chicago', 'Chicago'],
  ['dallas', 'Dallas'],
  ['ashburn', 'Virginie'],
  ['nvirginia', 'Virginie'],
  ['oregon', 'Oregon'],
  ['california', 'Californie'],
  ['atlanta', 'Atlanta'],
  ['miami', 'Miami'],
  ['saopaulo', 'São Paulo'],
  ['sao-paulo', 'São Paulo'],
  ['santiago', 'Santiago'],
];

function riotServer(gamePodId, region = '') {
  const raw = String(gamePodId || '').trim();
  const normalized = raw.toLowerCase().replace(/[_\s]+/g, '-');
  const match = SERVER_NAMES.find(([token]) => normalized.includes(token));

  if (match) {
    return { name: match[1], gamePodId: raw };
  }

  const regionName = {
    eu: 'Europe',
    na: 'Amérique du Nord',
    latam: 'Amérique latine',
    br: 'Brésil',
    ap: 'Asie-Pacifique',
    kr: 'Corée',
  }[String(region || '').toLowerCase()];

  return raw || regionName
    ? { name: regionName || 'Serveur Riot', gamePodId: raw }
    : null;
}

module.exports = { riotServer };
