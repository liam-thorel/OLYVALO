/**
 * Duos du roster : qui gagne avec qui.
 *
 * Portage du module du bot (discord-bot/synergy.js) vers l'ESM du site, avec
 * deux ajouts que l'écran permet et que Discord n'a pas : le rapprochement par
 * PUUID, et la restriction à la plage de temps affichée.
 *
 * Les deux implémentations doivent rester d'accord — tests/synergy-parity
 * les fait tourner sur les mêmes données et compare les classements. Une
 * divergence entre le site et Discord sur « qui joue bien avec qui » ne se
 * remarquerait pas, elle se discuterait.
 *
 * Deux sources, deux formes :
 *   Valorant  live/history/{matchId}/reports/{rapporteur} — chaque rapport
 *             liste les DIX joueurs avec leur équipe, donc un seul suffit.
 *   LoL       live/lolHistory/{clé} — une entrée PAR joueur, sans composition
 *             d'équipe. Deux membres d'une même partie sont coéquipiers si et
 *             seulement si leur résultat est identique.
 */

// En dessous, un winrate ne veut rien dire : deux games gagnées donnent 100 %.
export const MIN_DUO_GAMES = 3;

const lower = value => String(value || '').trim().toLowerCase();
const clean = value => String(value ?? '').trim();

/**
 * Index d'identification d'un joueur : PUUID d'abord, Riot ID en repli.
 *
 * Le PUUID survit aux renommages ; le nom, non. Les entrées d'historique
 * écrites avant sa publication n'en ont pas, d'où le repli — les exclure
 * amputerait le classement de tout l'historique ancien.
 */
export function memberIndex(members = []) {
  const byPuuid = new Map();
  const byRiotId = new Map();
  members.forEach(member => {
    (member?.puuids || []).forEach(puuid => {
      const key = clean(puuid);
      if (key && !byPuuid.has(key)) byPuuid.set(key, member.name);
    });
    (member?.riotIds || []).forEach(riotId => {
      const key = lower(riotId);
      if (key && !byRiotId.has(key)) byRiotId.set(key, member.name);
    });
  });
  return { byPuuid, byRiotId };
}

function resolve(index, { puuid = '', name = '' }) {
  return index.byPuuid.get(clean(puuid)) || index.byRiotId.get(lower(name)) || null;
}

const pairKey = (a, b) => [a, b].sort().join(' + ');

function bump(pairs, a, b, won) {
  const key = pairKey(a, b);
  const entry = pairs.get(key) || { games: 0, wins: 0 };
  entry.games += 1;
  if (won) entry.wins += 1;
  pairs.set(key, entry);
}

function summarize(pairs, minGames) {
  return [...pairs.entries()]
    .map(([duo, { games, wins }]) => ({
      duo, games, wins,
      losses: games - wins,
      winrate: Math.round((wins / games) * 100),
      members: duo.split(' + '),
    }))
    .filter(entry => entry.games >= minGames)
    // À winrate égal, celui qui a le plus de games passe devant : il est mieux
    // établi.
    .sort((a, b) => b.winrate - a.winrate || b.games - a.games);
}

/**
 * Duos Valorant.
 *
 * Le résultat d'un rapport est celui du RAPPORTEUR : pour un membre de
 * l'équipe adverse, il faut l'inverser. Sans ça, un duo qui affronte le
 * rapporteur verrait ses défaites comptées comme des victoires.
 */
export function valorantDuos(historyRoot, members = [], { minGames = MIN_DUO_GAMES, since = 0 } = {}) {
  const index = memberIndex(members);
  const pairs = new Map();

  Object.values(historyRoot || {}).forEach(match => {
    // Un stack produit un rapport par joueur, tous décrivant la même partie :
    // un seul suffit, sinon la game compterait plusieurs fois.
    const report = Object.values(match?.reports || {})
      .find(entry => Array.isArray(entry?.players) && entry.players.length && entry.selfTeam);
    if (!report) return;
    // Classé uniquement, comme partout ailleurs : une synergie mesurée sur des
    // unrated ne dit rien du classé.
    if (lower(report.mode) !== 'competitive') return;
    if (report.result !== 'win' && report.result !== 'loss') return; // égalité, partie incomplète
    if (since && Number(report.ts || report.endTs || 0) < since) return;

    const byTeam = new Map();
    report.players.forEach(player => {
      const name = resolve(index, { puuid: player?.puuid, name: player?.name });
      if (!name || !player.team || player.team === 'NEUTRAL') return;
      if (!byTeam.has(player.team)) byTeam.set(player.team, new Set());
      byTeam.get(player.team).add(name);
    });

    byTeam.forEach((names, team) => {
      if (names.size < 2) return;
      const won = team === report.selfTeam ? report.result === 'win' : report.result === 'loss';
      const sorted = [...names].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) bump(pairs, sorted[i], sorted[j], won);
      }
    });
  });

  return summarize(pairs, minGames);
}

/**
 * Identifiant de partie d'une entrée LoL. Les entrées écrites avant l'ajout du
 * champ ne le portent que dans leur clé, suffixée du nom du joueur.
 */
export function lolMatchIdOf(key, entry) {
  if (entry?.matchId) return String(entry.matchId);
  const suffix = `-${String(entry?.playerName || '').replace(/[.#$[\]/]/g, '_')}`;
  return key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
}

/**
 * Duos LoL.
 *
 * L'historique n'a pas de composition d'équipe : deux membres d'une même
 * partie sont coéquipiers si et seulement si leur résultat est identique. Deux
 * membres aux résultats opposés se sont affrontés — ce n'est pas un duo.
 */
export function lolDuos(lolHistory, members = [], { minGames = MIN_DUO_GAMES, since = 0 } = {}) {
  const index = memberIndex(members);
  const byMatch = new Map();

  Object.entries(lolHistory || {}).forEach(([key, entry]) => {
    if (typeof entry?.win !== 'boolean') return;
    if (since && Number(entry.ts || 0) < since) return;
    const name = resolve(index, { puuid: entry?.puuid, name: entry?.playerName });
    if (!name) return;
    const matchId = lolMatchIdOf(key, entry);
    if (!byMatch.has(matchId)) byMatch.set(matchId, []);
    // Un même joueur peut avoir deux entrées (rejeu, correction) : on n'en
    // garde qu'une, sinon il formerait un duo avec lui-même.
    const seen = byMatch.get(matchId);
    if (!seen.some(row => row.name === name)) seen.push({ name, win: entry.win });
  });

  const pairs = new Map();
  byMatch.forEach(rows => {
    if (rows.length < 2) return;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].win !== rows[j].win) continue; // adversaires, pas coéquipiers
        bump(pairs, rows[i].name, rows[j].name, rows[i].win);
      }
    }
  });

  return summarize(pairs, minGames);
}

/** Le classement du jeu affiché. */
export function duoRanking(game, history, members, options) {
  return game === 'lol' ? lolDuos(history, members, options) : valorantDuos(history, members, options);
}
