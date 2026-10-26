'use strict';
// Chaînes Twitch qui diffusent ou co-streament les matchs Valorant.
// L'ordre = ordre d'affichage quand plusieurs sont en direct (la langue préférée passe avant).
// `role` : 'Officiel' ou 'Co-stream'. Modifiable depuis le dashboard (Réglages › Chaînes), qui remplace cette liste.
const VAL = [
  { login: 'valorant', label: 'VALORANT', lang: 'EN', role: 'Officiel' },
  { login: 'valorant_emea', label: 'VALORANT EMEA', lang: 'EN', role: 'Officiel' },
  { login: 'valorant_fr', label: 'VALORANT FR', lang: 'FR', role: 'Officiel' },
  { login: 'kamet0', label: 'Kameto', lang: 'FR', role: 'Co-stream' },
  { login: 'gotaga', label: 'Gotaga', lang: 'FR', role: 'Co-stream' },
  { login: 'itachi', label: 'itachi', lang: 'FR', role: 'Co-stream' },
  { login: 'tarik', label: 'tarik', lang: 'EN', role: 'Co-stream' },
];
VAL.forEach(c => { c.game = 'val'; });

// League of Legends (LEC, Worlds, MSI). Co-streamers français et anglophones habituels.
const LOL = [
  { login: 'lec', label: 'LEC', lang: 'EN', role: 'Officiel' },
  { login: 'riotgames', label: 'Riot Games', lang: 'EN', role: 'Officiel' },
  { login: 'otplol_', label: 'OTP', lang: 'FR', role: 'Officiel' },
  { login: 'kamet0', label: 'Kameto', lang: 'FR', role: 'Co-stream' },
  { login: 'skyyart', label: 'Skyyart', lang: 'FR', role: 'Co-stream' },
  { login: 'traytonlol', label: 'Trayton', lang: 'FR', role: 'Co-stream' },
  { login: 'zaboutine', label: 'Zaboutine', lang: 'FR', role: 'Co-stream' },
  { login: 'caedrel', label: 'Caedrel', lang: 'EN', role: 'Co-stream' },
  { login: 'imls', label: 'LS', lang: 'EN', role: 'Co-stream' },
  { login: 'jankos', label: 'Jankos', lang: 'EN', role: 'Co-stream' },
  { login: 'doublelift', label: 'Doublelift', lang: 'EN', role: 'Co-stream' },
];
LOL.forEach(c => { c.game = 'lol'; });
// Fortnite (FNCS, championnat du monde, EWC) : la chaîne officielle ; les co-streamers se trouvent par le titre ou s'ajoutent dans le dashboard.
const FN = [{ login: 'fortnite', label: 'Fortnite', lang: 'EN', role: 'Officiel', game: 'fn' }];
module.exports = [...VAL, ...LOL, ...FN];
module.exports.VAL = VAL; module.exports.LOL = LOL; module.exports.FN = FN;
