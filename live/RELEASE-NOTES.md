<!-- version: 4.21.0 -->
Cette mise à jour affiche le score en direct, corrige les statistiques de la Live Game, et les dodges, remakes et égalités signalés à Discord.

### Score en direct

- Le score de la partie s'affiche désormais en direct sur la page Live (« Nous 8 – 5 Eux »), vu depuis l'équipe du joueur suivi.
- Il était figé à 0-0 : le script le lisait dans une réponse Riot qui ne contient pas d'équipes, et remettait le score à zéro à chaque rafraîchissement. Il vient maintenant de la présence Riot, mise à jour à chaque manche.
- Effet de bord attendu : le pari de mi-temps du bot, qui attend 12 manches jouées, ne pouvait jamais s'ouvrir. Il s'ouvrira désormais.

### Dodges et remakes

- Un **dodge** en sélection d'agents était publié sans sa file : le bot ne pouvait pas savoir que la partie annulée était une classée, et se taisait — alors que la pénalité de RR, elle, était bien appliquée par Riot. Le script publie désormais la vraie file, le RR perdu (lu sous l'identifiant de la sélection d'agents, le seul endroit où il figure) et un marqueur « partie annulée ».
- Un **remake** (un joueur qui ne se connecte pas, partie annulée au premier round) était publié comme une **défaite** : Riot renvoie un rapport complet où personne n'a gagné. Il est maintenant reconnu à son nombre de manches et signalé comme partie annulée.
- Une **égalité** était publiée comme une **défaite** : le rapport Riot ne marque aucune équipe gagnante, et « pas gagné » devenait « perdu ». Les paris étaient donc tranchés comme une défaite. Une partie sans vainqueur est désormais publiée comme une égalité, et les mises sont remboursées. Une reddition à score égal, elle, a bien un vainqueur et reste tranchée normalement.

### Statistiques de l'acte

- La ligne « X% WR · N games » d'un joueur pouvait décrire un **acte passé** tout en étant présentée comme l'acte en cours. L'acte était deviné à partir du dictionnaire renvoyé par Riot, dont les clés sont des identifiants sans ordre garanti : le script prenait la dernière entrée, c'est-à-dire un acte au hasard.
- L'acte de référence est désormais celui que le joueur local est en train de jouer — la seule source fiable, puisqu'il y joue à l'instant même.
- Un joueur qui n'a pas fait de classée cet acte-ci n'affiche plus rien, au lieu des chiffres de l'acte précédent.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.
