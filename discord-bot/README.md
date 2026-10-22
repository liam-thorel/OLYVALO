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

**Identification d'un joueur.** Le bot résout le membre derrière une session
dans cet ordre (`roster.js` → `memberByIdentity`) :

1. `memberId` — la personne s'est identifiée à l'installation du script
   (depuis `live/` v4.16.0). Insensible aux renommages et aux comptes multiples.
2. `puuid` — identifiant Riot permanent, survit lui aussi aux renommages.
3. `playerName` (`pseudo#tag`) — repli historique, qui casse dès qu'un joueur
   se renomme. C'était l'unique méthode avant la v4.16.0, d'où les pertes de
   suivi après un changement de pseudo.

## 1. Créer l'application Discord

1. https://discord.com/developers/applications → **New Application**.
2. Onglet **Bot** → **Reset Token** → copie le token (⚠️ à ne jamais commit).
3. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions du bot : `Send Messages`, `Embed Links`
   - Ouvre l'URL générée pour inviter le bot sur ton serveur.
4. Note l'**Application ID** (onglet General Information).
5. Pour le salon `#livechat` : onglet **Bot** → *Privileged Gateway Intents*
   → coche **Message Content Intent**. Le bot le détecte au démarrage ; sans
   lui, seule la commande `/livechat` fonctionne (les messages du salon sont
   ignorés), et le reste du bot n'est pas affecté.

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

Le bot tourne en Docker sur le mini-PC de la maison (ACEPC AK1), à côté du bot
musique. La préparation du serveur (Linux, Docker, Tailscale) est décrite dans le
`DEPLOY.md` du dépôt `discord-music-bot`. Installation du bot, une seule fois :

```bash
mkdir -p ~/olycity-bot && cd ~/olycity-bot
curl -fsSL https://github.com/liam-thorel/OLYVALO/archive/refs/heads/main.tar.gz | tar -xz --strip-components=2 OLYVALO-main/discord-bot
nano .env                  # DISCORD_TOKEN, DISCORD_CLIENT_ID, …
docker compose up -d --build
docker compose logs -f     # attendre « ✅ Connecté en tant que ... »
```

Le conteneur redémarre seul après un crash ou un redémarrage du mini-PC.

| Action | Commande (dans `~/olycity-bot`) |
|---|---|
| Logs en direct | `docker compose logs -f` |
| Redémarrer | `docker compose restart` |
| Arrêter | `docker compose down` |

Sans Docker, `npm install --omit=dev && npm start` fonctionne aussi (Node 18+).

## Déploiement automatique (GitHub Actions)

Tout merge sur `main` qui touche `discord-bot/**` déclenche
`.github/workflows/deploy-bot.yml` : la suite de tests tourne, puis — et
seulement si elle passe — le mini-PC est synchronisé et le bot redémarré.

Le mini-PC n'a aucun port ouvert sur Internet : le runner GitHub rejoint le
réseau privé **Tailscale** le temps du déploiement, puis s'y connecte en SSH.

### Secrets à créer une fois

`Settings → Secrets and variables → Actions → New repository secret` :

| Secret | Valeur |
|---|---|
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | client OAuth Tailscale (tag `tag:ci`, voir `DEPLOY.md` du bot musique) |
| `DEPLOY_HOST` | nom Tailscale du mini-PC (ex. `ak1`) ou son IP `100.x.y.z` |
| `DEPLOY_USER` | utilisateur Linux qui possède `~/olycity-bot` (membre du groupe `docker`) |
| `DEPLOY_SSH_KEY` | contenu **complet** de la clé privée, en-têtes `-----BEGIN…` / `-----END…` compris |

La clé n'est jamais écrite dans le dépôt : le workflow la lit depuis le secret,
l'utilise, puis l'efface (`shred`).

### Ce que fait le déploiement

1. Télécharge l'archive de `main` **depuis le mini-PC**.
2. Fusionne `discord-bot/` par-dessus `~/olycity-bot/`. `.env` n'est pas dans le
   dépôt : il est préservé.
3. Reconstruit l'image et recrée le conteneur `olycity-bot`.
4. Vérifie 8 s plus tard que le conteneur tourne **sans avoir redémarré**. Sinon,
   il affiche ses derniers logs et **fait échouer le workflow** — le bot faisant
   `process.exit(1)` sur toute exception non capturée, Docker le relancerait en
   boucle et un déploiement cassé passerait sinon pour un succès.

La synchronisation ne supprime jamais de fichier. Un fichier retiré du dépôt
subsiste donc sur le mini-PC, sans conséquence : `index.js` charge ses commandes via
une liste explicite de `require()`, pas un scan de dossier — un fichier orphelin
n'est jamais chargé. À nettoyer à la main si besoin.

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

**Livechat** — images, GIF, vidéos ou textes affichés par-dessus l'écran des
membres qui ont OLYCITY Live (voir `live/livechat.js`) :
- `/livechat-salon` — fait du salon courant le `#livechat` (permission
  **Gérer les salons**). Tout ce qui y est posté s'affiche : pièce jointe, GIF
  Tenor, lien d'image ou simple texte. `g:`, `m:` ou `p:` en début de message
  choisit le format (grand, moyen par défaut, petit) ; une mention juste après
  vise une seule personne (`g: @Nico regarde`). Le bot réagit 📺 si au moins
  un écran le reçoit, 💤 sinon.
- `/livechat media:<fichier> texte:<…> format:<Grand|Moyen|Petit> pour:<membre>`
  — la même chose depuis n'importe quel salon.

Les envois du site `olycity.fr/livechat` arrivent dans le même salon par un
webhook (Worker `workers/livechat`) : le bot ignore les messages de webhook,
le Worker publie déjà l'élément. La file `livechat/queue` est purgée chaque
minute des éléments de plus de 10 minutes.

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
