/**
 * OLYCITY — configuration optionnelle
 *
 * ⚠️ Ce fichier N'EST PAS un endroit sûr pour un secret. Le site est statique
 * et public : tout ce qui est ici est téléchargé par le navigateur et lisible
 * par n'importe quel visiteur dans les DevTools. Une clé placée ici est donc
 * publique, quoi qu'il arrive.
 *
 * Le déploiement public n'embarque volontairement aucune clé : chaque
 * utilisateur renseigne la sienne depuis la page Roster (bouton « Renseigner
 * ma clé »), et elle reste dans son navigateur.
 *
 * Ce fichier ne sert donc qu'à un déploiement PRIVÉ (réseau local, accès
 * restreint) où l'on accepte que la clé soit partagée par tous les visiteurs.
 * Il est ignoré par git.
 *
 * Clé gratuite : https://api.henrikdev.xyz/dashboard
 */
export const CONFIG = {
  HENRIK_API_KEY: 'HDEV-XXXX-XXXX-XXXX-XXXX',
};
