<!-- version: 4.24.1 -->
### Correctif : les nouveaux membres apparaissent bien sur le site

- Une personne ajoutée depuis OLYCITY Live (« nouvelle personne ») pouvait ne jamais apparaître sur le site si Firebase était injoignable au moment du choix. Le script annonçait un nouvel essai au démarrage suivant, mais ne le faisait pas. C'est maintenant vérifié à chaque démarrage, sans jamais écraser une fiche existante (photo, compte Discord relié).
- À la création d'une nouvelle personne, le Live explique comment relier son compte Discord : se connecter sur le tracker, puis demander à Liam.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.

<!-- version: 4.24.0 -->
### Livechat : liens YouTube, extension navigateur et touches à choisir

- **Liens vidéo** : un lien YouTube, un clip Twitch, un tweet, un post Reddit, un TikTok… posté sur #livechat (ou avec `/livechat lien:`) s'affiche maintenant sur les écrans. Ajoute `1:20-1:35` au message pour n'en garder qu'un extrait. Au premier lien, ton PC télécharge **yt-dlp** (18 Mo, une seule fois, depuis sa page GitHub officielle, empreinte vérifiée), puis le met à jour tout seul.
- **Extension navigateur** : au survol d'une vidéo, un logo rouge apparaît en haut à droite. Un clic, tu choisis le début et la fin sur la vidéo, et c'est envoyé. Elle se télécharge sur la page Live du tracker.
- **Couper ou réactiver le livechat d'une touche** : **Ctrl+Maj+F10** par défaut. Une petite confirmation s'affiche en haut à droite.
- **Toutes les touches se choisissent** dans `LIVECHAT.bat` en appuyant simplement dessus : couper/réactiver, et passer la vidéo en cours (Ctrl+Maj+F9 par défaut). Ctrl, Maj, Alt, Win et les boutons 4/5 de la souris marchent aussi.
- Liam peut réactiver le livechat chez quelqu'un qui l'a coupé (`/livechat-reactiver` sur Discord, ou depuis l'extension).

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.

<!-- version: 4.23.4 -->
### Livechat : des extraits de vidéo

- Sur **olycity.fr/livechat**, une vidéo peut maintenant être coupée : on choisit son début et sa fin sur une petite timeline, avec l'aperçu qui boucle sur le passage choisi. Seul cet extrait s'affiche sur les écrans.
- C'est aussi la première mise à jour livrée en direct : les postes en 4.23.3 la reçoivent dans la minute qui suit sa publication.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.
