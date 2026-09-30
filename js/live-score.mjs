import { isVersionAtLeast } from './live-clients.mjs?v=20260930-consistent-live';

/**
 * Score en direct affiché sur la page Live, du point de vue du joueur suivi.
 *
 * Avant 4.21.0, le script publiait un score figé à 0-0 toute la partie : il
 * le lisait dans une réponse Riot qui n'en contient pas. L'afficher tel quel
 * montrerait « 0 – 0 » sur une partie à 9-7 ; on ne l'affiche donc qu'à partir
 * d'un script qui publie un vrai score.
 */
export const LIVE_SCORE_MIN_VERSION = '4.21.0';

function roundCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 100 ? number : null;
}

/** Camp du joueur suivi : publié par le script, sinon retrouvé dans la liste. */
function selfTeamOf(session) {
  const published = String(session?.selfTeam || '');
  if (published === 'ORDER' || published === 'CHAOS') return published;
  const puuid = String(session?.puuid || '');
  const self = puuid ? (session?.players || []).find(player => player?.puuid === puuid) : null;
  return self?.team === 'ORDER' || self?.team === 'CHAOS' ? self.team : null;
}

/**
 * @returns {null | { mine: number, theirs: number, state: 'ahead'|'behind'|'level',
 *   labels: [string, string], perspective: boolean }}
 */
export function liveScoreView(session) {
  if (!session?.active) return null;
  // Pendant le pick, il n'y a pas encore de manche jouée à montrer.
  if (session.phase === 'pregame' || session.mode === 'agent-select') return null;
  // En Deathmatch, pas d'équipes : un score Bleu/Rouge n'y a aucun sens.
  if (session.modeFamily === 'free-for-all') return null;
  if (!isVersionAtLeast(session.scriptVersion, LIVE_SCORE_MIN_VERSION)) return null;

  const blue = roundCount(session.score?.blue);
  const red = roundCount(session.score?.red);
  if (blue === null || red === null) return null;

  const team = selfTeamOf(session);
  // Camp inconnu : on montre le score brut plutôt que de deviner qui mène.
  if (!team) {
    return { mine: blue, theirs: red, state: 'level', labels: ['Bleu', 'Rouge'], perspective: false };
  }
  const mine = team === 'ORDER' ? blue : red;
  const theirs = team === 'ORDER' ? red : blue;
  return {
    mine,
    theirs,
    state: mine > theirs ? 'ahead' : mine < theirs ? 'behind' : 'level',
    labels: ['Nous', 'Eux'],
    perspective: true,
  };
}

/** Ce qui doit déclencher un nouveau rendu : le score ET le camp. */
export function liveScoreKey(session) {
  const view = liveScoreView(session);
  return view ? `${view.mine}-${view.theirs}-${view.perspective ? 1 : 0}` : '';
}
