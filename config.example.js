/**
 * OLYCITY — configuration optionnelle
 *
 * ⚠️ Ce fichier N'EST PAS un endroit sûr pour un secret. Le site est statique
 * et public : tout ce qui est ici est téléchargé par le navigateur et lisible
 * par n'importe quel visiteur dans les DevTools. Une clé placée ici est donc
 * publique, quoi qu'il arrive.
 *
 * La clé HenrikDev n'est pas publiée : chaque utilisateur peut renseigner la
 * sienne depuis la page Roster. L'URL du catalogue, elle, est publique et ne
 * contient aucun secret.
 *
 * En production, ce fichier est GÉNÉRÉ au déploiement par
 * .github/workflows/pages.yml à partir du secret GitHub HENRIK_API_KEY. Il
 * n'est jamais commité (ignoré par git) — ce gabarit ne sert qu'au
 * développement local.
 *
 * Clé gratuite : https://api.henrikdev.xyz/dashboard
 */
export const CONFIG = {
  HENRIK_API_KEY: 'HDEV-XXXX-XXXX-XXXX-XXXX',
  // URL publique du Worker `workers/game-catalog` (aucun secret côté site).
  GAME_CATALOG_ENDPOINT: 'https://olycity-game-catalog.example.workers.dev',
};
