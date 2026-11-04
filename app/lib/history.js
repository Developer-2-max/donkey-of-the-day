'use strict';
/* Match history: one entry per human at the table when a match finishes with a Donkey of the Day. */
function entriesFor(st, code, now = Date.now()) {
  const a = st.award; if (!a) return [];
  const players = st.seats.map(u => ({ name: st.names[u] || 'Player', losses: st.losses[u] || 0, bot: !!st.bots[u], donkey: u === a.uid }));
  const base = { at: a.at || now, matchId: st.matchId, room: code, date: a.date || null, target: st.target, hands: st.handNo, donkey: st.names[a.uid] || 'Player', title: (st.titleOf || {})[a.uid] || null, players };
  return st.seats.filter(u => !st.bots[u]).map(uid => ({ uid, entry: Object.assign({}, base, { result: uid === a.uid ? 'donkey' : 'safe', me: st.names[uid] || 'Player', myLosses: st.losses[uid] || 0 }) }));
}
module.exports = { entriesFor };
