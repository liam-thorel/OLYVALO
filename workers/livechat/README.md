# Livechat OLYCITY

Worker de la page `olycity.fr/livechat` (dépôt `olycity-hub`) : il reçoit les
médias envoyés depuis le navigateur et publie l'élément dans `livechat/queue`,
que chaque OLYCITY Live affiche par-dessus l'écran.

- **Connexion Discord** : la page obtient un jeton OAuth2 (`identify`) de
  l'application OLYBOT ; le Worker le vérifie auprès de Discord et retrouve le
  membre dans le roster (identifiant Discord tiré de l'URL d'avatar). Le nom et
  l'avatar affichés viennent du roster ; un compte hors roster est refusé.
- **Médias jusqu'à 500 Mo** dans le bucket R2 `olycity-livechat-media`, servis
  sur `/m/<clé>`. Un Worker gratuit refuse les requêtes de plus de 100 Mo : la
  page envoie le fichier en morceaux de 50 Mo (envoi multipart R2).
- **Historique** : chaque envoi est annoncé dans `#livechat` par un webhook,
  avec le lien du média. Le bot ignore les messages de webhook.

## Mise en place (déjà faite une fois)

```bash
npx wrangler r2 bucket create olycity-livechat-media
npx wrangler r2 bucket lifecycle add olycity-livechat-media expire-1-day --expire-days 1
npx wrangler r2 bucket lifecycle add olycity-livechat-media abort-uploads-1-day --abort-multipart-days 1
npx wrangler secret put DISCORD_WEBHOOK_URL   # webhook du salon #livechat
npx wrangler deploy
```

Sur le portail Discord, application OLYBOT → OAuth2 → Redirects :
`https://olycity.fr/livechat/` (et `http://localhost:4173/livechat/` pour
tester en local).

L'URL du webhook ne doit jamais être ajoutée au dépôt : quiconque la possède
peut poster dans le salon. Sans elle, les envois s'affichent quand même, mais
ne sont pas annoncés sur Discord.
