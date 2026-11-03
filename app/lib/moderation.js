'use strict';
/* Word filter for public rooms (chat and nicknames). It masks whole words, so the message still reads naturally.
   The built-in list is deliberately small and mild (common insults only). Add your own words with the BANNED_WORDS
   environment variable (comma-separated). Private rooms are not filtered. */
const BASE = ['stupid', 'idiot', 'dumb', 'moron', 'loser', 'jerk', 'crap', 'damn', 'bewakoof', 'pagal', 'nalayak', 'ullu'];
// short or common-looking entries must match the whole word; longer ones also match inside a word
const SHORT_EXACT = new Set(['dumb', 'jerk', 'crap', 'damn', 'ullu', 'pagal']);

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const norm = w => w.toLowerCase().replace(/[01345 7@$!]/g, c => LEET[c] || '').replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1').replace(/(.)\1/g, '$1');
function makeFilter(extra = process.env.BANNED_WORDS) {
  const words = [...new Set(BASE.concat(String(extra || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)))].map(norm).filter(Boolean);
  const bad = n => words.some(w => n === w || (!SHORT_EXACT.has(w) && w.length >= 4 && n.includes(w)));
  return {
    isBad: text => String(text || '').split(/\s+/).some(t => t && bad(norm(t))),
    clean: text => String(text || '').split(/(\s+)/).map(t => /\S/.test(t) && bad(norm(t)) ? '*'.repeat(Math.min(t.length, 8)) : t).join('')
  };
}
module.exports = { makeFilter };
