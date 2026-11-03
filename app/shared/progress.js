/* Progress rules shared by the server (which awards XP and challenges) and the browser (which shows them).
   Ported from the Lab: 100 XP per level, one daily challenge, five table colours and five card backs unlocked by level. */
const CHALLENGES = [
  { id: 'nocut', t: 'Escape a hand without cutting even once' }, { id: 'big5', t: 'Give a cut of 5 or more cards' },
  { id: 'first', t: 'Be the first one out in a hand' }, { id: 'threecuts', t: 'Make 3 cuts in one hand' },
  { id: 'bet', t: 'Win a Bet on the Donkey' }, { id: 'lowloss', t: 'Finish a match with 1 loss or fewer' },
  { id: 'survive', t: 'Survive the final two' }, { id: 'magic', t: 'Use a magic card' }
];
const THEMES = [
  { id: 'teal', n: 'Classic Teal', lvl: 1, f: '#0F5563', f2: '#0A4250' }, { id: 'lal', n: 'Shaadi Lal', lvl: 2, f: '#7A1730', f2: '#4E0E1F' },
  { id: 'neela', n: 'Neela Aasmaan', lvl: 3, f: '#1D3B7A', f2: '#12264F' }, { id: 'chai', n: 'Chai Patti', lvl: 4, f: '#2F5A2A', f2: '#1D3B1A' },
  { id: 'raat', n: 'Raat Ki Baazi', lvl: 5, f: '#23201C', f2: '#121110' }
];
const BACKS = [
  { id: 'rani', n: 'Rani stripes', lvl: 1, b: 'repeating-linear-gradient(45deg,#C81D63 0 6px,#9E1550 6px 12px)' },
  { id: 'genda', n: 'Genda checks', lvl: 2, b: 'repeating-conic-gradient(#F2A516 0 25%,#C97E06 0 50%) 0 0/12px 12px' },
  { id: 'mor', n: 'Mor pankh', lvl: 3, b: 'radial-gradient(circle at 50% 50%,#F2C14E 0 12%,#1E7F86 13% 30%,#123F73 31% 46%,transparent 47%) 0 0/16px 16px,#0E2D52' },
  { id: 'bindi', n: 'Bindi dots', lvl: 4, b: 'radial-gradient(circle,#F6E7C1 0 2px,transparent 3px) 0 0/9px 9px,#6D1B3B' },
  { id: 'sona', n: 'Sona foil', lvl: 5, b: 'repeating-linear-gradient(135deg,#D6A33A 0 4px,#F4D58A 4px 8px,#B5832A 8px 12px)' }
];
const XP = { firstOut: 5, donkeyOther: 10, donkeySelf: 5, match: 20, challenge: 30 };
const levelOfXp = xp => Math.floor(xp / 100) + 1;
const hashStr = s => { s = String(s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); };
/* the day boundary is IST by default (the game is played in India); the server passes its own offset in minutes */
const dayKeyAt = (ms, offsetMin) => new Date(ms + (offsetMin == null ? 330 : offsetMin) * 60e3).toISOString().slice(0, 10);
const challengeOfDay = day => CHALLENGES[hashStr(day) % CHALLENGES.length];
