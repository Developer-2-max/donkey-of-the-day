'use strict';
/* Load test: many rooms playing at once, with scripted players.
   Usage:  node scripts/loadtest.js [--rooms 20] [--minutes 2] [--url https://your-server]
   Without --url it starts a throwaway local server. Each room has 5 seats (3 scripted humans + 2 bots) and 2 watchers, in Blitz mode so the
   table keeps moving. Humans play a simple legal-looking strategy, including the shuffle pick, deck cut and deal of the Lab rules; moves the rules reject still count for round-trip timing.
   "Ping" is a cheap action round trip every second per player; "move" is a real card move round trip.
   Pass criteria from the plan: p95 round trip under 200 ms, no dropped rooms, server CPU under 60%. CPU is shown as seconds of
   CPU used per wall-clock second (0.6 = 60% of one core) and event-loop lag is reported as the honest "is the server keeping up" number. */
const { startServer, player, sleep } = require('./testkit');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOMS = +arg('rooms', 20), MINUTES = +arg('minutes', 2), URL_ = arg('url', null);
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

async function main() {
  const local = !URL_; const srv = local ? await startServer() : { url: URL_.replace(/\/$/, ''), stop: async () => {} };
  const health = async () => (await fetch(srv.url + '/healthz')).json();
  const pings = [], moves = [], accepted = { n: 0, rejected: 0 }; let dropped = 0, stateMsgs = 0;
  const h0 = await health(), t0 = Date.now();
  const rooms = [];
  console.log(`Starting ${ROOMS} rooms against ${srv.url} for ${MINUTES} min...`);
  for (let r = 0; r < ROOMS; r++) {
    const host = player(srv.url); await host.ready;
    const { code } = await host.call('create', { name: 'Host' + r });
    const guests = [], watchers = [];
    for (let i = 0; i < 2; i++) { const g = player(srv.url); await g.ready; await g.call('join', { code, name: `P${r}-${i}` }); guests.push(g); }
    for (let i = 0; i < 2; i++) { const w = player(srv.url); await w.ready; await w.call('join', { code, name: `W${r}-${i}`, watch: true }); watchers.push(w); }
    await host.act('SET_SEATS', { n: 5 }); await host.act('SET_FUN', { k: 'blitz', v: true }); await host.act('SET_FUN', { k: 'powers', v: true }); await host.act('SET_TARGET', { n: 2 }); await host.act('FILL_BOTS', { level: 'easy' });
    const res = await host.act('START'); if (!res.ok) throw new Error('could not start room ' + r + ': ' + res.reason);
    [host, ...guests, ...watchers].forEach(p => p.socket.on('state', () => stateMsgs++));
    [host, ...guests, ...watchers].forEach(p => p.socket.on('disconnect', () => { if (!stopping) dropped++; }));
    rooms.push({ host, humans: [host, ...guests], all: [host, ...guests, ...watchers], code });
  }
  let stopping = false; const end = Date.now() + MINUTES * 60e3;

  async function play(p) {   // one scripted human
    let lastKey = '';
    while (Date.now() < end) {
      await sleep(700 + Math.random() * 600);
      const m = p.state && p.state.match, uid = p.id.uid; if (!m) continue;
      let act = null;
      if (m.phase === 'SEATING_ORDER' && m.draw && m.draw.winner === uid) act = ['SET_SEAT_ORDER', { order: m.lobby }];
      else if (m.phase === 'SHUFFLE' && m.shuf.by === uid) act = ['SHUFFLE_PICK', { mode: 'riffle3', secret: false }];
      else if (m.phase === 'DECK_CUT' && m.shuf.cutter === uid) act = ['DECK_CUT', { kind: 'cut', at: 20, peek: false }];
      else if (m.phase === 'DEALING' && m.seats && m.seats[m.dealer] === uid && m.dealTo >= 0) act = ['DEAL_BATCH', { count: m.quotas[m.dealTo] - m.dealt[m.dealTo] }];
      else if (m.phase === 'TURN' && m.actor === uid && p.hand.length) {
        const led = m.led, suited = led ? p.hand.filter(c => c[0] === led) : [];
        if (!led) act = ['PLAY_CARD', { card: p.hand.includes('S_A') ? 'S_A' : p.hand[0] }];
        else if (suited.length) act = ['PLAY_CARD', { card: suited[0] }];
        else act = ['CUT_CARDS', { cards: p.hand.filter(c => c[0] === p.hand[0][0]).slice(0, 2) }];
      } else if (m.phase === 'HAND_RESULT' || m.phase === 'PAUSED') act = [m.phase === 'PAUSED' ? 'RESUME' : 'READY_NEXT_HAND', {}];
      else if (m.phase === 'MATCH_RESULT' && uid === p.state.hostUid) act = ['REMATCH', {}];
      if (act) { const key = m.phase + m.v + act[0]; if (key === lastKey) continue; lastKey = key;
        const t = Date.now(); const r = await p.act(act[0], act[1]).catch(() => null); if (r) { moves.push(Date.now() - t); r.ok ? accepted.n++ : accepted.rejected++; } }
    }
  }
  async function pinger(p) { while (Date.now() < end) { await sleep(1000 + Math.random() * 200); const t = Date.now(); const r = await p.act('PING', {}).catch(() => null); if (r) pings.push(Date.now() - t); else dropped++; } }
  const chatter = async p => { while (Date.now() < end) { await sleep(8000 + Math.random() * 8000); await p.call('chat', 'cut!').catch(() => {}); } };
  const samples = []; const sampler = (async () => { while (Date.now() < end) { await sleep(5000); const h = await health(); samples.push(h); } })();
  await Promise.all([sampler, ...rooms.flatMap(r => r.humans.flatMap(p => [play(p), pinger(p), chatter(p)]))]);

  stopping = true; const h1 = await health(), secs = (Date.now() - t0) / 1000;
  const live = rooms.filter(r => r.host.socket.connected).length;
  const cpu = (h1.cpuSec - h0.cpuSec) / ((h1.uptime - h0.uptime) || secs);
  const out = {
    rooms: ROOMS, connections: rooms.reduce((n, r) => n + r.all.length, 0), minutes: MINUTES, stateMessagesPerSec: +(stateMsgs / secs).toFixed(1),
    pingMs: { n: pings.length, p50: pct(pings, .5), p95: pct(pings, .95), max: Math.max(0, ...pings) },
    moveMs: { n: moves.length, p50: pct(moves, .5), p95: pct(moves, .95), max: Math.max(0, ...moves), accepted: accepted.n, rejectedByRules: accepted.rejected },
    server: { rssMB: h1.rssMB, cpuCoresUsed: +cpu.toFixed(2), loopLagMaxMs: Math.max(...samples.map(s => s.loopLagMaxMs), 0), roomsAtEnd: h1.rooms },
    droppedConnectionsOrActs: dropped, roomsStillConnected: live
  };
  const pass = out.pingMs.p95 < 200 && out.moveMs.p95 < 200 && dropped === 0 && live === ROOMS && out.server.cpuCoresUsed < 0.6;
  console.log(JSON.stringify(out, null, 2)); console.log(pass ? 'PASS: p95 < 200 ms, nothing dropped, CPU < 60% of a core' : 'DID NOT MEET ALL CRITERIA (see numbers above)');
  rooms.forEach(r => r.all.forEach(p => p.close())); await srv.stop(); process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
