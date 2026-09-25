/**
 * Synchronisation planifiée des statistiques Valorant.
 *
 * Elle tourne dans GitHub Actions, avec la clé HenrikDev en secret, et publie
 * le résultat dans `rosterStats/` — d'où le site le lit déjà.
 *
 * L'intérêt n'est pas d'automatiser : c'est que la clé NE SORTE JAMAIS. Le
 * site est public et statique, le dépôt aussi : une clé livrée avec le bundle
 * est lisible dans les DevTools par n'importe quel visiteur. Ici elle reste
 * dans Actions, et personne n'en a besoin sur le site — pas même celui qui
 * regarde ses stats.
 *
 * On réutilise `js/henrik.js`, le client du navigateur, plutôt que d'en écrire
 * un second : deux implémentations divergeraient, et sur des statistiques la
 * divergence ne se remarque pas.
 *
 *   node tools/sync-roster-stats.mjs            # écrit dans Firebase
 *   node tools/sync-roster-stats.mjs --dry-run  # n'écrit rien, affiche tout
 */

import { readFileSync } from 'node:fs';
import { useApiKey } from '../js/henrik-key.mjs';
import { syncAccount } from '../js/henrik.js';
import { rosterAccounts } from '../js/roster-card-utils.mjs';
import { statsKey, publishable, firebasePath } from '../js/account-stats.mjs';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

/**
 * Comptes à synchroniser, dans l'ordre.
 *
 * Les comptes PRINCIPAUX d'abord : si le quota de la clé s'épuise en route,
 * mieux vaut avoir rafraîchi les cinq mains que trois smurfs. Un compte sans
 * Riot ID exploitable est écarté — l'API n'aurait rien à interroger.
 */
export function accountsToSync(roster = [], overlay = null) {
  const membres = (Array.isArray(roster) ? roster : []).flatMap(player =>
    rosterAccounts(player, overlay).map(account => ({
      ...account,
      member: player.name,
      region: player.riot?.region || 'eu',
    })));
  const utilisables = membres.filter(account => account.puuid || String(account.riotId || '').includes('#'));
  return [...utilisables.filter(a => a.isMain), ...utilisables.filter(a => !a.isMain)];
}

/** Erreurs qui ne servent à rien de poursuivre : la suite échouera pareil. */
export function isFatal(message) {
  return ['NO_API_KEY', 'AUTH_REQUIRED'].includes(message);
}

// Au-delà, ce n'est plus une suite de comptes qui posent problème : c'est
// quelque chose de commun à tous.
export const MAX_ECHECS_IDENTIQUES = 3;

/**
 * Faut-il abandonner la tournée ?
 *
 * Huit comptes qui échouent tous avec la MÊME erreur ne décrivent pas huit
 * problèmes : ils décrivent un problème unique — clé refusée, hôte injoignable,
 * API en panne. Continuer brûle le quota d'une clé limitée, quatre fois par
 * jour, et noie la cause réelle sous « 8 comptes privés ».
 *
 * Le compteur repart à zéro dès qu'un compte passe ou échoue autrement : une
 * série de vrais comptes privés à la suite reste possible, mais elle
 * s'interrompt au premier compte sain.
 */
export function shouldAbandon(echecsConsecutifs, limite = MAX_ECHECS_IDENTIQUES) {
  return echecsConsecutifs >= limite;
}

async function fbGet(path) {
  const response = await fetch(`${FIREBASE_URL}/${path}.json`);
  return response.ok ? response.json() : null;
}

async function fbPut(path, body) {
  const response = await fetch(`${FIREBASE_URL}/${path}.json?print=silent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Firebase HTTP ${response.status}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const key = String(process.env.HENRIK_API_KEY || '').trim();
  if (!key) {
    console.error('HENRIK_API_KEY absent — rien à faire.');
    process.exit(1);
  }
  useApiKey(key);

  const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
  const overlay = await fbGet('rosterOverlay').catch(() => null);
  const comptes = accountsToSync(roster, overlay);
  console.log(`${comptes.length} comptes à synchroniser${dryRun ? ' (à blanc)' : ''}.`);

  let publies = 0;
  const echecs = [];
  let dernierEchec = '';
  let echecsConsecutifs = 0;
  for (const compte of comptes) {
    const [name, tag] = String(compte.riotId || '').split('#');
    try {
      const stats = await syncAccount({ puuid: compte.puuid, name, tag, riotId: compte.riotId, region: compte.region });
      const record = publishable({ ...compte, puuid: stats.puuid || compte.puuid }, stats);
      if (!record) { echecs.push(`${compte.riotId} — rien à publier`); continue; }
      console.log(`  ${compte.member} · ${record.riotId} → ${stats.rank ?? 'sans rang'}${stats.rr != null ? ` ${stats.rr}rr` : ''}`);
      if (!dryRun) await fbPut(`rosterStats/${firebasePath(record.key)}`, record);
      publies += 1;
      echecsConsecutifs = 0;
      dernierEchec = '';
    } catch (error) {
      echecs.push(`${compte.riotId} — ${error.message}`);
      echecsConsecutifs = error.message === dernierEchec ? echecsConsecutifs + 1 : 1;
      dernierEchec = error.message;
      // Clé absente ou invalide : la suite échouerait de la même façon, et
      // trente appels pour rien useraient le quota d'une clé qui marche encore.
      if (isFatal(error.message)) {
        console.error(`Interrompu : ${error.message}`);
        break;
      }
      if (shouldAbandon(echecsConsecutifs)) {
        console.error(`Interrompu : ${echecsConsecutifs} échecs d'affilée en « ${error.message} » — la cause est commune à tous les comptes, pas propre à l'un d'eux.`);
        break;
      }
    }
  }

  console.log(`${publies} publiés, ${echecs.length} en échec.`);
  echecs.forEach(ligne => console.log(`  ✕ ${ligne}`));
  // Un compte privé ou introuvable ne doit pas faire échouer la planification :
  // elle repassera, et les autres comptes ont bien été publiés.
  if (publies === 0) process.exit(1);
}

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) main().catch(error => { console.error(error); process.exit(1); });
