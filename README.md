# OLYCITY

Site privé du Discord OLYCITY : Valorant, League of Legends, jeux coop, historique, live et outils de groupe.

**→ [olycity.gg](https://liam-thorel.github.io/OLYVALO)**

---

## Features

**Comps & Meta**
- 7 maps suivies — Haven, Abyss, Lotus, Split, Ascent, Sunset et Summit
- 3 choix lisibles par map : Ranked, Pro et Fun
- Comps PRO issues des compétitions récentes et recommandations Ranked adaptées au five stack
- Agent clé ★ par comp · Badge patch ⚠ si une source doit être révisée
- Conseils de map intégrés et lineups YouTube conservées uniquement sur les maps couvertes

**Live 🔴**
- Agents, noms et rangs des joueurs en temps réel
- Peak historique par actes, y compris avec un pseudo masqué quand Riot fournit l'historique du PUUID
- Image de la map et serveur Riot
- Mode streamer géré (affiche l'agent + ANONYME)
- Bouton Tracker.gg par joueur
- Multi-sessions : plusieurs membres peuvent lancer une game simultanément
- Groupement automatique si deux joueurs sont dans la même game

**Roster & Profils**
- 5 profils joueurs avec présence Firebase (point vert en temps réel)
- Page **Admin** cachée (`#admin`) : comptes secondaires par membre, ajout de
  joueurs, assignation des comptes Valorant/LoL détectés en live

**Agents**
- Fiche complète accessible depuis les portraits des compositions
- Compétences, présence dans les trois types de compos et lineups disponibles

**Paris 🎲**
- Page publique (`#betting`) affichant le classement des points du bot Discord
  — voir `discord-bot/`

**Jeux du Discord**
- Suggestions et votes associés aux profils OLYCITY
- Recherche automatique IGDB/Steam : titre, jaquette, genres, sortie et plage
  de joueurs préremplis, avec correction manuelle possible
- Statuts À faire / Prévu / Joué / Mise à jour à refaire
- Service de catalogue indépendant dans `workers/game-catalog/` : aucune
  dépendance au bot Discord

---

## OLYCITY Live

Script Node.js qui lit l'API locale Valorant **et League of Legends** (LCU) et
envoie les données en temps réel sur le site et sur Discord via Firebase.
Le profil LoL publié comprend le rang SoloQ, le bilan de saison, le rôle
principal et le top 3 champions avec les portraits Riot Data Dragon.

```
live/
├── index.js           Script principal
├── lol-watcher.js     Détection des games League of Legends (LCU)
├── rank-utils.js      Calcul du rang actuel et du peak historique
├── identity.js        Membre OLYCITY associé à cette installation
├── ask-identity.js    Invite « qui es-tu ? » (une fois, à l'installation)
├── account-binding.js Rattache le compte Riot courant au membre choisi
├── updater.js         Mise à jour automatique depuis les releases GitHub
├── runtime/node.exe   Runtime Node.js LTS autonome
├── INSTALLER.bat      Installation + tâche planifiée Windows
├── IDENTITE.bat       Changer la personne associée à ce PC
├── VERIFIER.bat       Vérifier si le script tourne + voir les logs
├── REINSTALLER.bat    Clean reinstall
├── DESINSTALLER.bat   Tout supprimer
└── silent.vbs         Lanceur silencieux (no window)
```

**Identification :** à la première installation, le script demande qui joue sur
ce PC (liste du roster + option « Autre » pour ajouter quelqu'un). Le membre
choisi est mémorisé et publié avec chaque session, ce qui garde le suivi valide
même après un changement de pseudo Riot ou un changement de compte.

**Setup :**
1. Décompresser complètement le ZIP de la dernière release.
2. Double-cliquer sur `INSTALLER.bat`.
3. C'est tout — le script démarre automatiquement à chaque allumage Windows.

Node.js et les dépendances sont inclus : aucune installation globale ni commande npm.

---

## OLYCITY Discord Bot

Bot Discord (`discord-bot/`) qui notifie le lancement et la fin des games
Valorant/LoL suivies (résumé KDA, build, variation de rang), avec un système
de paris entre membres du serveur sur l'issue de chaque game suivie (cotes
basées sur le rang et l'historique perso, points quotidiens, classement
hebdomadaire). Détails d'installation et de déploiement dans
[`discord-bot/README.md`](discord-bot/README.md).

---

## Stack

- Vanilla JS (ES modules) · CSS custom properties
- Firebase Realtime Database (présence + live data + dessin + paris)
- Valorant API : Riot Client lockfile · PVP.net `glz-eu-1.eu.a.pvp.net` · `pd.eu.a.pvp.net`
- League API : League Client (LCU) lockfile · Data Dragon (champions/items)
- Discord.js (bot Node.js séparé, voir `discord-bot/`)
- GitHub Pages

---

## Données

- Comps : VLR.gg · EWC Americas Qualifier 2026 · VCT Stage 1 2026
- Agents : valorant-api.com
- Stats joueurs : HenrikDev API

---

## Configuration

**Clé API HenrikDev.** Elle n'est plus dans le dépôt. Deux sources, dans cet
ordre de priorité :

1. **La clé personnelle** du visiteur, saisie depuis la page Roster (bouton
   🔑) et conservée dans son navigateur. Elle a son propre quota.
2. **La clé partagée**, injectée au déploiement depuis le secret GitHub
   `HENRIK_API_KEY` (voir `.github/workflows/pages.yml`). Elle sert de valeur
   par défaut pour qui n'a rien saisi.

⚠️ Le site est statique : la clé partagée est **téléchargée par le navigateur**
et donc lisible par tout visiteur. Le secret GitHub la sort du dépôt et de son
historique, et permet de la changer en un seul endroit — il ne la rend pas
confidentielle. La clé doit rester gratuite, rate-limitée et révocable.

Sans secret configuré, le site fonctionne : chacun renseigne simplement la
sienne.
