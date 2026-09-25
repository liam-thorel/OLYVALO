<!-- version: 4.21.0 -->
Cette mise à jour corrige les statistiques affichées dans la Live Game.

### Statistiques de l'acte

- La ligne « X% WR · N games » d'un joueur pouvait décrire un **acte passé** tout en étant présentée comme l'acte en cours. L'acte était deviné à partir du dictionnaire renvoyé par Riot, dont les clés sont des identifiants sans ordre garanti : le script prenait la dernière entrée, c'est-à-dire un acte au hasard.
- L'acte de référence est désormais celui que le joueur local est en train de jouer — la seule source fiable, puisqu'il y joue à l'instant même.
- Un joueur qui n'a pas fait de classée cet acte-ci n'affiche plus rien, au lieu des chiffres de l'acte précédent.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.
