# Revue du patch VALORANT 13.06

## Vérification du 23 septembre 2026

- Jeu : **13.06**, publié le 22 septembre. [Notes officielles Riot](https://playvalorant.com/fr-fr/news/game-updates/valorant-patch-notes-13-06/).
- Riot n'annonce aucune rotation de cartes ni modification d'équilibrage des agents dans ce patch.
- Rotation conservée : Haven, Abyss, Lotus, Split, Ascent, Sunset, Summit.
- Les compositions ranked, pro et fun restent donc inchangées et sont marquées comme revues pour le patch 13.06.
- Les échantillons ranked restent explicitement sourcés au patch 13.04 ; leur provenance n'est pas réécrite artificiellement.
- Les compositions professionnelles conservent le patch réellement joué, la date, le score et la feuille de match VLR.

## Changements pertinents pour OLYCITY

- Nouveau mode temporaire **Gauntlet: Glitched** : une session réelle de Liam et Rayhan a confirmé le `QueueID` Riot `abilitydraftarena` et la carte technique `AbilityDraft`. Le Live affiche le mode sous son nom public, la carte comme **Arènes Gauntlet**, et les 16 joueurs dans une liste neutre de participants plutôt que dans deux fausses équipes.
- **Retake** quitte la rotation des modes temporaires, mais sa reconnaissance reste conservée pour les anciennes parties et les historiques.
- Le score de performance remplace l'ACS dans plusieurs écrans Riot. OLYCITY ne renomme pas ses anciennes données tant que l'API utilisée ne fournit pas explicitement ce nouveau champ.
- Le nouveau fusil **Warden** ne demande aucun changement : le site ne présente actuellement aucun catalogue d'armes.

Valorant-API n'exposait pas encore ce mode au moment de la revue. La détection repose donc sur la valeur réellement observée dans les sessions OLYCITY et accepte aussi les variantes publiques `Gauntlet`, `Gauntlet Glitched` et `Glitched`.
