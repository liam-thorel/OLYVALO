# Livechat OLYCITY

Worker qui reçoit les envois de la page `olycity.fr/livechat` (dépôt
`olycity-hub`). Le fichier est posté dans le salon `#livechat` via un webhook
Discord, puis l'élément est écrit dans `livechat/queue` : chaque OLYCITY Live
l'affiche alors par-dessus l'écran.

Discord sert d'hébergement : pas de stockage à payer, et l'historique du site
reste dans le même salon que les envois faits depuis Discord. Le bot ignore
les messages de webhook pour ne pas afficher deux fois le même envoi.

## Déploiement

1. Dans Discord, salon `#livechat` → Modifier le salon → Intégrations →
   Webhooks → Nouveau webhook → Copier l'URL.
2. `wrangler secret put DISCORD_WEBHOOK_URL` puis coller l'URL.
3. `wrangler deploy`.
4. Reporter l'URL obtenue (`https://olycity-livechat.<compte>.workers.dev`)
   dans `LIVECHAT_ENDPOINT`, en tête du script de `olycity-hub/livechat/index.html`.

Si le serveur Discord est boosté, monter `MAX_UPLOAD_MB` dans `wrangler.toml`
(50 au niveau 2, 100 au niveau 3).

L'URL du webhook ne doit jamais être ajoutée au dépôt : quiconque la possède
peut poster dans le salon.
