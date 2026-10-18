'use strict';
// Chaînes Twitch par jeu : celles qui diffusent ou co-streament les matchs.
// L'ordre = ordre d'affichage quand plusieurs sont en direct (les chaînes de la langue préférée passent avant).
// `login` = pseudo Twitch ; `role` : 'Officiel' ou 'Co-stream'. Modifiable depuis le dashboard (réglage « channels », qui remplace cette liste pour un jeu).
module.exports = {
  lol: [
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
  ],
  // LEC : Riot (officiel EN) + OTP (FR) puis les co-streams habituels. À corriger dans le dashboard si besoin.
  lec: [
    { login: 'lec', label: 'LEC', lang: 'EN', role: 'Officiel' },
    { login: 'otplol_', label: 'OTP', lang: 'FR', role: 'Officiel' },
    { login: 'kamet0', label: 'Kameto', lang: 'FR', role: 'Co-stream' },
    { login: 'skyyart', label: 'Skyyart', lang: 'FR', role: 'Co-stream' },
    { login: 'caedrel', label: 'Caedrel', lang: 'EN', role: 'Co-stream' },
    { login: 'imls', label: 'LS', lang: 'EN', role: 'Co-stream' },
    { login: 'jankos', label: 'Jankos', lang: 'EN', role: 'Co-stream' },
  ],
  valorant: [], rocketleague: [], fortnite: [], cod: [],
};
