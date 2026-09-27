/**
 * Issue d'une partie Valorant à équipes, lue dans le rapport de fin de partie.
 *
 * Le rapport ne donne qu'un booléen `won` par équipe. L'ancien calcul lisait
 * `selfTeam.won ? 'win' : 'loss'` : sur une ÉGALITÉ (vote d'égalité en
 * prolongation), aucune équipe n'a gagné, et « pas gagné » devenait
 * mécaniquement « perdu ». Conséquences : carte de défaite dans Discord, paris
 * tranchés comme une défaite — les parieurs du « perdu » encaissaient sur une
 * partie qui n'avait pas de perdant — et une défaite de plus dans l'historique.
 *
 * Le score seul ne suffit pas à reconnaître l'égalité : une reddition à score
 * égal (6-6) a bel et bien un vainqueur. C'est donc l'absence de vainqueur,
 * dans les DEUX équipes, qui fait l'égalité.
 */
function teamOutcome(selfTeamId, teams) {
  const list = Array.isArray(teams) ? teams : [];
  const self = list.find(team => team?.teamId === selfTeamId);
  if (!self) return null;
  if (self.won === true) return 'win';
  // Il faut voir les deux équipes : avec une seule, « personne n'a gagné »
  // voudrait seulement dire qu'on ignore le vainqueur.
  if (list.length >= 2 && list.every(team => team?.won !== true)) return 'draw';
  return 'loss';
}

module.exports = { teamOutcome };
