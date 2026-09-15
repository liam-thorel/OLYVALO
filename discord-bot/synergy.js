/**
 * Analyses croisées de l'historique : qui joue bien avec qui, et sur quelles
 * cartes. Volontairement sans dépendance — l'appelant fournit les données
 * brutes, ce module ne fait que les recouper.
 *
 * Deux sources, deux formes :
 *   Valorant  live/history/{matchId}/reports/{rapporteur} — chaque rapport
 *             liste les DIX joueurs avec leur équipe, donc un seul suffit à
 *             reconstituer la partie.
 *   LoL       live/lolHistory/{clé} — une entrée PAR joueur, sans liste
 *             d'équipe. Deux membres d'une même partie sont coéquipiers si et
 *             seulement si leur résultat est identique.
 */

const { isRankedValorantMode } = require('./game-modes.js');

// En dessous, un winrate ne veut rien dire : deux games gagnées donnent 100 %.
const MIN_DUO_GAMES = 3;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

/** Index Riot ID (minuscule) → membre, smurfs compris. */
function indexByRiotId(members = []) {
  const index = new Map();
  members.forEach(member => {
    (member.riotIds || []).forEach(riotId => {
      if (riotId) index.set(normalize(riotId), member);
    });
  });
  return index;
}

function emptyPair() {
  return { games: 0, wins: 0 };
}

function pairKey(a, b) {
  return [a, b].sort().join(' + ');
}

function summarize(pairs, minGames) {
  return [...pairs.entries()]
    .map(([duo, { games, wins }]) => ({
      duo,
      games,
      wins,
      losses: games - wins,
      winrate: Math.round((wins / games) * 100),
    }))
    .filter(entry => entry.games >= minGames)
    // À winrate égal, celui qui a le plus de games passe devant : il est mieux
    // établi.
    .sort((a, b) => b.winrate - a.winrate || b.games - a.games);
}

/**
 * Duos Valorant. Le résultat d'un rapport est celui du RAPPORTEUR : pour un
 * membre de l'équipe adverse, il faut l'inverser. Sans ça, un duo qui affronte
 * le rapporteur verrait ses défaites comptées comme des victoires.
 */
function valorantDuoStats(historyRoot, members, { minGames = MIN_DUO_GAMES } = {}) {
  const byRiotId = indexByRiotId(members);
  const pairs = new Map();

  Object.values(historyRoot || {}).forEach(match => {
    // Un stack produit un rapport par joueur, tous décrivant la même partie :
    // un seul suffit, sinon la game compterait plusieurs fois.
    const report = Object.values(match?.reports || {})
      .find(entry => Array.isArray(entry?.players) && entry.players.length && entry.selfTeam);
    if (!report) return;
    // Classé uniquement, comme partout ailleurs dans le projet : une
    // synergie mesurée sur des unrated ne dit rien du classé.
    if (!isRankedValorantMode(report.mode)) return;
    if (report.result !== 'win' && report.result !== 'loss') return; // égalité, partie incomplète

    const byTeam = new Map();
    report.players.forEach(player => {
      const member = byRiotId.get(normalize(player?.name));
      if (!member || !player.team || player.team === 'NEUTRAL') return;
      if (!byTeam.has(player.team)) byTeam.set(player.team, new Set());
      byTeam.get(player.team).add(member.name);
    });

    byTeam.forEach((names, team) => {
      if (names.size < 2) return;
      const won = team === report.selfTeam ? report.result === 'win' : report.result === 'loss';
      const sorted = [...names].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = pairKey(sorted[i], sorted[j]);
          const entry = pairs.get(key) || emptyPair();
          entry.games += 1;
          if (won) entry.wins += 1;
          pairs.set(key, entry);
        }
      }
    });
  });

  return summarize(pairs, minGames);
}

/**
 * Identifiant de partie d'une entrée LoL. Les entrées écrites avant l'ajout du
 * champ ne le portent que dans leur clé, suffixée du nom du joueur.
 */
function lolMatchIdOf(key, entry) {
  if (entry?.matchId) return String(entry.matchId);
  const suffix = `-${String(entry?.playerName || '').replace(/[.#$[\]/]/g, '_')}`;
  return key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
}

/**
 * Duos LoL. L'historique n'a pas de composition d'équipe : deux membres d'une
 * même partie sont coéquipiers si et seulement si leur résultat est identique.
 * Deux membres aux résultats opposés se sont affrontés — ce n'est pas un duo.
 */
function lolDuoStats(lolHistory, members, { minGames = MIN_DUO_GAMES } = {}) {
  const byRiotId = indexByRiotId(members);
  const byMatch = new Map();

  Object.entries(lolHistory || {}).forEach(([key, entry]) => {
    if (typeof entry?.win !== 'boolean') return;
    const member = byRiotId.get(normalize(entry.playerName));
    if (!member) return;
    const matchId = lolMatchIdOf(key, entry);
    if (!byMatch.has(matchId)) byMatch.set(matchId, []);
    // Un même joueur peut avoir deux entrées (rejeu, correction) : on n'en
    // garde qu'une, sinon il formerait un duo avec lui-même.
    const seen = byMatch.get(matchId);
    if (!seen.some(row => row.name === member.name)) seen.push({ name: member.name, win: entry.win });
  });

  const pairs = new Map();
  byMatch.forEach(rows => {
    if (rows.length < 2) return;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].win !== rows[j].win) continue; // adversaires, pas coéquipiers
        const key = pairKey(rows[i].name, rows[j].name);
        const entry = pairs.get(key) || emptyPair();
        entry.games += 1;
        if (rows[i].win) entry.wins += 1;
        pairs.set(key, entry);
      }
    }
  });

  return summarize(pairs, minGames);
}

/**
 * Bilan par carte d'un joueur Valorant : winrate, K/D et moyennes.
 * LoL n'a pas d'équivalent — une seule carte par mode.
 */
function valorantMapStats(historyRoot, riotIds = []) {
  const wanted = new Set(riotIds.map(normalize).filter(Boolean));
  const byMap = new Map();
  const countedMatches = new Set();

  Object.entries(historyRoot || {}).forEach(([matchKey, match]) => {
    Object.values(match?.reports || {}).forEach(report => {
      if (!isRankedValorantMode(report?.mode)) return;
      const self = (report?.players || []).find(player => wanted.has(normalize(player?.name)));
      if (!self) return;
      // Un stack produit plusieurs rapports de la même partie, tous contenant
      // ce joueur : sans ce garde, sa game compterait deux fois.
      const matchId = report.matchId || matchKey;
      if (countedMatches.has(matchId)) return;
      countedMatches.add(matchId);

      const map = report.map || 'Inconnue';
      if (!byMap.has(map)) {
        byMap.set(map, { map, games: 0, wins: 0, decided: 0, kills: 0, deaths: 0, assists: 0, acs: 0, acsGames: 0 });
      }
      const row = byMap.get(map);
      row.games += 1;
      if (report.result === 'win' || report.result === 'loss') {
        row.decided += 1;
        if (report.result === 'win') row.wins += 1;
      }
      row.kills += Number(self.stats?.kills || 0);
      row.deaths += Number(self.stats?.deaths || 0);
      row.assists += Number(self.stats?.assists || 0);
      if (self.stats?.acs != null) { row.acs += Number(self.stats.acs); row.acsGames += 1; }
    });
  });

  return [...byMap.values()]
    .map(row => ({
      map: row.map,
      games: row.games,
      wins: row.wins,
      losses: row.decided - row.wins,
      // null plutôt que 0 quand aucune partie n'a de vainqueur connu : afficher
      // « 0 % » laisserait croire à une série de défaites.
      winrate: row.decided ? Math.round((row.wins / row.decided) * 100) : null,
      kd: row.deaths ? Number((row.kills / row.deaths).toFixed(2)) : row.kills || 0,
      kda: `${row.kills}/${row.deaths}/${row.assists}`,
      acs: row.acsGames ? Math.round(row.acs / row.acsGames) : null,
    }))
    .sort((a, b) => (b.winrate ?? -1) - (a.winrate ?? -1) || b.games - a.games);
}

module.exports = { valorantDuoStats, lolDuoStats, valorantMapStats, lolMatchIdOf, MIN_DUO_GAMES };
