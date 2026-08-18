# OLYCITY game catalog

Worker indépendant du bot Discord. Il recherche les jeux dans IGDB, rattache
les fiches Steam et renvoie uniquement les métadonnées utiles au formulaire.

## Configuration

Créer une application Twitch confidentielle pour IGDB, puis enregistrer les
deux secrets dans Cloudflare :

```text
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET
npx wrangler deploy
```

Ajouter ensuite l’URL déployée dans la variable GitHub Actions
`GAME_CATALOG_ENDPOINT`. Aucun identifiant Twitch n’est envoyé au navigateur.
