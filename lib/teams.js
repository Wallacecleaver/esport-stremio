'use strict';
// Équipes européennes proposées au choix (VCT EMEA et Game Changers EMEA).
// La liste affichée est reconstruite à partir du calendrier officiel (toutes les équipes vues dans les ligues EMEA) ;
// celle-ci sert de base et de repli quand la source officielle ne répond pas. Modifiable dans le dashboard (Réglages › Équipes).
const VAL = [
  { code: 'FNC', name: 'FNATIC' },
  { code: 'TL', name: 'Team Liquid' },
  { code: 'VIT', name: 'Team Vitality' },
  { code: 'KC', name: 'Karmine Corp' },
  { code: 'TH', name: 'Team Heretics' },
  { code: 'BBL', name: 'BBL Esports' },
  { code: 'FUT', name: 'FUT Esports' },
  { code: 'GX', name: 'GIANTX' },
  { code: 'NAVI', name: 'Natus Vincere' },
  { code: 'M8', name: 'Gentle Mates' },
  { code: 'APK', name: 'Apeks' },
  { code: 'KOI', name: 'Movistar KOI' },
];
// Équipes LEC (repli quand lolesports.com ne répond pas ; la liste réelle est lue dans le calendrier).
const LEC = [
  { code: 'G2', name: 'G2 Esports' },
  { code: 'FNC', name: 'Fnatic' },
  { code: 'KC', name: 'Karmine Corp' },
  { code: 'SK', name: 'SK Gaming' },
  { code: 'TH', name: 'Team Heretics' },
  { code: 'VIT', name: 'Team Vitality' },
  { code: 'GX', name: 'GIANTX' },
  { code: 'MKOI', name: 'Movistar KOI' },
  { code: 'BDS', name: 'Team BDS' },
  { code: 'NAVI', name: 'Natus Vincere' },
];
module.exports = VAL; module.exports.LEC = LEC;
