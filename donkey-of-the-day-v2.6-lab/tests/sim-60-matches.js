const E = require('../tools/engine.js');
let fails = 0, matches = 0, modes = {}, events = {}, events2 = {}, seen = new Set();
for (let g = 0; g < 60; g++) {
  const players = [0,1,2,3,4].slice(0, g % 2 ? 5 : 4).map(i => ({ uid: 'p' + i, name: 'P' + i, bot: true, level: ['easy','medium','hard','pro'][i % 4] }));
  let now = 1e12; const st = E.createMatch({ players, now, tz: 'Asia/Kolkata', target: 3, fun: { shuffle: true, powers: true, blitz: g % 3 === 0, bets: true }, titles: null });
  // powers usable by bots? give humans? simulate: mark p0 human for power use
  st.bots.p0 = false;
  let steps = 0;
  while (!['MATCH_RESULT', 'INCOMPLETE'].includes(st.phase) && steps < 20000) {
    steps++;
    if (st.phase === 'SEATING_ORDER') { E.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, now); }
    let acted = false;
    for (const u of (st.seats || [])) {
      let a = E.botAction(st, u);
      if (u === 'p0') {
        if (st.phase === 'HAND_RESULT') a = { type: 'READY_NEXT_HAND' };
        const pw = (st.powers.p0 || [])[0];
        if (pw && ['TURN'].includes(st.phase) && st.hands.p0.length && Math.random() < .3) { const r = E.apply(st, 'p0', { type: 'USE_POWER', payload: { k: pw, to: st.seats.find(x => x !== 'p0' && st.hands[x].length) } }, now); if (!r) acted = true; }
      }
      if (a && !acted) { const r = E.apply(st, u, a, now); if (!r) { acted = true; if (!E.checkConservation(st)) { fails++; console.log('CONS FAIL', st.phase, a.type); } break; } }
    }
    if (!acted) { now = Math.max(now + 1, (st.deadline || now) + 1); E.tick(st, now); if (!E.checkConservation(st)) { fails++; console.log('CONS FAIL tick', st.phase); } }
    else now += 50;
    (st.events||[]).forEach(e => { if (!seen.has(g+':'+e.id)) { seen.add(g+':'+e.id); events2[e.k] = (events2[e.k]||0)+1; } });
  }
  if (st.phase === 'MATCH_RESULT') matches++; else console.log('stuck', st.phase, steps);
  st.events.forEach(e => events[e.k] = (events[e.k] || 0) + 1);
  const v = E.publicView(st); if (!v.stats) console.log('no stats');
}
console.log('matches', matches, 'fails', fails, JSON.stringify(events2));
// shuffle mode clumpiness check from a sorted deck
const rnd = n => Math.floor(Math.random() * n);
for (const m of E.SHUF) { if (m === 'marzi') continue; let longest = 0, N = 300; for (let t = 0; t < N; t++) { const d = E.doShuffle(m, E.fullDeck(), rnd); let mx = 0; for (let p = 0; p < 4; p++) { const h = d.slice(p * 13, p * 13 + 13), c = {}; h.forEach(x => c[x[0]] = (c[x[0]] || 0) + 1); mx = Math.max(mx, ...Object.values(c)); } longest += mx; } console.log(m.padEnd(10), 'avg longest suit in batch-dealt hands', (longest / N).toFixed(1)); }
