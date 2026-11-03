/* Ported unchanged from the Lab 2.6 test suite; only the path to the engine differs (the engine now lives in shared/engine.js). */
const E = require('../shared/engine.js');
const res = {}; const clone = o => JSON.parse(JSON.stringify(o));
for (let g = 0; g < 40; g++) {
  const st = E.createMatch({ players: [0,1,2,3].map(i => ({ uid: 'p'+i, name: 'P'+i, bot: true })), now: 1, target: 5, fun: { shuffle: true } });
  let now = 10, steps = 0;
  while (st.phase !== 'MATCH_RESULT' && steps++ < 20000) {
    if (st.phase === 'SHUFFLE' && st.handNo > 1) {
      for (const m of E.SHUF.filter(x => x !== 'marzi')) { for (let rep = 0; rep < 5; rep++) { const c = clone(st); c.lastShuf = null;
        E.apply(c, c.shuf.by, { type: 'SHUFFLE_PICK', payload: { mode: m } }, now); E.apply(c, c.shuf.cutter, { type: 'DECK_CUT', payload: { kind: 'cut', at: 20 + Math.floor(Math.random() * 13) } }, now); E.apply(c, c.seats[c.dealer], { type: 'DEAL_BATCH', payload: { rest: true } }, now);
        const r = res[m] = res[m] || { l: 0, v: 0, n: 0, big: 0 }; c.seats.forEach(u => { const k = {}; c.hands[u].forEach(x => k[x[0]] = (k[x[0]] || 0) + 1); const mx = Math.max(...Object.values(k)); r.l += mx; r.v += 4 - Object.keys(k).length; r.n++; if (mx >= 7) r.big++; }); } }
    }
    if (st.phase === 'SEATING_ORDER') { E.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, now); continue; }
    let acted = false; for (const u of st.seats || []) { const a = E.botAction(st, u); if (a && !E.apply(st, u, a, now)) { acted = true; break; } }
    if (!acted) { now = (st.deadline || now) + 1; E.tick(st, now); } else now += 5;
  }
}
for (const [m, r] of Object.entries(res)) console.log(m.padEnd(10), 'deal', String(E.DEAL_OF[m]).padEnd(4), 'longest', (r.l / r.n).toFixed(1), ' voids', (r.v / r.n).toFixed(2), ' hands with 7+ of a suit', (100 * r.big / r.n).toFixed(0) + '%');
