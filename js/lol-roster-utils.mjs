/**
 * Roster LoL — résolution d'identité, logique pure.
 *
 * Les profils et l'historique étaient rapprochés des joueurs PAR LE NOM :
 *
 *   profiles.find(p => normalizeId(p.playerName) === normalizeId(player.riotId))
 *
 * Un compte renommé perdait donc son profil, son rang et son top champions,
 * sans la moindre erreur — la carte se contentait d'afficher « Non
 * synchronisé ». C'est exactement la panne qui a vidé la carte Valorant de
 * « Wong Chi Ming#2046 », devenu « FakePlasticTrees#1706 ».
 *
 * Le script publie pourtant le PUUID depuis la 4.18 : sur `lolClients`, sur
 * `lolProfiles`, sur les sessions et sur les entrées d'historique. On s'en sert
 * en premier, et le nom ne reste qu'un repli — pour les entrées écrites avant,
 * qui n'en auront jamais, et pour les comptes dont le PUUID n'est pas encore
 * renseigné.
 */

const norm = value => String(value ?? '').trim().toLocaleLowerCase('fr');
const clean = value => String(value ?? '').trim();

/**
 * Index Riot ID → PUUID, construit depuis le roster ET l'admin.
 *
 * Il fait le pont entre les deux jeux : un compte déclaré côté Valorant avec
 * son PUUID retrouve le même compte côté LoL, puisque le PUUID d'un compte
 * Riot est le même pour les deux.
 */
export function puuidByRiotId(roster = [], overlay = null) {
  const index = new Map();
  const add = account => {
    const name = clean(account?.name);
    const puuid = clean(account?.puuid);
    if (!name || !puuid) return;
    const riotId = account.tag ? `${name}#${clean(account.tag)}` : name;
    if (!index.has(norm(riotId))) index.set(norm(riotId), puuid);
  };
  (Array.isArray(roster) ? roster : []).forEach(player => {
    [player?.riot, ...(player?.smurfs || [])].forEach(add);
  });
  Object.values(overlay?.accounts || {}).forEach(accounts => {
    Object.values(accounts || {}).forEach(add);
  });
  return index;
}

/**
 * Entrée Firebase correspondant à un joueur : PUUID d'abord, nom en repli.
 *
 * `entries` est un objet Firebase — `lolProfiles` ou `lolClients` — dont les
 * clés sont des Riot ID assainis, donc inutilisables pour identifier un compte
 * renommé. On regarde le CONTENU.
 */
export function matchEntry(entries, { puuid = '', riotId = '' } = {}) {
  const values = Object.values(entries || {}).filter(value => value && typeof value === 'object');
  const id = clean(puuid);
  if (id) {
    const byPuuid = values.find(value => clean(value.puuid) === id);
    if (byPuuid) return byPuuid;
  }
  const name = norm(riotId);
  if (!name) return null;
  return values.find(value => norm(value.playerName) === name) || null;
}

/**
 * Les entrées d'historique d'un compte.
 *
 * Le PUUID et le nom sont acceptés côte à côte, et c'est voulu : l'historique
 * écrit avant la 4.18 ne porte pas de PUUID et n'en portera jamais — personne
 * ne va rétro-remplir des mois d'entrées. Exclure ces parties amputerait le
 * top champions et le winrate de la saison.
 */
export function historyOf(matches = [], { puuid = '', riotId = '' } = {}) {
  const id = clean(puuid);
  const name = norm(riotId);
  return (Array.isArray(matches) ? matches : []).filter(match => {
    if (id && clean(match?.puuid) === id) return true;
    return Boolean(name) && norm(match?.playerName) === name;
  });
}

/**
 * Riot ID à AFFICHER : celui que le script a vu en dernier.
 *
 * Le nom déclaré peut dater de plusieurs renommages. Une fois le compte
 * retrouvé par son PUUID, c'est le nom observé qui fait foi — sinon l'écran
 * annoncerait un pseudo qui n'existe plus, et qu'on ne peut pas add en jeu.
 */
export function displayRiotId(player, observed = null) {
  if (!clean(player?.puuid)) return clean(player?.riotId);
  const seen = clean(observed?.playerName);
  return seen || clean(player?.riotId);
}

/**
 * PUUID appris de ce que le script a publié.
 *
 * `lolProfiles` et `lolClients` portent le nom ET le PUUID du compte observé.
 * C'est la seule source qui relie les deux pour un compte LoL que le dépôt ne
 * déclare pas — et une fois le lien connu, le compte devient insensible aux
 * renommages, sans que personne ait à saisir quoi que ce soit.
 */
export function observedPuuids(...sources) {
  const index = new Map();
  sources.forEach(source => {
    Object.values(source || {}).forEach(entry => {
      const name = norm(entry?.playerName);
      const puuid = clean(entry?.puuid);
      if (name && puuid && !index.has(name)) index.set(name, puuid);
    });
  });
  return index;
}

/**
 * Liste des joueurs LoL : la liste intégrée, complétée par le roster et l'admin.
 *
 * On COMPLÈTE au lieu de remplacer. Certains comptes LoL ne sont déclarés
 * nulle part ailleurs que dans le code, et les remplacer par les comptes
 * Valorant du roster les ferait disparaître de l'écran sans rien dire.
 *
 * Le dédoublonnage passe par le PUUID, le Riot ID, puis le NOM DU MEMBRE. Ce
 * dernier est indispensable : plusieurs joueurs ne jouent pas à LoL sur le
 * compte déclaré côté Valorant, et sans lui ils apparaîtraient deux fois — une
 * carte pleine et une carte vide. Quand les deux existent, c'est le compte LoL
 * de la liste intégrée qui gagne : c'est lui qui décrit cet écran-ci.
 */
export function mergePlayers(builtIn = [], roster = [], overlay = null, observed = new Map()) {
  const declared = puuidByRiotId(roster, overlay);
  const players = builtIn.map(player => ({
    ...player,
    puuid: clean(player.puuid) || observed.get(norm(player.riotId)) || declared.get(norm(player.riotId)) || '',
  }));

  const riotIds = new Set(players.map(player => norm(player.riotId)));
  const puuids = new Set(players.map(player => player.puuid).filter(Boolean));
  const membres = new Set(players.map(player => norm(player.name)).filter(Boolean));

  (Array.isArray(roster) ? roster : []).forEach(member => {
    const account = member?.riot;
    if (!account?.name) return;
    const riotId = account.tag ? `${account.name}#${account.tag}` : String(account.name);
    const puuid = clean(account.puuid);
    if (riotIds.has(norm(riotId)) || (puuid && puuids.has(puuid)) || membres.has(norm(member.name))) return;
    players.push({ name: member.name, riotId, puuid, avatar: member.avatar || '' });
    riotIds.add(norm(riotId));
    membres.add(norm(member.name));
    if (puuid) puuids.add(puuid);
  });
  return players;
}
