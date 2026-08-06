# OLYCITY — Valorant Five Stack HQ

Site privé pour le five stack OLYCITY. Comps meta, stats live, roster et outils de session.

**→ [olycity.gg](https://liam-thorel.github.io/OLYVALO)**

---

## Features

**Comps & Meta**
- 7 maps en rotation — Fracture, Haven, Breeze, Lotus, Split, Pearl, Ascent
- 5 comps par map : S-Tier, PRO (données VLR.gg EWC 2026), A, B, FUN
- Comps PRO basées sur EWC Americas Qualifier 2026 post-nerf 12.09
- Agent clé ★ par comp · Badge patch ⚠ si comp outdatée
- Lineups YouTube par agent et par map

**Live 🔴**
- Agents, noms et rangs des joueurs en temps réel
- Peak historique par actes, y compris avec un pseudo masqué quand Riot fournit l'historique du PUUID
- Score de la game · Image de la map
- Mode streamer géré (affiche l'agent + ANONYME)
- Bouton Tracker.gg par joueur
- Multi-sessions : plusieurs membres peuvent lancer une game simultanément
- Groupement automatique si deux joueurs sont dans la même game

**Roster & Profils**
- 5 profils joueurs avec présence Firebase (point vert en temps réel)
- Dessin collaboratif par map (canvas Firebase, couleurs par profil)
- Page **Admin** cachée (`#admin`) : comptes secondaires par membre, ajout de
  joueurs, assignation des comptes Valorant/LoL détectés en live

**Agents**
- Fiche complète par agent · Filtres par rôle
- Comparateur de comps · Builder de comp · Comps sauvegardées

**Paris 🎲**
- Page publique (`#betting`) affichant le classement des points du bot Discord
  — voir `discord-bot/`

---

## OLYCITY Live

Script Node.js qui lit l'API locale Valorant **et League of Legends** (LCU) et
envoie les données en temps réel sur le site et sur Discord via Firebase.
Le profil LoL publié comprend le rang SoloQ, le bilan de saison, le rôle
principal et le top 3 champions avec les portraits Riot Data Dragon.

```
live/
├── index.js          Script principal
├── rank-utils.js     Calcul du rang actuel et du peak historique
├── runtime/node.exe  Runtime Node.js LTS autonome
├── INSTALLER.bat     Installation + tâche planifiée Windows
├── VERIFIER.bat      Vérifier si le script tourne + voir les logs
├── REINSTALLER.bat   Clean reinstall
├── DESINSTALLER.bat  Tout supprimer
└── silent.vbs        Lanceur silencieux (no window)
```

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
