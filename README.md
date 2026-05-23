# OLYCITY — Valorant Meta Comps

Site de référence des compositions Valorant pour l'équipe OLYCITY (Nico, Liam, Rayhan, Mathis, Noé). Patch 12.09 · 2026.

## Features

- 7 maps avec compositions S-Tier et A-Tier sourcées (VLR.gg, Hotspawn, Reddit, dak.gg)
- Page agent immersive avec abilities en français, bio, compositions liées
- Sync live des stats joueurs via API HenrikDev (rank, win rate, agents joués)
- Recherche par agent, favoris, mode sombre/clair
- Effets 3D (tilt, parallax, glow atmosphérique)

## Installation locale

### 1. Cloner le repo

```bash
git clone https://github.com/<ton-username>/olycity.git
cd olycity
```

### 2. Configurer la clé API

```bash
cp config.example.js config.js
```

Édite `config.js` et remplace `HDEV-XXXX-XXXX-XXXX-XXXX` par ta clé HenrikDev.
Obtiens une clé gratuite ici : https://api.henrikdev.xyz/dashboard

### 3. Lancer un serveur local

Les modules ES6 nécessitent un serveur HTTP (pas de `file://`).

**Avec Python (recommandé, déjà installé sur la plupart des machines) :**
```bash
python -m http.server 8000
```

**Avec Node :**
```bash
npx serve
```

**Avec VS Code :** installe l'extension "Live Server" et clique droit sur `index.html` → "Open with Live Server".

Puis ouvre **http://localhost:8000** dans ton navigateur.

## Déploiement sur GitHub Pages

1. Push le projet sur un repo GitHub (la clé est protégée par `.gitignore`)
2. Settings → Pages → Source : `main` branch, dossier `/` (root)
3. Le site sera live sur `https://<ton-username>.github.io/<nom-du-repo>/`

⚠️ **Sur un repo public, les utilisateurs devront créer leur propre `config.js`.**
Sinon, mets le repo en privé.

## Structure du projet

```
olycity/
├── index.html              Structure HTML
├── config.js               Clé API (gitignored)
├── config.example.js       Template de config
├── css/
│   ├── tokens.css          Variables theme
│   ├── layout.css          Topbar, hero, sections
│   ├── components.css      Cards, buttons, badges
│   ├── agent-page.css      Page agent immersive
│   └── responsive.css      Media queries
├── js/
│   ├── main.js             Point d'entrée
│   ├── api.js              valorant-api.com
│   ├── henrik.js           HenrikDev sync
│   ├── render.js           Tous les renderers HTML
│   ├── interactions.js     Clicks, tilt, parallax
│   └── storage.js          localStorage
└── data/
    ├── comps.json          7 maps + compositions
    ├── roster.json         Roster OLYCITY
    ├── roles.json          Mapping agents → rôles
    └── agents-fr.json      Traductions FR
```

## Mise à jour des données

Pour ajouter une nouvelle composition ou modifier les notes meta, édite simplement `data/comps.json`. Le site se met à jour automatiquement au rechargement.

Pour ajouter un nouveau joueur, édite `data/roster.json`.

## Sources

- [VLR.gg](https://vlr.gg) — Esports & meta
- [Hotspawn](https://www.hotspawn.com/valorant/guide/valorant-best-team-comps)
- [Reddit r/ValorantCompetitive](https://reddit.com/r/ValorantCompetitive)
- [dak.gg](https://dak.gg/valorant)
- [valorant-api.com](https://valorant-api.com) — Assets officiels
- [HenrikDev API](https://docs.henrikdev.xyz) — Stats joueurs

## Crédits

Site fait par et pour l'équipe **OLYCITY**.
Non affilié à Riot Games. Valorant et tous les assets associés sont propriété de Riot Games, Inc.
