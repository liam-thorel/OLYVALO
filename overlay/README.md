# OLYCITY Overlay

Le site OLYCITY par-dessus le jeu : il apparaît au lancement d'une partie, et
se rappelle au raccourci **Ctrl + Shift + F8**.

## ⚠️ Valorant doit être en « Plein écran fenêtré »

C'est la seule condition, et elle n'est pas contournable. Une fenêtre « toujours
au-dessus » ne peut pas s'afficher par-dessus un jeu en **plein écran exclusif** :
Windows donne la surface entière au jeu et rien ne passe par-dessus.

Dans Valorant : *Paramètres → Vidéo → Général → Mode d'affichage → **Plein écran
fenêtré***. La différence de performance est négligeable sur Windows 10 et 11.

Si l'overlay ne s'affiche jamais alors que l'icône est bien dans la zone de
notification, c'est presque toujours ça.

## Installation

Télécharger `OLYCITY-Overlay-Setup.exe` depuis la page Live du site ou depuis
les releases GitHub, et le lancer. L'installation se fait en un clic, sans
question, et l'application démarre à la fin.

Windows affichera probablement « Windows a protégé votre ordinateur » : le
programme n'est pas signé (un certificat coûte plusieurs centaines d'euros par
an). *Informations complémentaires* → *Exécuter quand même*.

> Un installeur plutôt qu'un exécutable autonome, parce que la mise à jour
> automatique ne fonctionne pas avec le format portable : celui-ci se
> décompresse dans un dossier temporaire à chaque lancement, il n'y a donc rien
> de stable à remplacer.

Au premier lancement, la fenêtre s'ouvre d'elle-même et l'application se règle
pour démarrer avec Windows. Les fois suivantes elle démarre **masquée**, dans la
zone de notification — sur Windows 11 son icône atterrit souvent dans le
débordement, derrière la flèche `^` près de l'horloge. Un clic droit dessus
donne accès aux réglages.

## Mises à jour

Automatiques. L'application vérifie quatre fois par jour, **jamais pendant une
partie** — télécharger 90 Mo au milieu d'une game serait le pire moment, et
l'installation devrait de toute façon attendre.

La nouvelle version se télécharge en fond et **s'installe à la fermeture de
l'application**, jamais à chaud. Pour l'appliquer tout de suite : clic droit sur
l'icône → *Redémarrer pour installer*, qui n'apparaît que lorsqu'une mise à jour
est prête.

Une mise à jour qui échoue (pas de réseau, GitHub indisponible) est notée dans
le journal et retentée plus tard ; elle n'empêche jamais l'overlay de tourner.

## En cas de problème

Clic droit sur l'icône → **Ouvrir le journal**. Tout ce que fait l'application y
est écrit : démarrage, création de l'icône, raccourci, lancement du jeu. Le
fichier se trouve dans `%APPDATA%\OLYCITY Overlay\overlay.log`.

## Utilisation

| Action | Effet |
|---|---|
| Lancement d'une partie | L'overlay apparaît |
| **Ctrl + Shift + F8** | L'affiche ou le masque |
| Clic sur l'icône | Idem |
| Fermeture du jeu | L'overlay disparaît |
| Barre du haut | Déplacer la fenêtre, régler l'opacité, masquer |

L'overlay affiche **le site lui-même** (tracker.olycity.fr), dans sa mise en
page étroite. L'ancienne vue compacte, qui ne montrait que la partie en cours,
a été retirée : elle doublonnait la page Live du site. `overlay.html` reste
publié, mais ne fait plus que rediriger vers le site, pour les overlays
installés avant la 1.2.4.

Une fenêtre fermée à la main ne revient pas toute seule : elle attend la partie
suivante. Un choix explicite n'est jamais écrasé par l'automatisme.

## La barre des tâches réapparaît par-dessus le jeu

C'est Windows, pas l'overlay. Dès qu'une fenêtre prend le **focus**, le shell
constate que la fenêtre au premier plan n'est plus le jeu en plein écran, et
réaffiche la barre des tâches.

L'affichage **automatique** au lancement d'une partie n'active donc jamais la
fenêtre : elle surgit sans voler le focus au jeu, et la barre reste masquée.
C'est aussi préférable en pleine game — personne ne veut perdre le contrôle de
sa souris au moment où la partie démarre.

En revanche, afficher l'overlay au **raccourci** l'active, puisque c'est qu'on
veut s'en servir. Pour consulter sans que la barre revienne : clic droit sur
l'icône → **Ne jamais prendre le focus**. La fenêtre reste alors passive ;
cliquer dedans lui rend le focus, et la barre avec.

## Ce que cette application ne fait pas

Aucune injection dans le processus du jeu, aucun hook clavier bas niveau,
aucune lecture de la mémoire du jeu. C'est une fenêtre Windows ordinaire posée
au-dessus, et le raccourci passe par `RegisterHotKey`, une API publique.

**Rien ici n'entre en contact avec Vanguard.** C'est aussi pourquoi le plein
écran exclusif est un obstacle infranchissable : le contourner demanderait
précisément le genre d'injection qu'on refuse de faire.

La navigation est enfermée dans le site OLYCITY. Tout lien qui en sort s'ouvre
dans le navigateur par défaut, et seulement s'il est en http(s) — une fenêtre
qui flotte au-dessus du jeu et démarre avec Windows n'a pas à devenir un
navigateur généraliste.

## Développement

```bash
cd overlay
npm install
npm start          # lance l'overlay
npm run build      # produit dist/OLYCITY-Overlay.exe (Windows uniquement)
```

L'exécutable publié est construit par `.github/workflows/release-overlay.yml`
sur un runner `windows-latest`. **Rien à lancer à la main** : quand la version
de `package.json` change sur `main`, `.github/workflows/auto-release.yml` le
construit et le joint à la dernière release, et les overlays installés le
récupèrent. Il a son propre cycle : publier l'overlay ne crée pas de version du
script, donc ne pousse pas de mise à jour sur tous les postes.

Le déclenchement manuel reste possible (Actions → « Package de l'overlay ») :
il compile la branche courante et joint l'exécutable à la release choisie.

La logique testable — détection du jeu, règles d'affichage, validation des
réglages, politique de navigation — vit dans `lib/` et est couverte par
`tests/overlay-logic.test.cjs`. Le reste (fenêtre, raccourci, zone de
notification) ne peut être vérifié que sur une machine Windows.
