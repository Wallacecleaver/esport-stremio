# Esport pour Stremio

Addon Stremio partagé entre amis pour regarder l'esport : calendrier des matchs, lives Twitch (FR/EN, sans pub) et rediffusions sans spoiler.
Hébergé sur Vercel (comme l'addon Twitch), avec Upstash pour les profils et les stats.

**Jeux** : League of Legends (branché) · Valorant, Rocket League, Fortnite, Call of Duty (à venir, un par un).

## Ce que voit la personne dans Stremio

| Catalogue | Contenu |
|---|---|
| **Esport · En direct & à venir** | Matchs en cours (🔴), puis les prochains, avec une affiche par match (logos des deux équipes, heure de Paris, enjeu). |
| **⭐ Mon équipe** | Uniquement les matchs de ses équipes favorites (choisies sur `/config`). Les matchs de ses équipes sont aussi marqués ⭐ partout. |
| **<Jeu> <année>** (ex. *League of Legends 2026*) | Une série par jeu et par année : **saison = événement** (Major, Worlds, MSI…, dans l'ordre chronologique), **épisode = match**. Une nouvelle année = un nouveau catalogue ; les années précédentes restent consultables. |

Un clic sur un match ouvre la liste des sources :
- **lives Twitch** des chaînes qui diffusent ou co-streament (officiel + co-streamers FR/EN), les chaînes de la langue préférée d'abord, sans pub via les relais ;
- **rediffusions** : la vidéo Twitch du live, découpée sur la durée du match (un seul flux, sans spoiler). Pour LoL : vidéos officielles lolesports par langue, puis rediffs des chaînes retrouvées à partir de l'heure du match. Les rediffs réservées aux abonnés passent par la lecture directe (méthode TwitchNoSub).

## Installation sur Vercel

1. Importer ce repo dans Vercel (Framework : Other).
2. Variables d'environnement :
   - `ADMIN_PASSWORD` — mot de passe du dashboard `/admin` (obligatoire pour l'activer) ;
   - `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` (ou `KV_REST_API_URL` / `KV_REST_API_TOKEN`) — profils, stats, journal ; sans elles tout est en mémoire et se perd ;
   - `PROXIES` (facultatif) — relais sans pub, une adresse par ligne contenant `{channel}` ;
   - `ADDON_NAME` (facultatif) — nom affiché (modifiable ensuite dans le dashboard).
3. Ouvrir `https://<ton-projet>.vercel.app/config`, créer son profil, installer.

## Pages

- `/config` : choix des jeux, équipes favorites, langue, qualité, scores sur les rediffs. Lien d'installation personnel `/u/<id>/manifest.json` (modifiable ensuite sans réinstaller). Sans Upstash : lien `/c/<pseudo>/<réglages>/manifest.json`.
- `/admin` : vue d'ensemble (demandes, équipes les plus ouvertes, chaînes), utilisateurs et profils, journal (filtre, export CSV), paramètres (jeux activés, ligues LoL, code d'invitation, maintenance), diagnostic des sources.
- `/check` : test rapide des sources (Twitch, calendriers, affiches, base).

## Structure

```
index.js            routeur : manifeste, catalogues, fiches, sources, affiches, lectures, profils
lib/model.js        modèle commun (match, saisons, équipes favorites)
lib/games/          un module par jeu (matches(), replays()) + registre `index.js`
lib/channels.js     chaînes Twitch par jeu
lib/poster.js       affiches PNG (sharp + textes en tracés, police fournie)
lib/replay.js       découpe des rediffs Twitch sur la durée d'un match
lib/twitch.js       lives (relais sans pub), rediffs, TwitchNoSub (repris de l'addon Twitch)
lib/store.js        stats, journal, profils (Upstash, préfixe `es:`)
lib/site.js         réglages du site        lib/admin.js + pages/   dashboard et page de config
```

## Ajouter un jeu

1. Créer `lib/games/<id>.js` qui exporte `matches({ leagues })` → liste de matchs au format de `lib/model.js` (`id`, `game`, `raw`, `year`, `event`, `stage`, `startTime`, `state`, `bestOf`, `teams`) et, si possible, `replays(match)`.
2. Passer `ready: true` pour ce jeu dans `lib/games/index.js`.
3. Renseigner ses chaînes dans `lib/channels.js`.

## Tests

`npm install && npm test` : tests hors-ligne (lolesports, Twitch, relais et Upstash sont simulés).

## Limites connues

- La lecture des lives et des rediffs utilise l'interface interne de Twitch : méthode non officielle, qui peut cesser de fonctionner.
- Twitch supprime les rediffs après un certain temps (7 à 60 jours selon les chaînes) : au-delà, un match terminé n'a plus de rediffusion.
- Les sources de données (lolesports, Twitch) n'ont pas pu être jointes depuis l'environnement de développement : le diagnostic `/admin` → « Diagnostic » dit ce que Vercel atteint vraiment.

## Jeux branchés

| Jeu | Source | Saisons (dans Stremio) | Remarques |
|---|---|---|---|
| League of Legends | lolesports.com (Worlds, MSI, First Stand, LCK…) | un événement = une saison | rediffs officielles Twitch |
| LEC | lolesports.com | un split (Hiver, Printemps, Été) = une saison | catalogue « LEC <année> » à part |
| Valorant | Liquipedia (matchs à venir / en cours / récents) | un événement = une saison | Liquipedia ne garde que peu de matchs terminés : le serveur garde l'historique à partir du moment où il tourne (Upstash obligatoire) |
| Fortnite | Liquipedia (liste des tournois) | un événement = une saison, une journée = un épisode | pas d'« équipe contre équipe » : affiche avec le logo de l'événement, horaires à la journée |

Les chaînes Twitch de chaque jeu (lives et rediffs) se modifient dans le dashboard : **Réglages › Chaînes Twitch par jeu**. Format d'une ligne : `pseudo | nom affiché | FR ou EN | Officiel ou Co-stream`.

⚠️ Les lectures Liquipedia (Valorant, Fortnite) ont été écrites d'après la structure connue des pages mais n'ont pas pu être testées sur les vraies pages : lance **Diagnostic** dans /admin après le déploiement.
