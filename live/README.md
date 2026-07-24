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

## Rangs live

Le rang actuel, le RR récent et le meilleur rang historique sont lus directement
depuis les données MMR du client Valorant. Le peak utilise l'historique des actes
et les victoires par tier. Cela fonctionne aussi lorsque le pseudo est masqué,
car la partie conserve le PUUID du joueur.

Si Riot ne fournit pas l'historique d'un joueur, le site affiche explicitement
**MAX RÉCENT** au lieu de présenter les cinq dernières parties comme un peak historique.

## Désinstaller

Double-clique sur **DESINSTALLER.bat** pour tout supprimer.

## Logs

Si quelque chose ne marche pas, consulte le fichier **olycity-live.log** dans ce dossier.
