/**
 * Audit des identités OLYCITY.
 *
 * À LANCER DEPUIS UN POSTE QUI ATTEINT FIREBASE :
 *
 *     node tools/audit-identities.mjs            # rapport seul, ne touche à rien
 *     node tools/audit-identities.mjs --write    # écrit les puuids retrouvés
 *
 * Il répond à trois questions, et à elles seules — il ne supprime JAMAIS rien :
 *
 *   1. quels comptes du roster n'ont pas de puuid enregistré ?
 *   2. lesquels peuvent être retrouvés dans l'historique déjà publié ?
 *   3. quels comptes sont des doublons, ou dormants depuis des mois ?
 *
 * La suppression reste manuelle et décidée par un humain : un compte « vieux »
 * peut être un smurf de reprise, et un « doublon » peut être un renommage
 * qu'on veut garder pour lire l'historique ancien.
 */

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const ROSTER_URL = 'https://liam-thorel.github.io/OLYVALO/data/roster.json';
const DORMANT_DAYS = 120;

const WRITE = process.argv.includes('--write');
// Lancé directement, ou importé par les tests : seul le premier cas exécute.
const IS_MAIN = (process.argv[1] || '').endsWith('audit-identities.mjs');

export const lower = value => String(value || '').trim().toLowerCase();
const slugify = value => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

async function fbGet(path) {
  const response = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

async function fbPut(path, value) {
  const response = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`écriture ${path} → HTTP ${response.status}`);
}

/** Riot ID → puuid, reconstruit depuis tout ce que les scripts ont publié. */
export function harvestPuuids({ history, lolHistory, discovered, clients }) {
  const found = new Map();
  const keep = (name, puuid) => {
    const key = lower(name);
    if (!key || !puuid || key.includes('#') === false) return;
    if (!found.has(key)) found.set(key, new Set());
    found.get(key).add(String(puuid));
  };

  Object.values(history || {}).forEach(match => {
    const reports = match?.reports ? Object.values(match.reports) : (match?.map ? [match] : []);
    reports.forEach(report => {
      (report?.players || []).forEach(player => keep(player?.name, player?.puuid));
      keep(report?.player, report?.playerPuuid);
    });
  });
  Object.values(discovered || {}).forEach(entry => keep(entry?.playerName, entry?.puuid));
  Object.values(clients || {}).forEach(entry => keep(entry?.playerName, entry?.puuid));
  Object.values(lolHistory || {}).forEach(entry => keep(entry?.playerName, entry?.puuid));
  return found;
}

/** Dernière activité connue d'un Riot ID, toutes sources confondues. */
export function lastSeen({ history, lolHistory }) {
  const seen = new Map();
  const mark = (name, ts) => {
    const key = lower(name);
    const when = Number(ts || 0);
    if (!key || !when) return;
    if (when > (seen.get(key) || 0)) seen.set(key, when);
  };
  Object.values(history || {}).forEach(match => {
    const reports = match?.reports ? Object.values(match.reports) : (match?.map ? [match] : []);
    reports.forEach(report => (report?.players || []).forEach(player =>
      mark(player?.name, report.ts || report.endTs)));
  });
  Object.values(lolHistory || {}).forEach(entry => mark(entry?.playerName, entry?.ts));
  return seen;
}

export function accountsOf(roster, overlay) {
  const rows = [];
  (roster || []).forEach(player => {
    const id = slugify(player?.name);
    [player?.riot, ...(player?.smurfs || [])].filter(a => a?.name).forEach((account, position) => {
      rows.push({
        source: 'roster.json', memberId: id, member: player.name, position,
        riotId: account.tag ? `${account.name}#${account.tag}` : String(account.name),
        puuid: '', key: '',
      });
    });
  });
  Object.entries(overlay?.accounts || {}).forEach(([memberId, accounts]) => {
    const member = overlay?.members?.[memberId]?.name
      || (roster || []).find(p => slugify(p?.name) === memberId)?.name || memberId;
    Object.entries(accounts || {}).forEach(([key, account]) => {
      if (!account?.name) return;
      rows.push({
        source: 'rosterOverlay', memberId, member, position: null,
        riotId: account.tag ? `${account.name}#${account.tag}` : String(account.name),
        puuid: String(account.puuid || ''), key,
      });
    });
  });
  return rows;
}

const titre = text => `\n${'═'.repeat(text.length)}\n${text}\n${'═'.repeat(text.length)}`;
const jours = ts => Math.round((Date.now() - ts) / 86_400_000);

async function main() {
  const [roster, overlay, history, lolHistory, discovered, clients] = await Promise.all([
    fetch(ROSTER_URL).then(r => r.json()),
    fbGet('rosterOverlay'), fbGet('live/history'), fbGet('live/lolHistory'),
    fbGet('discovered').catch(() => null), fbGet('live/clients').catch(() => null),
  ]);

  const rows = accountsOf(roster, overlay);
  const puuids = harvestPuuids({ history, lolHistory, discovered, clients });
  const seen = lastSeen({ history, lolHistory });

  console.log(titre('1. Comptes sans puuid enregistré'));
  const aEcrire = [];
  rows.filter(row => !row.puuid).forEach(row => {
    const candidats = [...(puuids.get(lower(row.riotId)) || [])];
    if (candidats.length === 1) {
      console.log(`  ✔ ${row.member} · ${row.riotId} → ${candidats[0]}  (retrouvé dans l'historique)`);
      if (row.source === 'rosterOverlay') aEcrire.push({ row, puuid: candidats[0] });
      else console.log('      ↳ déclaré dans roster.json : à ajouter via l’admin pour porter un puuid');
    } else if (candidats.length > 1) {
      console.log(`  ⚠ ${row.member} · ${row.riotId} → PLUSIEURS puuids : ${candidats.join(', ')}`);
      console.log('      ↳ deux comptes ont porté ce nom : à trancher à la main');
    } else {
      console.log(`  ✖ ${row.member} · ${row.riotId} → introuvable dans l'historique publié`);
    }
  });
  if (rows.every(row => row.puuid)) console.log('  (aucun — tous les comptes ont leur puuid)');

  console.log(titre('2. Doublons'));
  const parPuuid = new Map();
  rows.filter(row => row.puuid).forEach(row => {
    if (!parPuuid.has(row.puuid)) parPuuid.set(row.puuid, []);
    parPuuid.get(row.puuid).push(row);
  });
  let doublons = 0;
  parPuuid.forEach((group, puuid) => {
    if (group.length < 2) return;
    doublons += 1;
    const membres = new Set(group.map(row => row.member));
    console.log(`  ${puuid}`);
    group.forEach(row => console.log(`    · ${row.member} · ${row.riotId}  [${row.source}${row.key ? ` ${row.key}` : ''}]`));
    if (membres.size > 1) console.log('    ⚠ rattaché à DEUX membres différents — à corriger avant tout nettoyage');
    else console.log('    ↳ même joueur : garder l’entrée au nom actuel, retirer les autres');
  });
  // Deux entrées de même Riot ID sans puuid sont un doublon franc.
  const parNom = new Map();
  rows.forEach(row => {
    const key = lower(row.riotId);
    if (!parNom.has(key)) parNom.set(key, []);
    parNom.get(key).push(row);
  });
  parNom.forEach((group, nom) => {
    if (group.length < 2) return;
    doublons += 1;
    console.log(`  ${nom} — ${group.length} entrées : ${group.map(r => r.source).join(' + ')}`);
    console.log('    ↳ déclaré deux fois ; roster.json fait foi, l’entrée admin est redondante');
  });
  if (!doublons) console.log('  (aucun)');

  console.log(titre(`3. Comptes dormants (> ${DORMANT_DAYS} jours)`));
  let dormants = 0;
  rows.forEach(row => {
    const when = seen.get(lower(row.riotId));
    if (when && jours(when) <= DORMANT_DAYS) return;
    dormants += 1;
    console.log(when
      ? `  ${row.member} · ${row.riotId} — dernière partie il y a ${jours(when)} jours`
      : `  ${row.member} · ${row.riotId} — aucune partie dans l'historique`);
  });
  if (!dormants) console.log('  (aucun)');
  console.log('\n  Rien n’est supprimé par cet outil : un compte dormant peut être un smurf');
  console.log('  de reprise, et un « doublon » un renommage qu’on garde pour l’historique.');

  if (!aEcrire.length) return;
  console.log(titre(`${aEcrire.length} puuid(s) prêts à être écrits`));
  aEcrire.forEach(({ row, puuid }) => console.log(`  ${row.member} · ${row.riotId} → ${puuid}`));
  if (!WRITE) {
    console.log('\n  Relance avec --write pour les enregistrer.');
    return;
  }
  for (const { row, puuid } of aEcrire) {
    await fbPut(`rosterOverlay/accounts/${row.memberId}/${row.key}/puuid`, puuid);
    console.log(`  écrit : ${row.member} · ${row.riotId}`);
  }
}

if (IS_MAIN) main().catch(error => { console.error('\nÉchec :', error.message); process.exit(1); });
