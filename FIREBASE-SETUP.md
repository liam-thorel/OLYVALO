# Sécuriser la base Realtime Database — OLYCITY

> Document destiné à la personne qui administre le projet Firebase
> `realtime-database-5bb9f`. Aucune connaissance du code n'est nécessaire.

## Le problème

La base accepte aujourd'hui **n'importe quelle écriture, sans authentification**.
L'URL est publique (elle est en clair dans le code du site). Concrètement,
n'importe qui peut aujourd'hui :

- effacer **toute la base** en une requête ;
- écraser les sessions live, les dessins, le roster ;
- **s'attribuer autant de points de paris qu'il veut**.

Ce n'est pas théorique : une seule requête HTTP suffit, sans compte ni clé.

## Deux niveaux

Le niveau 1 se fait seul, tout de suite. Le niveau 2 demande une coordination
avec Liam et peut venir plus tard.

---

## Niveau 1 — Empêcher la destruction (5 min, aucune coordination)

Ferme l'écriture à la racine et interdit d'écraser une collection entière.
Chaque écriture doit viser une sous-clé précise.

**Aucun impact sur le site, le bot ou les scripts des joueurs** : ils écrivent
tous sur des sous-clés.

### Application

Console Firebase → **Realtime Database** → onglet **Règles** → remplacer tout
le contenu par ceci → **Publier** :

```json
{
  "rules": {
    ".read": true,
    ".write": false,

    "betting":        { ".write": true },
    "discordConfig":  { ".write": true },
    "rankTracking":   { ".write": true },
    "valorantAwards": { ".write": true },

    "live": {
      "curse": { ".write": true },
      "$collection": { "$key": { ".write": true } }
    },
    "historyIndex":  { "$game":    { "$key":       { ".write": true } } },
    "rosterOverlay": { "$section": { "$id":        { ".write": true } } },
    "discovered":    { "$key":     { ".write": true } },
    "sessions":      { "$profile": { "$sessionId": { ".write": true } } },
    "active":        { "$profile": { "$sessionId": { ".write": true } } },
    "drawings":      { "$map":     { ".write": true } }
  }
}
```

### Vérification

Ouvrir le site, aller sur **Live** et sur **Paris** : tout doit s'afficher
normalement. Si un membre est en game, sa session doit apparaître.

---

## Niveau 2 — Protéger les points (demande une coordination)

Réserve `betting/` (soldes, paris), `discordConfig/`, `rankTracking/` et
`valorantAwards/` au bot Discord, qui tourne sur une machine privée.

Ces quatre chemins ne sont écrits **que** par le bot. Les autres sont écrits par
les scripts installés chez les joueurs et par les navigateurs : ceux-là sont
distribués publiquement, aucun secret ne peut leur être confié, ils doivent
rester ouverts.

### ⚠️ Ordre impératif

Inverser ces deux étapes coupe les paris, les soldes et les récaps du bot.

**Étape 1 — fournir le secret à Liam.**

Console Firebase → ⚙️ **Paramètres du projet** → onglet **Comptes de service**
→ **Secrets de base de données (hérités)** → afficher et copier le secret.

Le transmettre à Liam **en privé** (pas dans un salon Discord public) : il le
mettra dans la configuration du bot. Tant que le niveau 2 n'est pas publié, ce
secret est simplement ignoré par Firebase — rien ne change côté bot.

> **Si cette section n'existe pas** dans la console (Google l'a retirée sur les
> projets récents), dis-le à Liam : il faudra passer par un compte de service,
> ce qui demande une modification du bot. Ne pas bloquer le niveau 1 pour ça.

**Étape 2 — publier les règles**, une fois que Liam a confirmé que le bot
tourne avec le secret.

Onglet **Règles** → reprendre le JSON du niveau 1 en remplaçant les quatre
lignes suivantes :

```json
    "betting":        { ".write": "auth !== null" },
    "discordConfig":  { ".write": "auth !== null" },
    "rankTracking":   { ".write": "auth !== null" },
    "valorantAwards": { ".write": "auth !== null" },
```

→ **Publier**.

### Vérification

Dans Discord : `/balance` doit répondre, et un pari sur la prochaine game doit
s'enregistrer. Si ça échoue, revenir aux règles du niveau 1 (les quatre lignes
avec `true`) : le bot refonctionne immédiatement.

---

## Retour arrière

À tout moment, republier ceci restaure l'état d'origine :

```json
{ "rules": { ".read": true, ".write": true } }
```

## Alternative : en ligne de commande

Le dépôt contient déjà `database.rules.json` (niveau 2) et `firebase.json`.
Avec les droits owner :

```bash
git clone https://github.com/liam-thorel/OLYVALO.git && cd OLYVALO
npx firebase-tools login
npx firebase-tools deploy --only database --project realtime-database-5bb9f
```

## Ce que ça ne protège pas

La lecture reste publique (le site n'a aucune authentification), et un visiteur
peut toujours écrire de fausses sessions live ou de faux dessins — ces chemins
doivent rester ouverts. La protection porte sur l'irréversible (effacement de
masse) et sur ce qui a de la valeur (l'économie de points).
