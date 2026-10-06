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
 * Compte joué : la session elle-même ({ puuid, playerName }), ou un Riot ID
 * seul pour les appelants qui n'ont que lui.
 */
function playedAccount(account) {
  if (account && typeof account === 'object') {
    return { puuid: String(account.puuid || '').trim(), riotId: String(account.playerName || account.riotId || '') };
  }
  return { puuid: '', riotId: String(account || '') };
}

/**
 * Nature du compte sur lequel se joue cette partie :
 *
 *  - `solo`    : le membre n'a qu'un compte connu — rien à préciser ;
 *  - `main`    : c'est le compte principal déclaré ;
 *  - `smurf`   : c'en est un autre, et le principal est connu ;
 *  - `unknown` : plusieurs comptes, mais aucun n'est déclaré principal.
 *
 * Par PUUID d'abord. Comparer des Riot ID désignait comme smurf le main d'un
 * joueur renommé : roster.json garde l'ancien pseudo (Wong Chi Ming), la
 * partie arrive sous le nouveau (FakePlasticTrees) — même compte, même PUUID.
 * Le nom ne sert qu'en repli, quand l'un des deux PUUID manque.
 *
 * Le principal dépend du JEU : plusieurs membres ne jouent pas à LoL sur leur
 * compte Valorant (`lol` dans roster.json). Sans lui, on retombe sur le
 * principal Valorant.
 */
function accountKind(member, account, game = 'valorant') {
  // Comptes distincts : par PUUID quand on les a — un compte renommé
  // apparaît sous deux pseudos, mais reste un seul compte.
  const puuids = new Set((member?.puuids || []).filter(Boolean));
  const count = puuids.size || (member?.riotIds || []).length;
  if (count <= 1) return 'solo';

  const played = playedAccount(account);
  const lol = game === 'lol' && Boolean(member?.lolMainRiotId || member?.lolMainPuuid);
  const mainPuuid = lol ? member?.lolMainPuuid : member?.mainPuuid;
  if (mainPuuid && played.puuid) return played.puuid === mainPuuid ? 'main' : 'smurf';

  const main = normalize(lol ? member?.lolMainRiotId : member?.mainRiotId);
  if (!main) return 'unknown';
  if (!normalize(played.riotId)) return 'unknown';
  return normalize(played.riotId) === main ? 'main' : 'smurf';
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
function accountMark(member, account, game = 'valorant') {
  const kind = accountKind(member, account, game);
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
function accountDetail(member, account, game = 'valorant') {
  const kind = accountKind(member, account, game);
  if (kind === 'solo') return '';
  const short = shortAccount(playedAccount(account).riotId);
  if (!short) return '';
  if (kind === 'main') return ` (main · ${short})`;
  if (kind === 'smurf') return ` (smurf · ${short})`;
  return ` (${short})`;
}

module.exports = { accountKind, accountMark, accountDetail, shortAccount };
