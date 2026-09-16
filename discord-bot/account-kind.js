/**
 * Compte principal ou smurf.
 *
 * « X est en game » ne dit pas sur QUEL compte. Un membre qui a un smurf peut
 * être en train de jouer son rang ou de s'amuser trois divisions plus bas :
 * ce sont deux informations très différentes pour qui décide de parier ou de
 * rejoindre.
 *
 * La seule source qui distingue vraiment les deux est `data/roster.json`, où
 * chaque joueur déclare un compte `riot` et une liste de `smurfs`. Les comptes
 * ajoutés depuis l'admin (`rosterOverlay/accounts`) n'ont PAS cette notion —
 * volontairement, voir roster.js. Pour eux on ne peut rien affirmer, et il
 * vaut mieux ne rien dire que de désigner un compte principal au hasard.
 */

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Nature du compte sur lequel se joue cette partie :
 *
 *  - `solo`    : le membre n'a qu'un compte connu — rien à préciser ;
 *  - `main`    : c'est le compte déclaré dans roster.json ;
 *  - `smurf`   : c'en est un autre, et le principal est connu ;
 *  - `unknown` : plusieurs comptes, mais aucun n'est déclaré principal.
 */
function accountKind(member, riotId) {
  const accounts = member?.riotIds || [];
  if (accounts.length <= 1) return 'solo';

  const main = normalize(member?.mainRiotId);
  if (!main) return 'unknown';

  const played = normalize(riotId);
  if (!played) return 'unknown';
  return played === main ? 'main' : 'smurf';
}

/** « RayBaz#OLY » → « RayBaz ». Le tag n'apporte rien à l'œil. */
function shortAccount(riotId) {
  return String(riotId || '').split('#')[0] || String(riotId || '');
}

/**
 * Mention courte accolée au nom dans l'en-tête de la notification.
 *
 * Volontairement sans le nom du compte : l'en-tête doit rester lisible quand
 * cinq joueurs sont stackés. Le détail va dans l'embed, qui a la place.
 */
function accountMark(member, riotId) {
  const kind = accountKind(member, riotId);
  if (kind === 'main') return ' (main)';
  if (kind === 'smurf') return ' (smurf)';
  return '';
}

/**
 * Détail pour la ligne du joueur dans l'embed : lequel de ses comptes.
 *
 * Quand le principal n'est pas déclaré on donne quand même le compte joué —
 * c'est moins qu'un « main/smurf », mais c'est vrai, et ça suffit à lever
 * l'ambiguïté entre deux comptes d'un même membre.
 */
function accountDetail(member, riotId) {
  const kind = accountKind(member, riotId);
  if (kind === 'solo') return '';
  const short = shortAccount(riotId);
  if (!short) return '';
  if (kind === 'main') return ` (main · ${short})`;
  if (kind === 'smurf') return ` (smurf · ${short})`;
  return ` (${short})`;
}

module.exports = { accountKind, accountMark, accountDetail, shortAccount };
