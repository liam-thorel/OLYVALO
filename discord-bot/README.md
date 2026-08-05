# OLYCITY Discord Bot

Notifie un salon Discord quand un membre du roster OLYCITY lance ou termine une
game **Valorant** ou **League of Legends**, avec un système de paris entre
membres du serveur sur l'issue de la game.

## Comment ça marche

- **Valorant** : `live/index.js` (le script que chaque joueur fait déjà tourner
  via `INSTALLER.bat`) pousse ses sessions vers Firebase RTDB, sous `live/sessions`,
  puis un résumé de fin de game (`live/history`, KDA/RR/résultat).
- **LoL** : depuis la v4.15.0, ce même script détecte aussi les games LoL via
  l'API locale du League Client (LCU, authentifiée par lockfile) et pousse vers
  `live/lolSessions` (champion, matchup, rang) puis `live/lolHistory` en fin de
  game (KDA, CS, build, victoire/défaite, variation de LP).
- **Ce bot** écoute ces noeuds Firebase en continu (SSE) et poste une
  notification dans les salons Discord configurés au début et à la fin de
  chaque session suivie, avec ouverture automatique d'un round de paris.

Seuls les comptes du roster OLYCITY (`data/roster.json` sur le site, y compris
les comptes secondaires assignés depuis `#admin`) peuvent être suivis : le
suivi ne fonctionne que pour les joueurs qui font tourner le script local. Un
compte quelconque ne peut pas être suivi sans lui.

## 1. Créer l'application Discord

1. https://discord.com/developers/applications → **New Application**.
2. Onglet **Bot** → **Reset Token** → copie le token (⚠️ à ne jamais commit).
3. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions du bot : `Send Messages`, `Embed Links`
   - Ouvre l'URL générée pour inviter le bot sur ton serveur.
4. Note l'**Application ID** (onglet General Information).

## 2. Configuration

```bash
cd discord-bot
npm install
cp .env.example .env
```

Remplis `.env` avec `DISCORD_TOKEN` et `DISCORD_CLIENT_ID`. Renseigne aussi
`DISCORD_GUILD_ID` (clic droit sur ton serveur → Copier l'ID, mode développeur
Discord activé) pendant le développement — les commandes d'un serveur précis
apparaissent instantanément, contre ~1h pour des commandes globales.

`DISCORD_LOG_CHANNEL_ID` est optionnel : si renseigné, le bot y poste ses
erreurs fatales avant de s'arrêter (utile une fois déployé, pour voir pourquoi
il a crashé sans ouvrir les logs du panel d'hébergement).

## 3. Enregistrer les commandes slash

À faire une fois, puis à chaque fois qu'une commande change :

```bash
npm run deploy-commands
```

## 4. Héberger le bot

### Option gratuite : Bot-Hosting.net

1. Connecte-toi sur [bot-hosting.net](https://bot-hosting.net/login) avec Discord.
2. Réclame des **coins** gratuits (générateur intégré, jusqu'à 10/jour) — ils
   servent à créer et **renouveler** ton serveur (facturation hebdo ou
   mensuelle payée en coins). ⚠️ Ce n'est pas un "gratuit et j'y pense plus" :
   il faut repasser réclamer des coins régulièrement pour éviter que le
   serveur expire, sans quoi le bot s'arrête.
3. **Create Server** → langage **Node.js** (pas "JavaScript" ni "Java") →
   choisis le plan le plus léger (ce bot n'a besoin de quasiment aucune
   ressource) → confirme.
4. Dans le panel du serveur, onglet **Files** :
   - compresse le contenu de `discord-bot/` en `.zip` (inutile d'inclure
     `node_modules/` — le serveur installe les dépendances à partir de
     `package.json` tout seul)
   - upload le zip, clique les `...` à côté → **Unarchive**
   - sélectionne tous les fichiers extraits → **Move** → chemin `..` pour les
     remonter à la racine, puis supprime le zip
   - crée (ou upload) un fichier `.env` à la racine avec `DISCORD_TOKEN` et
     `DISCORD_CLIENT_ID` remplis — le bot le lit exactement comme en local
5. Onglet **Startup** : fichier principal = `index.js`.
6. Enregistre les slash commands une seule fois (avant le premier démarrage,
   puis à chaque fois qu'une commande change) — soit depuis la **console** du
   panel avec `node deploy-commands.js`, soit depuis ta machine en local
   (`npm run deploy-commands` — c'est juste un appel à l'API Discord, pas
   besoin d'être sur le même serveur que le bot).
7. Démarre le serveur depuis le panel. Regarde la console live pour vérifier
   `✅ Connecté en tant que ...` et `👂 Écoute des sessions...`.

### Alternative : VPS / cloud classique

```bash
npm start
```

Garde le process actif avec un gestionnaire de process, par exemple
[pm2](https://pm2.keymetrics.io/) :

```bash
npm install -g pm2
pm2 start index.js --name olycity-discord-bot
pm2 save
pm2 startup   # pour redémarrer automatiquement avec le serveur
```

## Commandes

**Suivi**
- `/track joueur:<membre> jeu:<Valorant|League of Legends>` — active le suivi
  d'un membre dans le salon où la commande est tapée (autocomplete sur les
  noms du roster).
- `/untrack joueur:<membre> jeu:<...>` — désactive le suivi.
- `/track-valo-all` / `/track-lol-all` — active le suivi de **tout** le roster
  d'un coup pour le jeu donné, dans ce salon.
- `/list` — liste les suivis actifs du salon courant.

`/track`, `/untrack`, `/track-valo-all` et `/track-lol-all` nécessitent la
permission Discord **Gérer les salons**.

**Paris** — s'ouvrent automatiquement (boutons + lien Porofessor/site) quand
une game suivie démarre, fenêtre de 5 minutes :
- `/bet choix:<Victoire|Défaite> montant:<points>` — parier sur la game en
  cours dans le salon (alternative aux boutons).
- `/balance` — solde de points (500 crédités par jour, au premier contact).
- `/mybets` — historique de tes paris et ROI.
- `/leaderboard` — classement général des points.

Le classement hebdomadaire se réinitialise et s'annonce automatiquement (les
gains de la semaine, pas le solde total) ; les séries de paris gagnants sont
annoncées dès 3 d'affilée. Un round de paris ouvert sur plusieurs joueurs
OLYCITY dans la même game (stack) est unique et partagé entre eux.

**Stats**
- `/stats joueur:<membre> jeu:<...>` — winrate, champions/agents les plus
  joués, forme récente, calculés depuis l'historique enregistré par le script
  local (`live/history` et `live/lolHistory`) — vide tant qu'aucune game n'a
  été jouée avec le suivi actif.

## Moteur de cotes

Riot masque l'identité de l'équipe adverse pendant toute la sélection de
champion et la game — impossible de savoir légitimement qui sont les 5 en
face. Les cotes (`odds.js`) reposent donc uniquement sur des signaux propres
à l'équipe OLYCITY suivie : rang actuel, winrate personnel récent et winrate
sur le champion/agent joué (les deux derniers calculés depuis l'historique
qu'on enregistre nous-mêmes — peu fiable au tout début, s'affine avec le temps).

## Config partagée

La liste des suivis, les rounds de paris et les soldes sont stockés dans la
même base Firebase RTDB que le reste du site OLYCITY (`discordConfig/trackers`,
`betting/*`), donc partagés entre toutes les instances du bot si tu en fais
tourner plusieurs, et lisibles par la page **Paris** du site (lecture seule).
