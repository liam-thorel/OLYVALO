/**
 * Historique perso partagé — utilisé par le moteur de cotes (odds.js) et par
 * la commande /stats. Source de vérité : live/lolHistory (LoL) et
 * live/history/*\/reports (Valorant), alimentés par les scripts locaux à
 * chaque fin de game.
 */
const { fbGet } = require('./firebase.js');

const HISTORY_SAMPLE_SIZE = 20;

const lower = value => String(value || '').trim().toLowerCase();

/**
 * Identité d'un membre, sous la forme que consomment les lecteurs
 * d'historique. Accepte encore un simple tableau de Riot ID pour ne rien
 * casser chez un appelant oublié, mais c'est le membre complet qu'il faut
 * passer : lui seul porte l'identifiant stable.
 */
function identityOf(member) {
  if (Array.isArray(member)) return { id: '', riotIds: member, puuids: [] };
  return {
    id: String(member?.id || ''),
    riotIds: member?.riotIds || [],
    puuids: (member?.puuids || []).map(String).filter(Boolean),
  };
}

/**
 * Historique LoL d'un membre.
 *
 * Les entrées ne portent pas de puuid, mais elles portent `memberId` — écrit
 * par le script à l'installation, insensible aux renommages. On s'appuie
 * dessus en priorité ; le Riot ID ne sert plus que pour les entrées écrites
 * avant que ce champ n'existe.
 */
async function lolHistoryFor(member) {
  const identity = identityOf(member);
  const names = new Set(identity.riotIds.map(lower));
  const history = await fbGet('live/lolHistory').catch(() => null);
  return Object.values(history || {})
    .filter(entry => (identity.id && entry.memberId === identity.id) || names.has(lower(entry.playerName)))
    // Même champ que côté Valorant, pour que les récaps traitent les deux jeux
    // de la même façon.
    .map(entry => ({ ...entry, account: entry.playerName || '' }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

async function valorantHistoryFor(member) {
  const identity = identityOf(member);
  const names = new Set(identity.riotIds.map(lower));
  const puuids = new Set(identity.puuids);
  const historyRoot = await fbGet('live/history').catch(() => null);
  const allReports = [];
  Object.values(historyRoot || {}).forEach(match => {
    Object.values(match?.reports || {}).forEach(report => allReports.push(report));
  });

  const mapped = allReports
    .map(report => {
      // Le puuid d'abord : identifiant Riot permanent, il survit aux
      // renommages là où le Riot ID d'un vieux rapport ne correspond plus à
      // celui déclaré dans le roster. Le nom reste en repli pour les comptes
      // dont le puuid n'a pas encore été enregistré.
      const self = (report.players || []).find(p => p.puuid && puuids.has(String(p.puuid)))
        || (report.players || []).find(p => names.has(lower(p.name)));
      if (!self) return null;
      // report.rr est le rang APRÈS-MATCH précis, mais il n'appartient qu'au
      // joueur dont le script a généré ce rapport (report.playerPuuid) — pas
      // à n'importe quel joueur listé dans report.players. Quand deux membres
      // du roster sont stackés dans la même game, chacun a SON PROPRE rapport
      // (un par script) ; on n'attribue donc rr/tier que si self EST le
      // reporter, sinon on laisse null plutôt que de reprendre par erreur le
      // rang d'un coéquipier.
      const isReporter = report.playerPuuid && self.puuid && report.playerPuuid === self.puuid;
      return {
        matchId: report.matchId || '',
        // Compte ayant réellement joué cette partie. Un membre peut en avoir
        // plusieurs, à des rangs très différents : les fondre donnait un rang
        // et un winrate qui n'appartenaient à aucun des deux.
        account: self.name || '',
        // Dit si tier/rr sont renseignés : seul le rapporteur porte son rang.
        isReporter: !!isReporter,
        win: report.result === 'win' ? true : report.result === 'loss' ? false : null,
        champion: self.agent ? { name: self.agent } : null,
        kills: self.stats?.kills ?? null,
        deaths: self.stats?.deaths ?? null,
        assists: self.stats?.assists ?? null,
        hsPercent: self.stats?.hsPercent ?? null,
        acs: self.stats?.acs ?? null,
        map: report.map || '',
        mode: report.mode || '',
        tier: isReporter ? (report.rr?.tier ?? null) : null,
        rr: isReporter ? (report.rr?.after ?? null) : null,
        ts: report.ts || report.endTs || 0,
      };
    })
    .filter(Boolean);

  return dedupeByMatch(mapped).sort((a, b) => b.ts - a.ts);
}

/**
 * Quand plusieurs membres du roster jouent la même game, chaque script publie
 * SON rapport — et chaque rapport liste les dix joueurs. Un joueur se
 * retrouvait donc dans le rapport de ses coéquipiers autant que dans le sien :
 * une game jouée en stack de cinq comptait cinq fois.
 *
 * Le winrate et les moyennes n'en souffraient pas (les doublons sont
 * identiques), ce qui a masqué le problème ; mais le nombre de games, la frise
 * de résultats et la fenêtre des 20 dernières games, elles, étaient fausses.
 */
function dedupeByMatch(entries) {
  const byMatch = new Map();
  // Les rapports d'avant l'ajout du matchId ne peuvent pas être regroupés :
  // les fusionner sur une clé approchée risquerait d'effacer de vraies games.
  const withoutMatchId = [];

  entries.forEach(entry => {
    if (!entry.matchId) {
      withoutMatchId.push(entry);
      return;
    }
    const kept = byMatch.get(entry.matchId);
    // À doublon égal on garde le rapport écrit par le joueur lui-même : c'est
    // le seul qui porte son rang, les autres l'ont à null.
    if (!kept || (entry.isReporter && !kept.isReporter)) byMatch.set(entry.matchId, entry);
  });

  return [...byMatch.values(), ...withoutMatchId];
}

async function historyFor(game, member) {
  return game === 'lol' ? lolHistoryFor(member) : valorantHistoryFor(member);
}

async function winrateFor(game, member, championOrAgentName) {
  const entries = await historyFor(game, member);
  const withResult = entries.filter(e => typeof e.win === 'boolean');
  const recent = withResult.slice(0, HISTORY_SAMPLE_SIZE);
  const overall = recent.length ? recent.filter(e => e.win).length / recent.length : null;

  const onChampion = championOrAgentName ? withResult.filter(e => e.champion?.name === championOrAgentName) : [];
  const champion = onChampion.length ? onChampion.filter(e => e.win).length / onChampion.length : null;

  return { overall, champion, sampleSize: recent.length, championSampleSize: onChampion.length };
}

function mostPlayed(entries, limit = 3) {
  const counts = new Map();
  entries.forEach(entry => {
    const name = entry.champion?.name;
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

// Forme récente : tableau de booléens (true = victoire), le plus récent en premier.
function recentForm(entries, limit = 10) {
  return entries.filter(e => typeof e.win === 'boolean').slice(0, limit).map(e => e.win);
}

// Ratio kills/morts agrégé sur l'historique connu (0 si aucune mort ni kill).
function killDeathRatio(entries) {
  const totalKills = entries.reduce((sum, e) => sum + (e.kills || 0), 0);
  const totalDeaths = entries.reduce((sum, e) => sum + (e.deaths || 0), 0);
  if (totalDeaths === 0) return totalKills > 0 ? totalKills : 0;
  return totalKills / totalDeaths;
}

// KDA agrégé : (somme des kills + somme des assists) / somme des morts sur
// toutes les games — pas une moyenne des KDA individuels, qui pondérerait
// chaque game de façon égale peu importe combien de kills/morts elle contient.
function aggregateKDA(entries) {
  const withStats = entries.filter(e => e.kills != null && e.deaths != null);
  if (!withStats.length) return null;
  const totalKills = withStats.reduce((sum, e) => sum + (e.kills || 0), 0);
  const totalAssists = withStats.reduce((sum, e) => sum + (e.assists || 0), 0);
  const totalDeaths = withStats.reduce((sum, e) => sum + (e.deaths || 0), 0);
  if (totalDeaths === 0) return totalKills + totalAssists;
  return (totalKills + totalAssists) / totalDeaths;
}

// % de headshots moyen sur les games où la donnée est disponible.
// L'ACS moyen : meilleur indicateur d'impact qu'un KDA seul, et déjà présent
// dans chaque rapport de fin de game.
function averageAcs(entries) {
  const withAcs = entries.filter(entry => Number.isFinite(entry.acs));
  if (!withAcs.length) return null;
  return withAcs.reduce((sum, entry) => sum + entry.acs, 0) / withAcs.length;
}

function averageHsPercent(entries) {
  const withHs = entries.filter(e => typeof e.hsPercent === 'number');
  if (!withHs.length) return null;
  return withHs.reduce((sum, e) => sum + e.hsPercent, 0) / withHs.length;
}

// CS moyen (LoL) sur les games où la donnée est disponible.
function averageCs(entries) {
  const withCs = entries.filter(e => typeof e.cs === 'number');
  if (!withCs.length) return null;
  return withCs.reduce((sum, e) => sum + e.cs, 0) / withCs.length;
}

// Les prédicats de mode vivent dans game-modes.js, sans dépendance, pour que
// d'autres modules puissent les utiliser sans tirer Firebase avec eux.
const {
  RANKED_VALORANT_MODE, isRankedValorantMode, isValorantDeathmatch,
  RANKED_LOL_QUEUES, isRankedLolQueue, isNonRankedLolQueue,
} = require('./game-modes.js');

// Bilan d'une série de games : « 53% WR (5-4) ». Le pourcentage seul ment sur
// les petits échantillons — 100% sur une game n'est pas 100% sur vingt — donc
// le détail victoires-défaites l'accompagne toujours.
// Retourne null quand aucune game n'a de résultat connu : rien à afficher.
function winrateLabel(wins, decided) {
  if (!decided) return null;
  return `${Math.round((wins / decided) * 100)}% WR (${wins}-${decided - wins})`;
}

function rankedOnly(game, entries) {
  if (game === 'valorant') return entries.filter(e => isRankedValorantMode(e.mode));
  // Côté LoL on écarte seulement ce qu'on sait être hors classé : le script
  // live n'écrit d'historique que pour les files classées, donc un queueId
  // manquant sur une vieille entrée désigne une game classée, pas une ARAM.
  // Filtrer strictement viderait rétroactivement les stats de ces joueurs.
  if (game === 'lol') return entries.filter(e => !isNonRankedLolQueue(e.queueId));
  return entries;
}

module.exports = {
  historyFor, winrateFor, mostPlayed, recentForm, killDeathRatio, aggregateKDA, averageHsPercent, averageAcs, averageCs, HISTORY_SAMPLE_SIZE,
  rankedOnly, RANKED_VALORANT_MODE, isRankedValorantMode, isValorantDeathmatch,
  RANKED_LOL_QUEUES, isRankedLolQueue, isNonRankedLolQueue, winrateLabel,
};
