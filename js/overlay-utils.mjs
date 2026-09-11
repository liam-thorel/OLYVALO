/**
 * Sélection et mise en forme des données pour la vue overlay.
 *
 * Séparé du rendu pour être testable : cette vue s'affiche par-dessus une
 * partie en cours, c'est-à-dire au moment où l'on a le moins envie de
 * découvrir un bug.
 */

const AGENT_SELECT_MODES = new Set(['agent-select']);

/** Une session compte comme « en cours » si elle est active et récente. */
export function isLiveSession(session, now = Date.now(), maxAgeMs = 15 * 60 * 1000) {
  if (!session || session.active === false) return false;
  const ts = Number(session.ts || 0);
  if (!ts) return false;
  return now - ts <= maxAgeMs;
}

/**
 * Regroupe les sessions actives par partie. Deux membres du roster dans la
 * même game partagent un matchId : ils doivent apparaître comme un seul bloc,
 * pas comme deux parties distinctes.
 *
 * Une session sans matchId (Agent Select, rapport incomplet) ne peut être
 * regroupée avec rien : elle forme son propre bloc plutôt que de fusionner
 * par erreur avec une autre partie sans identifiant.
 */
export function groupActiveGames(sessions = {}, now = Date.now()) {
  const groups = new Map();
  Object.entries(sessions || {})
    .filter(([, session]) => isLiveSession(session, now))
    .sort(([, a], [, b]) => Number(b.ts || 0) - Number(a.ts || 0))
    .forEach(([key, session]) => {
      const groupKey = session.matchId ? `match:${session.matchId}` : `session:${key}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          matchId: session.matchId || '',
          map: session.mapClean || session.map || '',
          mode: session.mode || '',
          // Publiés par le script pour tous les modes : « Vélocité »,
          // « Deathmatch », « Intensification »… plutôt que le queueID brut.
          modeLabel: session.modeLabel || '',
          modeFamily: session.modeFamily || '',
          ts: Number(session.ts || 0),
          sessions: [],
        });
      }
      const group = groups.get(groupKey);
      group.sessions.push({ key, ...session });
      // La carte n'est pas toujours connue sur toutes les sessions d'une même
      // game : on garde la première valeur non vide rencontrée.
      if (!group.map) group.map = session.mapClean || session.map || '';
      if (!group.mode) group.mode = session.mode || '';
      if (!group.modeLabel) group.modeLabel = session.modeLabel || '';
      if (!group.modeFamily) group.modeFamily = session.modeFamily || '';
      group.ts = Math.max(group.ts, Number(session.ts || 0));
    });
  return [...groups.values()].sort((a, b) => b.ts - a.ts);
}

/** Ce qu'on écrit sur la pastille de mode. */
export function modeLabelFor(group) {
  if (group?.modeLabel) return group.modeLabel;
  // Ancienne version du script, ou mode inconnu : mieux vaut un libellé
  // générique que « ggteam » ou « onefa » affiché tel quel.
  return group?.mode ? 'En jeu' : '';
}

/**
 * Les modes sans équipes — Deathmatch, et tout ce que le script range en
 * famille « free-for-all » — n'ont ni allié ni adversaire. Y colorer les
 * joueurs mentirait : en Deathmatch tout le monde porte la même TeamID,
 * donc tout le monde passerait pour un allié.
 */
export function hasTeams(group) {
  return group?.modeFamily !== 'free-for-all';
}

export function isAgentSelect(group) {
  return AGENT_SELECT_MODES.has(String(group?.mode || '').toLowerCase())
    || Boolean(group?.sessions?.some(session => session.phase === 'pregame'));
}

/** Rattache une session à un membre du roster, par memberId puis par Riot ID. */
export function memberForSession(session, roster = []) {
  if (!session) return null;
  const byId = session.memberId
    && roster.find(member => String(member.id || member.name) === String(session.memberId));
  if (byId) return byId;

  const riotId = String(session.playerName || '').toLowerCase();
  if (!riotId) return null;
  return roster.find(member => {
    const ids = [member.riot, ...(member.smurfs || [])]
      .filter(Boolean)
      .map(account => `${account.name}#${account.tag}`.toLowerCase());
    return ids.includes(riotId);
  }) || null;
}

/** Nom à afficher : celui du roster si on le connaît, sinon le pseudo Riot. */
export function displayNameFor(session, roster = []) {
  const member = memberForSession(session, roster);
  if (member?.name) return member.name;
  return String(session?.member || session?.playerName || '').split('#')[0] || 'Inconnu';
}

/**
 * Paris encore ouverts, les plus récents d'abord. Un round dont la fenêtre est
 * écoulée n'est plus pariable : l'afficher inviterait à cliquer dans le vide.
 */
export function openBets(rounds = {}, now = Date.now()) {
  return Object.entries(rounds || {})
    .map(([key, round]) => ({ key, ...round }))
    .filter(round => round.status === 'open' && Number(round.closesAt || 0) > now)
    .sort((a, b) => Number(b.openedAt || 0) - Number(a.openedAt || 0));
}

/** « 2 min 30 » — compte à rebours lisible d'un pari. */
export function countdownLabel(closesAt, now = Date.now()) {
  const remaining = Math.max(0, Number(closesAt || 0) - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, '0')}` : `${seconds} s`;
}

/**
 * Les dix joueurs de la partie qui ont un skin notable, adversaires compris.
 *
 * Le script ne publie `skins` que pour ceux qui en ont un hors skin d'origine :
 * la liste est donc déjà filtrée, on n'a qu'à la mettre en forme. L'équipe du
 * joueur observé sert de repère — c'est `selfTeam` sur la session.
 */
export function matchSkins(group) {
  const session = (group?.sessions || []).find(entry => entry.players?.length);
  if (!session) return [];
  // Sans équipes dans le mode, aucun camp à annoncer.
  const ourTeam = hasTeams(group) ? (session.selfTeam || null) : null;

  return (session.players || [])
    .filter(player => player.skins?.length)
    .map(player => ({
      name: String(player.name || '').split('#')[0] || '?',
      // Sans équipe connue on n'affirme rien plutôt que de ranger tout le
      // monde du même côté.
      ally: ourTeam ? player.team === ourTeam : null,
      skins: player.skins,
    }))
    // Alliés d'abord, puis l'ordre d'origine : la liste reste stable d'un
    // rafraîchissement à l'autre.
    .sort((a, b) => Number(b.ally === true) - Number(a.ally === true));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
