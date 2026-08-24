# OLYCITY LIVE

Affiche ta game Valorant en temps réel sur le site OLYCITY.
Tourne automatiquement en arrière-plan — aucune manipulation avant chaque game.

## Installation autonome (une seule fois)

1. Décompresse entièrement le ZIP dans un dossier permanent.
2. Double-clique sur **INSTALLER.bat**.
3. C'est tout. Si Windows refuse exceptionnellement la tâche automatique, relance seulement l'installateur en administrateur.

OLYCITY LIVE démarrera automatiquement à chaque démarrage Windows, en fond, sans fenêtre.

Deux méthodes complémentaires sont configurées : une tâche Windows et le dossier
**Démarrage** de la session. Le script répare automatiquement ce second lancement
s'il manque et empêche plusieurs instances de tourner en même temps.

Au lancement, la version autonome arrête aussi les anciennes versions Python
`olycity-live.exe` / `olycity_live.py` encore actives. Leur ancien format pouvait
faire clignoter le serveur, les ranks et le roster sur le site.

Le compte Riot actif est revérifié pendant l'exécution. Si tu changes de compte
sans redémarrer le PC, l'ancien signal est retiré et la nouvelle partie est
détectée automatiquement en quelques secondes.

Pour League of Legends, le compte connecté est également détecté dès que le
client est ouvert, même hors partie. Son Riot ID, son PUUID, sa région et son
état apparaissent alors dans le panel admin OLYCITY afin de pouvoir le rattacher
à un membre et activer sa surveillance centrale.

La version 4.17.7 synchronise aussi le rang SoloQ et les trois champions les
plus joués sur la saison complète. Le rôle reste calculé à partir des parties
observées localement par le script. Les portraits proviennent directement des
assets officiels Riot Data Dragon.

Node.js LTS et la dépendance WebSocket sont inclus dans le dossier. Il n'y a rien à installer sur le PC et aucune commande npm à lancer.

Le package embarque le binaire Windows officiel Node.js 24.18.0 LTS et `ws` 8.21.1. Leurs licences sont fournies dans `runtime/NODE-LICENSE.txt` et `node_modules/ws/LICENSE`.

## Qui joue sur ce PC ?

À la toute première installation (et une seule fois), OLYCITY LIVE demande à
qui il a affaire : la liste du roster s'affiche, tu tapes ton numéro. Si tu n'y
es pas encore, choisis **Autre** et donne ton prénom — tu es ajouté au roster
OLYCITY automatiquement.

Ce choix est mémorisé dans `olycity-identity.json`, à côté du script. Il n'est
pas touché par les mises à jour automatiques.

À quoi ça sert : avant, le suivi reposait uniquement sur ton Riot ID. Dès que
tu changeais de pseudo, le bot ne te reconnaissait plus et il fallait
réassigner ton compte à la main dans la page `#admin`. Maintenant le script
sait qui tu es, rattache tout seul ton compte Riot courant à ton nom, et
continue de te suivre après n'importe quel renommage — ou si tu joues sur un
autre compte.

Si tu mets à jour une installation existante, une fenêtre s'ouvrira une fois
pour poser la question. En attendant la réponse, le suivi continue de
fonctionner comme avant.

Pour changer de personne plus tard (PC prêté, erreur de choix) : double-clique
sur **IDENTITE.bat**.

## Mises à jour automatiques

Le script vérifie les releases officielles au démarrage et toutes les 30 minutes, même pendant une partie. Une nouvelle version est téléchargée et vérifiée silencieusement en arrière-plan. Si une game est en cours, le script attend sa fin puis se redémarre tout seul ; personne n'a besoin de le fermer ou de le relancer. Le dossier `node_modules`, le runtime portable et les logs sont conservés.

Pour désactiver temporairement la vérification pendant un dépannage, lance le script avec la variable `OLYCITY_SKIP_UPDATE=1`.

## Rangs live

Le rang actuel, le RR récent et le meilleur rang historique sont lus directement
depuis les données MMR du client Valorant. Le peak utilise l'historique des actes
et les victoires par tier. Cela fonctionne aussi lorsque le pseudo est masqué,
car la partie conserve le PUUID du joueur.

Si Riot ne fournit pas l'historique d'un joueur, le site affiche explicitement
**MAX RÉCENT** au lieu de présenter les cinq dernières parties comme un peak historique.

## Serveur live

Le serveur Riot de la partie est détecté depuis le `GamePodID` du match et envoyé
au Live (Paris, Francfort, Londres, etc.). Il apparaît aussi dans le sélecteur
lorsque plusieurs games sont suivies en même temps.

## Désinstaller

Double-clique sur **DESINSTALLER.bat** pour tout supprimer.

## Logs

Si quelque chose ne marche pas, consulte le fichier **olycity.log** dans ce
dossier (`olycity-live.log` ne contient que le diagnostic de détection du
client League).
