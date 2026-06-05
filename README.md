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
- Agents, noms réels et rangs des 12 joueurs en temps réel
- Score de la game · Image de la map
- Mode streamer géré (affiche l'agent + ANONYME)
- Bouton Tracker.gg par joueur
- Multi-sessions : plusieurs membres peuvent lancer une game simultanément
- Groupement automatique si deux joueurs sont dans la même game

**Roster & Profils**
- 5 profils joueurs avec présence Firebase (point vert en temps réel)
- Dessin collaboratif par map (canvas Firebase, couleurs par profil)

**Agents**
- Fiche complète par agent · Filtres par rôle
- Comparateur de comps · Builder de comp · Comps sauvegardées

---

## OLYCITY Live

Script Node.js qui lit l'API locale Valorant et envoie les données en temps réel sur le site via Firebase.

```
live/
├── index.js          Script principal
├── INSTALLER.bat     Installation + tâche planifiée Windows (admin requis)
├── VERIFIER.bat      Vérifier si le script tourne + voir les logs
├── REINSTALLER.bat   Clean reinstall
├── DESINSTALLER.bat  Tout supprimer
└── silent.vbs        Lanceur silencieux (no window)
```

**Setup :**
1. Clic droit → Exécuter en tant qu'administrateur sur `INSTALLER.bat`
2. C'est tout — le script démarre automatiquement à chaque allumage Windows

Requiert Node.js 18+ · Aucun risque Vanguard (API officielle Riot)

---

## Stack

- Vanilla JS (ES modules) · CSS custom properties
- Firebase Realtime Database (présence + live data + dessin)
- Valorant API : Riot Client lockfile · PVP.net `glz-eu-1.eu.a.pvp.net` · `pd.eu.a.pvp.net`
- GitHub Pages

---

## Données

- Comps : VLR.gg · EWC Americas Qualifier 2026 · VCT Stage 1 2026
- Agents : valorant-api.com
- Stats joueurs : HenrikDev API
