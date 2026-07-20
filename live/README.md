# OLYCITY LIVE

Affiche ta game Valorant en temps réel sur le site OLYCITY.
Tourne automatiquement en arrière-plan — aucune manipulation avant chaque game.

## Installation (une seule fois)

1. Clic droit sur **INSTALLER.bat** → "Exécuter en tant qu'administrateur"
2. C'est tout.

OLYCITY LIVE démarrera automatiquement à chaque démarrage Windows, en fond, sans fenêtre.

## Mises à jour automatiques

À partir de la version 4.10.0, le script vérifie les releases officielles au démarrage puis toutes les 6 heures quand aucune partie n'est en cours. Une nouvelle version est téléchargée, vérifiée puis relancée automatiquement. Le dossier `node_modules`, le runtime portable et les logs sont conservés.

Pour désactiver temporairement la vérification pendant un dépannage, lance le script avec la variable `OLYCITY_SKIP_UPDATE=1`.

## Désinstaller

Double-clique sur **DESINSTALLER.bat** pour tout supprimer.

## Logs

Si quelque chose ne marche pas, consulte le fichier **olycity-live.log** dans ce dossier.
