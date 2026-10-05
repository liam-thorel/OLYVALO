<!-- version: 4.21.3 -->
### Détection League of Legends et TFT

- Les parties TFT sont distinguées des parties LoL : plus de fausse partie sur la Faille, de champion ou de rang LoL affiché pour TFT.
- La file, le mode et la carte sont lus dans les données du client, avec un repli sur le lobby pour les parties personnalisées et l’entraînement. Les modes inconnus restent identifiés par les données du client, sans être transformés en classé.
- Le suivi par PUUID résiste aux changements de pseudo. Un changement de compte ferme d’abord la session précédente.
- Le signal de connexion LoL est renouvelé toutes les 20 secondes au lieu de 60, pour éviter les faux passages hors ligne.
- Une nouvelle sélection de champions ne conserve plus la partie précédente.

### Site Tracker

- Reconnexion du Live au retour depuis le hub, sans réutiliser une connexion figée.
- Bandeau d’accueil lié au jeu sélectionné et affichage explicite de TFT.
- Accueil recentré sur Valorant et League of Legends, recherche d’agents retirée et raccourcis plus légers sur PC et mobile.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer. Aucune modification du bot ni du code de l’overlay.
