# OLYCITY LIVE

Affiche ta game Valorant en temps réel sur le site OLYCITY.
Tourne automatiquement en arrière-plan — aucune manipulation avant chaque game.

## Installation autonome (une seule fois)

1. Décompresse entièrement le ZIP dans un dossier permanent.
2. Double-clique sur **INSTALLER.bat**.
3. C'est tout. Si Windows refuse exceptionnellement la tâche automatique, relance seulement l'installateur en administrateur.

OLYCITY LIVE démarrera automatiquement à chaque démarrage Windows, en fond, sans fenêtre.

Node.js LTS et la dépendance WebSocket sont inclus dans le dossier. Il n'y a rien à installer sur le PC et aucune commande npm à lancer.

Le package embarque le binaire Windows officiel Node.js 24.18.0 LTS et `ws` 8.21.1. Leurs licences sont fournies dans `runtime/NODE-LICENSE.txt` et `node_modules/ws/LICENSE`.

## Mises à jour automatiques

Le script vérifie les releases officielles au démarrage puis toutes les 6 heures quand aucune partie n'est en cours. Une nouvelle version est téléchargée, vérifiée puis relancée automatiquement. Le dossier `node_modules`, le runtime portable et les logs sont conservés.

Pour désactiver temporairement la vérification pendant un dépannage, lance le script avec la variable `OLYCITY_SKIP_UPDATE=1`.

## Désinstaller

Double-clique sur **DESINSTALLER.bat** pour tout supprimer.

## Logs

Si quelque chose ne marche pas, consulte le fichier **olycity-live.log** dans ce dossier.
