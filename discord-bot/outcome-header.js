// En-tête des messages de fin de game. Remplace l'ancienne bannière
// « 🔥 STACK OLYCITY — 2 joueurs dans la même game ! », qui annonçait un
// regroupement sans jamais dire ce que la game avait donné.
//
// Deux joueurs du roster peuvent se retrouver dans des équipes opposées : le
// résultat est donc groupé par issue, pas supposé commun.

const LABELS = { win: 'Victoire', loss: 'Défaite', draw: 'Égalité' };
const ICONS = { win: '🏆', loss: '💀', draw: '🤝' };
const UNKNOWN = { label: 'Game terminée', icon: '🎮' };

// « Mathis », « Mathis et Rayhan », « Mathis, Rayhan et Liam ».
function joinNames(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

// Valorant publie result.result ('win' | 'loss' | 'draw' | 'completed'),
// League un booléen result.win. Les deux arrivent ici sous la même forme.
function normalizeOutcome(value) {
  if (value === true) return 'win';
  if (value === false) return 'loss';
  return LABELS[value] ? value : null;
}

/**
 * players : [{ name, outcome }] — outcome tel que publié par le script, ou null
 * si la game n'a pas de vainqueur connu (rapport de fin incomplet).
 * Retourne null si personne à annoncer, pour laisser le contenu du message vide.
 */
function outcomeHeader(players = []) {
  const named = players.filter(player => player?.name);
  if (named.length === 0) return null;

  // Map conserve l'ordre d'insertion : les joueurs restent dans l'ordre où le
  // message les affiche, plutôt que dans un ordre d'issue arbitraire.
  const groups = new Map();
  named.forEach(player => {
    const outcome = normalizeOutcome(player.outcome);
    if (!groups.has(outcome)) groups.set(outcome, []);
    groups.get(outcome).push(player.name);
  });

  return [...groups.entries()]
    .map(([outcome, names]) => {
      const { label, icon } = outcome ? { label: LABELS[outcome], icon: ICONS[outcome] } : UNKNOWN;
      return `${icon} **${label}** pour **${joinNames(names)}**`;
    })
    .join('\n');
}

module.exports = { outcomeHeader, joinNames, normalizeOutcome };
