'use strict';
/* Writes the recording sheet for the commentary voices: one row per line, with its ID (the file name to record to), who speaks it,
   which tier it belongs to, the on-screen text (with {placeholders}) and a "say this" version for the voice artist.
   A recording can't contain a player's name, so each placeholder has a neutral spoken stand-in; the screen shows the real names while the clip plays.
   Run:  node scripts/commentary-script.js > commentary-recording-sheet.csv
   Then save each take as  <DATA_DIR>/audio/commentary/<id>.mp3  (for example bablu.base.cut.2.mp3). */
const { loadShared } = require('../lib/rules');
const { COMM_LINES } = loadShared();
const SPOKEN = { u: 'yeh khiladi', to: 'doosre khiladi', a: 'pehla khiladi', b: 'doosra khiladi', n: 'kuch', total: 'kai', suit: 'ek rang ke', loss: 'ek aur', title: 'naya naam', item: 'cheez' };
const csv = v => '"' + String(v).replace(/"/g, '""') + '"';
console.log(['id', 'commentator', 'tier', 'event', 'on-screen text', 'say this', 'has placeholders'].join(','));
for (const l of COMM_LINES) {
  const spoken = l.text.replace(/\{(\w+)\}/g, (_, k) => SPOKEN[k] || k);
  console.log([l.id, l.who === 'bablu' ? 'Bablu Bhaiya' : 'Commentator Chacha', l.tier, l.kind, l.text, spoken, /\{/.test(l.text) ? 'yes' : 'no'].map(csv).join(','));
}
console.error(COMM_LINES.length + ' lines written. Get signed consent from every voice artist before recording.');
