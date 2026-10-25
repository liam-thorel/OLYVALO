# Extension OLYCITY Livechat

Survole une vidéo : un petit logo rouge apparaît en haut à droite. Un clic
ouvre le panneau d'envoi. Tu choisis le début et la fin de l'extrait en faisant
défiler la vidéo, puis « ⟲ maintenant ». Tu ajoutes une légende, la taille et
le destinataire, et la vidéo s'affiche sur l'écran des membres qui ont
OLYCITY Live.

- **YouTube, clips et rediffusions Twitch/Kick, X, Reddit, TikTok, Instagram,
  Streamable, Vimeo, Dailymotion, Medal** : l'extension envoie le **lien**.
  Chaque OLYCITY Live lit ensuite la vidéo avec yt-dlp (installé tout seul au
  premier lien).
- **Ailleurs**, si la vidéo est un vrai fichier (pas un flux protégé),
  l'extension la télécharge et la dépose sur le serveur du livechat (500 Mo
  au plus). Les PC du groupe ne contactent jamais le site d'origine.
- Un direct ne s'envoie pas : il ne se termine jamais.

## Installation (Chrome, Edge, Brave, Opera)

1. Télécharge `olycity-livechat-extension.zip` depuis la page Live du
   tracker, puis dézippe-le dans un dossier que tu gardes.
2. Ouvre `chrome://extensions` (ou `edge://extensions`).
3. Active le **mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier.
5. Clique sur l'icône de l'extension, puis **Se connecter avec Discord** :
   c'est le même compte que sur le site et le bot.

Pour la mettre à jour : remplace le contenu du dossier par la nouvelle
version, puis clique sur ↻ dans `chrome://extensions`.

## Pour Liam

La fenêtre de l'extension contient en plus **Réactiver le livechat**. Elle
réactive le livechat chez tout le monde, ou chez une seule personne, quand
quelqu'un l'a coupé avec sa touche. La même chose existe sur Discord :
`/livechat-reactiver`. Le serveur refuse tout autre compte.

## Mise en place (une fois)

L'identifiant de l'extension est fixé par la clé publique de `manifest.json` :
`enlemeekfaobchkhfgealebaiabpmdgm`. Sur le portail Discord, application
OLYBOT → OAuth2 → Redirects, ajoute :

```
https://enlemeekfaobchkhfgealebaiabpmdgm.chromiumapp.org/
```

Le Worker `workers/livechat` accepte cette origine. Il doit être déployé
(`npx wrangler deploy` dans `workers/livechat`) pour accepter les liens.
