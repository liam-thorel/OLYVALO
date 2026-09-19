Cette mise à jour prépare le suivi des comptes par identifiant Riot permanent, et apporte les nouveautés accumulées depuis la v4.17.11.

### Changements principaux

- Les parties League of Legends publient désormais l’identifiant Riot permanent du joueur. Un membre qui renomme son compte ne perd plus son historique, ses récaps ni ses courbes de progression.
- Les parties LoL sont suivies dans **tous les modes** — ARAM, Arena, normales — et s’affichent en direct sur le site et dans l’overlay. Les notifications Discord, elles, restent réservées aux files classées.
- Des points de participation sont crédités dans tous les modes : 100 en file non classée LoL, 75 en non classée Valorant, 50 en Deathmatch, ARAM et autres modes fun.
- Les skins équipés des dix joueurs d’une partie Valorant — alliés et adversaires — sont publiés et visibles dans la Live Game.
- Une égalité n’est plus comptée comme une défaite : elle crédite 100 points, et les paris ouverts sont remboursés en étant annoncés comme tels.

### Côté site et bot

- Nouvel onglet **Courbes** : la progression du rang dans le temps, une courbe par compte.
- Nouvel écran d’**attribution des comptes** dans l’admin : propriétaire, rôle principal/smurf, PUUID et région, avec détection des doublons.
- Nouvelles commandes **/synergies** et **/maps** : classement des duos par winrate, et statistiques par map.
- Les récaps distinguent désormais chaque compte d’un même joueur, au lieu de les fondre en une seule ligne.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.
