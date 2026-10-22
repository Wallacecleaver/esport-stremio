# Valorant Esport — addon Stremio

Matchs Valorant (VCT, VCT EMEA, Game Changers, Champions, Esports World Cup) : lives Twitch et rediffusions FR/EN.
Source des matchs : valorantesports.com. Choix d'équipe : Europe uniquement.

- `/config` : page de configuration (profil, compétitions, équipes, options, vérification, lien d'installation)
- `/admin` : dashboard esport (mot de passe = variable `ADMIN_PASSWORD`)
- Variables Vercel : `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_PASSWORD`
- Test local : `node test/mock.js 7311` puis `VAL_API=http://127.0.0.1:7311/persisted/val TW_GQL=http://127.0.0.1:7311/gql node index.js`

## Stockage
- Upstash configuré → profils et stats dans Upstash.
- Sinon (PC / VPS) → fichier `data/esport.json` (dossier modifiable avec `DATA_DIR`). Sauvegarde à garder pour ne pas perdre les profils.
