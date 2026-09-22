<!-- version: 4.19.0 -->
Cette mise à jour rétablit les paris d'avant-match et achève le passage des comptes LoL à l'identifiant Riot permanent.

### Corrections

- **Les paris d'avant-match sont de retour.** Ils avaient disparu le 2 septembre : la sélection d'agent et la partie ne forment qu'une seule session, et le bot n'examinait son départ qu'une fois — pendant le pick, où le mode publié est `agent-select` et non `competitive`. Il se taisait donc, sans erreur ni trace. Les paris de mi-temps et les cartes de fin de partie, eux, continuaient d'arriver, ce qui rendait la panne difficile à voir.
- La carte de début de partie annonçait « Mode : agent-select ». Elle nomme désormais la file.
- Une partie classée terminée sans résultat depuis le pick était traitée comme du non classé : ni carte, ni award, ni suivi de rang.
- Si une annonce de départ est manquée pendant la sélection — redémarrage du bot, identité pas encore résolue — elle est rattrapée au lancement de la partie au lieu d'être perdue.

### Comptes League of Legends

- Les sessions, clients et profils LoL sont désormais enregistrés sous l'identifiant Riot permanent. Un renommage réécrit au même endroit, au lieu de laisser derrière lui une seconde entrée figée à son état d'avant.
- Le site retenait parfois cette entrée périmée et affichait un rang vieux de plusieurs mois, sans rien qui le signale. Entre deux entrées d'un même compte, c'est désormais la plus récente qui est retenue.
- Le roster LoL rapprochait les profils par le pseudo : un compte renommé perdait son rang, son winrate de saison et son top champions, et sa carte affichait simplement « Non synchronisé ».
- L'historique déjà enregistré reste pris en compte : les parties d'avant ce changement n'ont pas d'identifiant permanent et n'en auront jamais, les exclure amputerait le winrate de la saison.

La mise à jour du script se télécharge automatiquement en arrière-plan. Si une partie est en cours, OLYCITY Live attend sa fin avant de redémarrer.
