/**
 * Écrit les PUUID dans data/roster.json.
 *
 * À LANCER DEPUIS UN POSTE QUI ATTEINT FIREBASE :
 *
 *     node tools/fill-roster-puuids.mjs            # rapport seul
 *     node tools/fill-roster-puuids.mjs --write    # modifie data/roster.json
 *
 * Le fichier reste la source lisible et versionnée du roster — c'est bien
 * qu'il le reste. Mais il n'y portait que des PSEUDOS, donc l'identité d'un
 * joueur dépendait d'un nom, qui change. On y ajoute le PUUID, identifiant
 * Riot permanent, sans rien retirer : le pseudo garde son rôle d'affichage.
 *
 * Les PUUID viennent de ce qui a déjà été publié — rosterOverlay renseigné
 * depuis l'admin, et à défaut les rapports de fin de partie. Aucune API
 * externe, aucune clé nécessaire.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const ROSTER_PATH = new URL('../data/roster.json', import.meta.url);
const WRITE = process.argv.includes('--write');

const lower = value => String(value || '').trim().toLowerCase();
const riotIdOf = account => (account?.tag ? `${account.name}#${account.tag}` : String(account?.name || ''));

async function fbGet(path) {
  const response = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

/** Riot ID → puuid, depuis toutes les sources déjà publiées. */
export function collectPuuids({ overlay, history, lolHistory, discovered } = {}) {
  const found = new Map();
  const keep = (riotId, puuid, source) => {
    const key = lower(riotId);
    const value = String(puuid || '').trim().toLowerCase();
    if (!key || !key.includes('#') || !value) return;
    if (!found.has(key)) found.set(key, new Map());
    // L'admin fait autorité : c'est un humain qui l'a renseigné.
    const rank = source === 'admin' ? 0 : 1;
    const seen = found.get(key);
    if (!seen.has(value) || seen.get(value) > rank) seen.set(value, rank);
  };

  Object.values(overlay?.accounts || {}).forEach(accounts =>
    Object.values(accounts || {}).forEach(account => keep(riotIdOf(account), account?.puuid, 'admin')));

  Object.values(history || {}).forEach(match => {
    const reports = match?.reports ? Object.values(match.reports) : (match?.map ? [match] : []);
    reports.forEach(report => (report?.players || []).forEach(player =>
      keep(player?.name, player?.puuid, 'history')));
  });
  Object.values(lolHistory || {}).forEach(entry => keep(entry?.playerName, entry?.puuid, 'history'));
  Object.values(discovered || {}).forEach(entry => keep(entry?.playerName, entry?.puuid, 'history'));
  return found;
}

/**
 * Choisit le puuid d'un compte, ou explique pourquoi il n'y en a pas.
 *
 * Deux puuids pour un même pseudo = deux comptes ont porté ce nom. On
 * n'invente pas : c'est à un humain de trancher.
 */
export function resolvePuuid(riotId, found) {
  const candidats = found.get(lower(riotId));
  if (!candidats || candidats.size === 0) return { puuid: '', reason: 'introuvable dans les données publiées' };
  if (candidats.size === 1) return { puuid: [...candidats.keys()][0], reason: '' };
  const parAdmin = [...candidats.entries()].filter(([, rank]) => rank === 0).map(([puuid]) => puuid);
  if (parAdmin.length === 1) return { puuid: parAdmin[0], reason: '' };
  return { puuid: '', reason: `${candidats.size} puuids différents pour ce pseudo — à trancher à la main` };
}

/** Ajoute le puuid à chaque compte, sans toucher au reste du fichier. */
export function fillRoster(roster, found) {
  const report = [];
  const filled = (Array.isArray(roster) ? roster : []).map(player => {
    const patch = account => {
      if (!account?.name) return account;
      const riotId = riotIdOf(account);
      if (account.puuid) { report.push({ player: player.name, riotId, status: 'déjà renseigné' }); return account; }
      const { puuid, reason } = resolvePuuid(riotId, found);
      report.push({ player: player.name, riotId, status: puuid ? `→ ${puuid}` : `✖ ${reason}` });
      return puuid ? { ...account, puuid } : account;
    };
    const next = { ...player };
    if (next.riot) next.riot = patch(next.riot);
    if (Array.isArray(next.smurfs)) next.smurfs = next.smurfs.map(patch);
    return next;
  });
  return { filled, report };
}

async function main() {
  const [overlay, history, lolHistory, discovered] = await Promise.all([
    fbGet('rosterOverlay'), fbGet('live/history'), fbGet('live/lolHistory'),
    fbGet('discovered').catch(() => null),
  ]);
  const roster = JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));
  const { filled, report } = fillRoster(roster, collectPuuids({ overlay, history, lolHistory, discovered }));

  report.forEach(row => console.log(`  ${row.player.padEnd(8)} ${row.riotId.padEnd(26)} ${row.status}`));
  const ajoutes = report.filter(row => row.status.startsWith('→')).length;
  const manquants = report.filter(row => row.status.startsWith('✖'));
  console.log(`\n  ${ajoutes} puuid(s) à écrire, ${manquants.length} introuvable(s).`);
  if (manquants.length) {
    console.log('  Un compte sans puuid reste identifié par son pseudo : rien ne casse,');
    console.log('  mais il reste vulnérable à un renommage.');
  }
  if (!ajoutes) return;
  if (!WRITE) { console.log('\n  Relance avec --write pour modifier data/roster.json.'); return; }
  writeFileSync(ROSTER_PATH, `${JSON.stringify(filled, null, 2)}\n`);
  console.log('\n  data/roster.json modifié — relis le diff avant de committer.');
}

if ((process.argv[1] || '').endsWith('fill-roster-puuids.mjs')) {
  main().catch(error => { console.error('\nÉchec :', error.message); process.exit(1); });
}
