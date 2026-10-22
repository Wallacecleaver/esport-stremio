'use strict';
// Chaînes Twitch qui diffusent ou co-streament les matchs Valorant.
// L'ordre = ordre d'affichage quand plusieurs sont en direct (la langue préférée passe avant).
// `role` : 'Officiel' ou 'Co-stream'. Modifiable depuis le dashboard (Réglages › Chaînes), qui remplace cette liste.
module.exports = [
  { login: 'valorant', label: 'VALORANT', lang: 'EN', role: 'Officiel' },
  { login: 'valorant_emea', label: 'VALORANT EMEA', lang: 'EN', role: 'Officiel' },
  { login: 'valorant_fr', label: 'VALORANT FR', lang: 'FR', role: 'Officiel' },
  { login: 'kamet0', label: 'Kameto', lang: 'FR', role: 'Co-stream' },
  { login: 'gotaga', label: 'Gotaga', lang: 'FR', role: 'Co-stream' },
  { login: 'itachi', label: 'itachi', lang: 'FR', role: 'Co-stream' },
  { login: 'tarik', label: 'tarik', lang: 'EN', role: 'Co-stream' },
];
