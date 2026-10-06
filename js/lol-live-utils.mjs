/**
 * Les dix joueurs de la partie LoL en cours (publiés par live/lol-lobby.js) :
 * rang et winrate SoloQ, maîtrise du champion joué, rôle principal.
 *
 * Fonctions pures, sans DOM : le balisage se teste sans navigateur. Tout ce
 * qui vient de Firebase — que n'importe qui peut écrire — passe par `esc`.
 */

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

const ROLE_ORDER = ['top', 'jungle', 'mid', 'adc', 'support'];
const ROLE_LABELS = { top:'Top', jungle:'Jungle', mid:'Mid', adc:'ADC', support:'Support' };
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/** 950 → « 950 », 245 678 → « 246k », 1 234 567 → « 1,2M ». */
export function formatMasteryPoints(points) {
  const value = Number(points);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return String(Math.round(value));
  if (value < 999_500) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')}M`;
}

/** « Gold II », « Challenger » — ou null si non classé. */
export function tierLabel(rank) {
  const tier = String(rank?.tier || '').toUpperCase();
  if (!tier || tier === 'NONE' || tier === 'UNRANKED') return null;
  const name = tier.charAt(0) + tier.slice(1).toLowerCase();
  const division = APEX_TIERS.has(tier) ? '' : String(rank?.division || '').toUpperCase();
  return division && division !== 'NA' ? `${name} ${division}` : name;
}

/** Winrate de la saison SoloQ, ou null sans partie classée. */
export function soloWinrate(rank) {
  const wins = Number(rank?.wins) || 0;
  const losses = Number(rank?.losses) || 0;
  const games = wins + losses;
  if (!games) return null;
  return { percent: Math.round((wins / games) * 100), games };
}

/**
 * Icône du champion par son numéro, chez CommunityDragon (miroir des données
 * du client) : aucune version à connaître, contrairement à Data Dragon.
 */
export function championIconById(championId) {
  const id = Number(championId);
  return Number.isInteger(id) && id > 0
    ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`
    : '';
}

/**
 * Icône à afficher, et celle de secours si elle ne charge pas. L'image de
 * Data Dragon d'abord (publiée par le script), le numéro sinon.
 */
export function championIcons(player) {
  const byId = championIconById(player?.championId);
  const primary = String(player?.champion?.image || '') || byId;
  return { src: primary, fallback: byId && byId !== primary ? byId : '' };
}

export function roleLabel(role) {
  return ROLE_LABELS[String(role || '').toLowerCase()] || '';
}

/**
 * Lobby de la partie : celui publié par la première session qui en porte un
 * (deux membres dans la même partie publient le même).
 */
export function lobbyOf(group) {
  const session = (group?.players || []).find(player => Array.isArray(player?.lobby?.players) && player.lobby.players.length);
  return session ? session.lobby.players : [];
}

/**
 * Les deux équipes, la nôtre d'abord, chacune dans l'ordre des postes quand
 * on les connaît.
 */
export function lobbyTeams(players = []) {
  const position = player => {
    const index = ROLE_ORDER.indexOf(player?.position || '');
    return index < 0 ? ROLE_ORDER.length : index;
  };
  const sorted = list => [...list].sort((a, b) => position(a) - position(b));
  const ally = players.some(player => player?.ally === true);
  const teams = ally
    ? [
      { key:'ally', label:'Ton équipe', players: sorted(players.filter(player => player?.ally === true)) },
      { key:'enemy', label:'Adversaires', players: sorted(players.filter(player => player?.ally !== true)) },
    ]
    : [
      { key:'blue', label:'Équipe bleue', players: sorted(players.filter(player => player?.team !== 'CHAOS')) },
      { key:'red', label:'Équipe rouge', players: sorted(players.filter(player => player?.team === 'CHAOS')) },
    ];
  return teams.filter(team => team.players.length);
}

function splitRiotId(riotId) {
  const raw = String(riotId || '');
  const hash = raw.lastIndexOf('#');
  return hash > 0 ? [raw.slice(0, hash), raw.slice(hash + 1)] : [raw, ''];
}

function playerRow(player, olycity) {
  const champion = player?.champion || {};
  const icons = championIcons(player);
  const mastery = formatMasteryPoints(player?.mastery?.points);
  const masteryTitle = mastery
    ? `Maîtrise ${champion.name ? `sur ${champion.name} ` : ''}: ${Number(player.mastery.points).toLocaleString('fr-FR')} points`
    : '';
  const [name] = splitRiotId(player?.riotId);
  const tier = tierLabel(player?.rank);
  const lp = tier && player?.rank?.lp != null ? `${player.rank.lp} LP` : '';
  const winrate = soloWinrate(player?.rank);
  const winrateClass = !winrate ? '' : winrate.percent >= 55 ? ' is-good' : winrate.percent <= 45 ? ' is-bad' : '';
  const role = roleLabel(player?.mainRole);
  const classes = ['lol-lobby-player', olycity ? 'is-olycity' : '', player?.self ? 'is-self' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}">
      <div class="lol-lobby-champ"${masteryTitle ? ` title="${esc(masteryTitle)}"` : ''}>
        ${icons.src ? `<img src="${esc(icons.src)}"${icons.fallback ? ` data-fallback="${esc(icons.fallback)}"` : ''} alt="" loading="lazy">` : '<span>?</span>'}
        ${mastery ? `<b class="lol-mastery">${esc(mastery)}</b>` : ''}
      </div>
      <div class="lol-lobby-id"${player?.riotId ? ` title="${esc(player.riotId)}"` : ''}><strong>${esc(name || 'Joueur masqué')}</strong><small>${esc(champion.name || '')}${role ? `<span class="lol-lobby-role-inline"> · ${esc(role)}</span>` : ''}</small></div>
      <div class="lol-lobby-rank"><strong data-tier="${esc(String(player?.rank?.tier || '').toLowerCase())}">${esc(tier || 'Non classé')}</strong><small>${esc(lp)}</small></div>
      <div class="lol-lobby-wr${winrateClass}"><strong>${winrate ? `${winrate.percent}%` : '—'}</strong><small>${winrate ? `${winrate.games} parties` : 'SoloQ'}</small></div>
      <div class="lol-lobby-role"><small>Rôle</small><strong>${esc(role || '—')}</strong></div>
    </div>`;
}

/** Balisage des deux équipes, ou chaîne vide tant que rien n'est collecté. */
export function lobbyHTML(group) {
  const players = lobbyOf(group);
  if (!players.length) return '';
  // Les membres OLYCITY de la partie sont ceux qui publient une session.
  const olycity = new Set((group?.players || []).map(session => String(session?.puuid || '')).filter(Boolean));
  return `<section class="lol-lobby" aria-label="Joueurs de la partie">
    ${lobbyTeams(players).map(team => `<div class="lol-lobby-team is-${team.key}">
      <h3>${esc(team.label)}</h3>
      ${team.players.map(player => playerRow(player, olycity.has(String(player?.puuid || '')))).join('')}
    </div>`).join('')}
  </section>`;
}
