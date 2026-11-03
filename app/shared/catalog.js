/* Built-in music catalog: 30 slots across five moods.
   Each slot streams /audio/music/<id>.mp3 from this server once the file is uploaded to the audio folder
   (see README, "Adding the 30 songs"). Until a file exists, the browser plays the matching synthesized
   track (`synth`) instead, so the room always has sound and the room's choice stays in sync. */
const MOODS = [
  { id: 'chill', label: 'Chill table', note: 'Chai-stall lo-fi, soft sitar' },
  { id: 'masti', label: 'Masti', note: 'Dhol beats, wedding band' },
  { id: 'tension', label: 'Tension', note: 'Drumroll, filmy suspense' },
  { id: 'retro', label: 'Retro', note: '70s Bollywood-style instrumentals' },
  { id: 'devotional', label: 'Devotional-light', note: 'Flute, morning raga' }
];
const CATALOG = (() => {
  const mk = (mood, synth, titles) => titles.map((title, i) => ({ id: mood + '-' + String(i + 1).padStart(2, '0'), title, mood, synth }));
  return [
    ...mk('chill', 'monsoon', ['Chai Stall Lo-fi', 'Soft Sitar Evening', 'Balcony Rain', 'Slow Kulhad', 'Late Train Window', 'Terrace Fairy Lights', 'Lazy Sunday Tabla', 'Warm Blanket Raga']),
    ...mk('masti', 'trot', ['Dhol Dhamaka', 'Baraat Band Bounce', 'Mela Ground Shuffle', 'Gully Cricket Groove', 'Nagin Nacho', 'Bhangra Bhaukaal', 'Auto Rickshaw Rush', 'Shaadi Ka Ladoo']),
    ...mk('tension', 'bazaar', ['Final Two Drumroll', 'Filmy Suspense', 'Thakur Is Coming', 'Last Card Standing', 'Midnight Court', 'Ticking Chai Clock']),
    ...mk('retro', 'chai', ['Seventies Jukebox', 'Cabaret Corner', 'Vinyl Crackle Waltz', 'Black-and-White Romance']),
    ...mk('devotional', 'monsoon', ['Morning Bansuri', 'Temple Bell Dawn', 'Ganga Aarti Hum', 'Sunrise Raga'])
  ];
})();
const catalogTrack = id => CATALOG.find(t => t.id === id) || null;
const DEFAULT_TRACK = 'chill-01';
