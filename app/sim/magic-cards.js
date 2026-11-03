/* Ported unchanged from the Lab 2.6 test suite; only the path to the engine differs (the engine now lives in shared/engine.js). */
const E = require('../shared/engine.js');
let ok = {}, errs = {};
for (let g = 0; g < 200; g++) {
  const players = [0,1,2,3].map(i => ({ uid: 'p' + i, name: 'P' + i, bot: i > 0 }));
  let now = 1e12 + g; const st = E.createMatch({ players, now, target: 2, fun: { shuffle: false, powers: true, bets: true } });
  let steps = 0;
  while (st.phase !== 'MATCH_RESULT' && steps++ < 5000) {
    if (st.phase === 'SEATING_ORDER') E.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, now);
    if (st.phase === 'TURN' && st.hands.p0.length) { st.powers.p0 = ['peek', 'shield', 'swap', 'reverse']; for (const k of ['peek', 'shield', 'swap', 'reverse']) { const r = E.apply(st, 'p0', { type: 'USE_POWER', payload: { k, to: st.seats.find(x => x !== 'p0' && st.hands[x].length) } }, now); if (r) errs[k + ':' + r] = (errs[k + ':' + r] || 0) + 1; else ok[k] = (ok[k] || 0) + 1; if (!E.checkConservation(st)) console.log('FAIL', k); } }
    let acted = false;
    for (const u of st.seats || []) { let a = E.botAction(st, u); if (u === 'p0') { a = E.botAction(st, 'p1') && null; const L = E.legalFor(st, 'p0'); if (st.phase === 'TURN' && st.trick && E.actorUid(st) === 'p0') a = L.cut ? { type: 'CUT_CARDS', payload: { cards: [st.hands.p0[0]] } } : { type: 'PLAY_CARD', payload: { card: L.play[0] } }; if (st.phase === 'DEALING' && st.seats[st.dealer] === 'p0') a = { type: 'DEAL_BATCH', payload: { count: 1 } }; if (st.phase === 'HAND_RESULT') a = { type: 'READY_NEXT_HAND' }; }
      if (a && !E.apply(st, u, a, now)) { acted = true; break; } }
    if (!acted) { now = Math.max(now + 1, (st.deadline || now) + 1); E.tick(st, now); } else now += 10;
    if (!E.checkConservation(st)) { console.log('FAIL cons', st.phase); break; }
  }
  if (st.phase !== 'MATCH_RESULT') console.log('stuck', st.phase);
  const x = E.privateExtra(st, 'p0');
}
console.log(JSON.stringify(ok), JSON.stringify(errs));
