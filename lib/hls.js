'use strict';
// Petits outils sur les listes de lecture HLS.

// Retire d'une liste de lecture principale les qualités au-dessus du plafond choisi (cap = 0 : aucune limite).
// Si tout est retiré, on garde la liste d'origine. Les pistes audio seules sont conservées.
function filterMaster(text, cap) {
  if (!cap) return text;
  const lines = text.split(/\r?\n/), out = [];
  let kept = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const res = lines[i].match(/RESOLUTION=\d+x(\d+)/), h = res ? Number(res[1]) : 0;
      const audioOnly = /audio_only/i.test((lines[i + 1] || '') + lines[i]) || !res;
      if (audioOnly || h <= cap) { out.push(lines[i], lines[i + 1]); if (!audioOnly) kept++; }
      i++;
    } else out.push(lines[i]);
  }
  return kept ? out.join('\n') : text;
}

module.exports = { filterMaster };
