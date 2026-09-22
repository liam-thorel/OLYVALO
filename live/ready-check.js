/**
 * Acceptation automatique du ready check (LoL et TFT).
 *
 * Le client LoL sert les deux jeux : la file TFT passe par le MÊME endpoint
 * `/lol-matchmaking/v1/ready-check`. Il n'y a donc rien de spécifique à faire
 * pour TFT.
 *
 * Accepter À LA FIN du compte à rebours, et non tout de suite, est un choix de
 * conception, pas un détail :
 *
 * - la fenêtre entière reste disponible pour accepter, refuser ou dodge à la
 *   main. L'automatisme n'est qu'un filet, il ne décide jamais à la place de
 *   quelqu'un qui est devant son écran ;
 * - accepter en 200 ms est un comportement qu'aucun humain n'a.
 *
 * Ce que ce module ne peut pas résoudre : si personne n'est devant le PC, la
 * partie est acceptée quand même, et c'est pire que de la laisser filer — une
 * pénalité pour le joueur, et quatre coéquipiers avec un AFK. D'où le réglage
 * désactivé par défaut, et le choix d'attendre la fin du compte à rebours.
 */

// Durée du ready check côté Riot. Elle n'est pas publiée par l'API : c'est une
// constante observée, d'où la marge généreuse ci-dessous.
const TOTAL_SEC = 12.5;

// On accepte avec cette marge restante. Trois secondes couvrent une requête
// lente, un client qui rame, et une durée réelle un peu plus courte que la
// constante ci-dessus. Trop court, on rate la fenêtre et la file repart.
const MARGIN_SEC = 3;

/**
 * Que faire d'un ready check.
 *
 * Renvoie toujours une décision explicite plutôt qu'un booléen : l'appelant
 * doit pouvoir journaliser POURQUOI il n'a rien fait, sinon un automatisme
 * silencieux qui ne se déclenche pas est indébogable.
 */
function readyCheckPlan(check, { enabled = false, totalSec = TOTAL_SEC, marginSec = MARGIN_SEC } = {}) {
  if (!enabled) return { act: 'ignore', reason: 'desactive' };
  if (!check || typeof check !== 'object') return { act: 'ignore', reason: 'aucun-ready-check' };
  if (check.state !== 'InProgress') return { act: 'ignore', reason: `etat-${check.state || 'inconnu'}` };

  // Le joueur a déjà tranché. Repasser derrière un REFUS serait le pire bug
  // possible de ce module : on le remettrait dans une partie qu'il vient de
  // décliner.
  if (check.playerResponse && check.playerResponse !== 'None') {
    return { act: 'ignore', reason: `deja-repondu-${check.playerResponse}` };
  }

  const timer = Number(check.timer);
  // Un timer absent ou aberrant ne doit pas faire accepter immédiatement :
  // on repart de zéro, donc on attend la fenêtre complète.
  const ecoule = Number.isFinite(timer) && timer >= 0 ? timer : 0;
  const restant = totalSec - ecoule;
  if (restant <= marginSec) return { act: 'accept', reason: 'fin-du-compte-a-rebours', restantSec: restant };
  return { act: 'wait', reason: 'compte-a-rebours-en-cours', delayMs: Math.round((restant - marginSec) * 1000), restantSec: restant };
}

/**
 * Le réglage d'un compte, tel que publié par le site.
 *
 * Firebase est ouvert en écriture : tout ce qui en vient est suspect. Seul un
 * `true` booléen strict active l'automatisme — une chaîne « true », un 1 ou un
 * objet ne suffisent pas. Dans le doute, on n'accepte rien à la place de
 * quelqu'un.
 */
function autoAcceptEnabled(settings) {
  return settings?.autoAccept === true;
}

module.exports = { readyCheckPlan, autoAcceptEnabled, TOTAL_SEC, MARGIN_SEC };
