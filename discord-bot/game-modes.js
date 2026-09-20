/**
 * Prédicats de mode de jeu. Volontairement sans aucune dépendance : ils
 * étaient dans stats.js, qui importe Firebase, si bien que le simple fait de
 * demander « cette file est-elle classée ? » tirait toute la couche réseau.
 */

// Ne garde que les games en file classée : Compétitif pour Valorant (les
// autres modes — Swift Play, Deathmatch, Spike Rush... — faussent le
// winrate/KDA d'un récap censé refléter le classé). Aucun filtre nécessaire
// côté LoL : live/index.js ne track déjà que les queues classées (420/440).
// Le script publie le queueID de Riot en minuscules ('competitive',
// 'deathmatch', 'unrated', 'swiftplay', 'spikerush'…). On normalise (casse +
// espaces) avant comparaison : un rapport au format légèrement différent ne
// doit ni faire fuiter du non-classé dans un récap, ni exclure une vraie
// game classée.
const RANKED_VALORANT_MODE = 'competitive';

function normalizeMode(mode) {
  return String(mode || '').trim().toLowerCase();
}

function isRankedValorantMode(mode) {
  return normalizeMode(mode) === RANKED_VALORANT_MODE;
}

/**
 * Valeurs de `mode` qui décrivent une PHASE et non une file.
 *
 * Pendant la sélection d'agent, le script publie `mode: 'agent-select'` et
 * range la vraie file dans `queueId`. Or c'est précisément à ce moment que la
 * session passe d'inactive à active — donc c'est ce payload-là que le bot
 * examine pour décider s'il annonce le départ. Il y lisait `mode`, n'y voyait
 * pas « competitive », et se taisait ; ensuite la session reste active, et le
 * départ n'est plus jamais réexaminé.
 *
 * Effet en production : plus aucun pari d'avant-match, alors que les cartes de
 * fin de partie continuaient d'arriver — d'où une panne qui ne ressemblait pas
 * à une panne.
 */
const PHASE_MODES = new Set(['agent-select', 'pregame']);

/**
 * File d'une session, phase traversée.
 *
 * L'ordre compte : `mode` d'abord, parce que les scripts d'avant la séparation
 * y mettaient la vraie file sans publier de `queueId`. On ne bascule sur
 * `queueId` que lorsque `mode` s'avère être une phase.
 */
function sessionMode(session) {
  const mode = normalizeMode(session?.mode);
  if (mode && !PHASE_MODES.has(mode)) return mode;
  return normalizeMode(session?.queueId);
}

/** La session est-elle une partie classée Valorant, pick compris ? */
function isRankedValorantSession(session) {
  return isRankedValorantMode(sessionMode(session));
}

function isValorantDeathmatch(mode) {
  return /deathmatch/.test(normalizeMode(mode));
}

// Files classées LoL : 420 = Solo/Duo, 440 = Flex. Le script live ne publie
// déjà que celles-ci, mais le bot revérifie : un poste resté sur une vieille
// version du script ne doit pas pouvoir faire passer une normale ou un ARAM.
const RANKED_LOL_QUEUES = [420, 440];

function isRankedLolQueue(queueId) {
  return RANKED_LOL_QUEUES.includes(Number(queueId));
}

// Un queueId absent n'est pas une preuve de non-classé : les versions du
// script antérieures à 4.17.5 ne le publiaient pas sur la session de début.
// On ne rejette donc que ce qu'on sait être hors classé, sinon une mise à
// jour du bot ferait taire les notifs de tous les postes pas encore à jour.
function isNonRankedLolQueue(queueId) {
  return queueId !== null && queueId !== undefined && queueId !== '' && !isRankedLolQueue(queueId);
}

module.exports = {
  RANKED_VALORANT_MODE, normalizeMode, isRankedValorantMode, isValorantDeathmatch,
  sessionMode, isRankedValorantSession, PHASE_MODES,
  RANKED_LOL_QUEUES, isRankedLolQueue, isNonRankedLolQueue,
};
