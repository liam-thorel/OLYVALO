# Notifications OLYCITY

Worker Web Push indépendant du bot Discord. Il conserve les abonnements dans
Cloudflare KV, vérifie Firebase chaque minute et envoie :

- le rappel d’une soirée 15 minutes avant ;
- les promotions de palier Valorant et League ;
- un test manuel réservé aux profils Nico et Liam.

## Déploiement

1. Installer les dépendances avec npm install.
2. Créer le namespace KV et reporter son identifiant dans wrangler.toml.
3. Générer une paire VAPID.
4. Enregistrer VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY avec wrangler secret put.
5. Déployer avec wrangler deploy.
6. Ajouter l’URL obtenue dans la variable GitHub Actions NOTIFICATION_ENDPOINT.

La clé privée VAPID ne doit jamais être ajoutée au dépôt.
