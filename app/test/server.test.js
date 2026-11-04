'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { startServer, player, sleep, identity } = require('../scripts/testkit');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.stop(); });

const mkRoom = async (opts = {}) => { const host = player(srv.url); await host.ready; const r = await host.call('create', Object.assign({ name: 'Host' }, opts)); return { host, code: r.code, r }; };

test('serves the page, shared code, audio manifest, privacy pages and PWA files; sends security headers', async () => {
  for (const p of ['/', '/play', '/rules', '/account', '/site.css', '/site.js', '/app.js', '/shared/engine.js', '/shared/catalog.js', '/audio/manifest.json', '/privacy.html', '/terms.html', '/manifest.webmanifest', '/sw.js', '/healthz']) {
    const r = await fetch(srv.url + p); assert.equal(r.status, 200, p);
  }
  assert.match(await (await fetch(srv.url + '/')).text(), /Don’t be the Donkey/, '/ is the landing page');
  assert.match(await (await fetch(srv.url + '/play')).text(), /app\.js/, '/play is the game');
  assert.match(await (await fetch(srv.url + '/rules')).text(), /How to play/);
  const old = await fetch(srv.url + '/?room=abcde', { redirect: 'manual' }); assert.equal(old.status, 302); assert.equal(old.headers.get('location'), '/play?room=ABCDE', 'old invite links still work');
  const r = await fetch(srv.url + '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const man = await (await fetch(srv.url + '/audio/manifest.json')).json(); assert.deepEqual(Object.keys(man).sort(), ['commentary', 'music']);
  assert.equal((await fetch(srv.url + '/audio/../server.js')).status === 200, false);
});

test('Start works as soon as the seats are full: no Ready, no music step', async () => {
  const { host, code } = await mkRoom();
  const g = player(srv.url); await g.ready; assert.equal((await g.call('join', { code, name: 'Guest' })).ok, true);
  assert.equal((await host.act('START')).reason, 'SEATS_NOT_FULL');
  assert.equal((await host.act('FILL_BOTS')).ok, true);
  await host.until(p => p.state && p.state.lobby.members.length === 4);
  const lobby = host.state.lobby; assert.ok(lobby.members.every(m => !('ready' in m) && !('audio' in m)));
  assert.equal((await host.act('START')).ok, true);
  assert.ok(await g.until(p => p.state && p.state.match), 'guest sees the match start');
  host.close(); g.close();
});

test('each player is sent only their own cards; the public state carries none', async () => {
  const { host, code } = await mkRoom();
  const g = player(srv.url); await g.ready; await g.call('join', { code, name: 'Guest' });
  await host.act('FILL_BOTS'); await host.act('START');
  // wait until cards are dealt (bot dealer deals on its own; human dealer would need to act, so allow either)
  await host.until(p => p.hand.length > 0 || (p.state && p.state.match && p.state.match.phase === 'DEALING'), 8000);
  for (const p of [host, g]) { assert.deepEqual(p.state.hands, {}); const s = JSON.stringify(p.state.match); assert.ok(!/"hands"\s*:/.test(s)); }
  if (host.hand.length && g.hand.length) assert.equal(host.hand.filter(c => g.hand.includes(c)).length, 0, 'no card is in two hands');
  host.close(); g.close();
});

test('seat is held after a disconnect and the full state returns on reconnect', async () => {
  const { host, code } = await mkRoom();
  const id = identity(); let g = player(srv.url, id); await g.ready; await g.call('join', { code, name: 'Guest' });
  await host.act('FILL_BOTS'); await host.act('START'); await g.until(p => p.state && p.state.match);
  g.close(); await sleep(300);
  g = player(srv.url, id); await g.ready;
  assert.equal((await g.call('join', { code, name: 'Guest' })).ok, true);
  assert.ok(await g.until(p => p.state && p.state.match && p.state.match.names[id.uid] === 'Guest'), 'same seat, state replayed');
  host.close(); g.close();
});

test('public rooms: uploads off, profanity masked; private rooms: neither', async () => {
  const pub = await mkRoom({ public: true }), priv = await mkRoom();
  assert.equal(pub.r.public, true); assert.equal(priv.r.public, false);
  await pub.host.until(p => p.state); await priv.host.until(p => p.state);
  assert.equal(pub.host.state.lobby.public, true);
  await pub.host.call('chat', 'this is stupid'); await priv.host.call('chat', 'this is stupid');
  await pub.host.until(p => p.chat.length); await priv.host.until(p => p.chat.length);
  assert.ok(pub.host.chat.at(-1).x.includes('*') && !pub.host.chat.at(-1).x.includes('stupid'));
  assert.equal(priv.host.chat.at(-1).x, 'this is stupid');
  const song = Buffer.alloc(2000, 1), q = (r, id) => new URLSearchParams({ room: r.code, uid: id.id.uid, secret: id.id.secret, title: 't' });
  let res = await fetch(srv.url + '/api/song?' + q(pub, pub.host), { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: song });
  assert.equal(res.status, 403); assert.equal((await res.json()).error, 'UPLOADS_OFF');
  res = await fetch(srv.url + '/api/song?' + q(priv, priv.host), { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: song });
  assert.equal(res.status, 200);
  assert.equal((await pub.host.act('SET_MUSIC', { song: { id: 'a'.repeat(32), title: 'x' } })).reason, 'UPLOADS_OFF');
  assert.equal((await pub.host.act('SET_MUSIC', { track: 'masti-05' })).ok, true);
  assert.equal(pub.host.state.music.track, 'masti-05');
  pub.host.close(); priv.host.close();
});

test('report button writes a moderation record; you cannot report yourself', async () => {
  const { host, code } = await mkRoom({ public: true });
  const g = player(srv.url); await g.ready; await g.call('join', { code, name: 'Guest' });
  await host.call('chat', 'rude message'); await g.until(p => p.chat.length);
  const msg = g.chat.at(-1);
  assert.equal((await host.call('report', { id: msg.id })).error, 'NOT_FOUND');
  assert.equal((await g.call('report', { id: msg.id, reason: 'abuse' })).ok, true);
  await sleep(200);
  const rec = fs.readFileSync(path.join(srv.dir, 'reports.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(rec.msg, 'rude message'); assert.equal(rec.reported, host.id.uid); assert.equal(rec.reporter, g.id.uid); assert.equal(rec.room, code);
  host.close(); g.close();
});

test('rate limits throttle a flooding player but not a normal one', async () => {
  const { host } = await mkRoom();
  let throttled = 0; for (let i = 0; i < 40; i++) { const r = await Promise.race([host.act('SET_BOT_SPEED', { speed: 'real' }), sleep(2000).then(() => ({}))]); if (r.reason === 'STALE_STATE') throttled++; }
  assert.ok(throttled > 0, 'flood is throttled');
  await sleep(1500); assert.equal((await host.act('SET_BOT_SPEED', { speed: 'quick' })).ok, true, 'recovers');
  host.close();
});

test('profile, data export and data deletion', async () => {
  const { host } = await mkRoom();
  let pr = await host.call('profile'); assert.equal(pr.level, 1);
  const ex = await host.call('export-data'); assert.ok(ex.profile && ex.exportedAt);
  assert.equal((await host.call('delete-data')).ok, true);
  const again = player(srv.url, host.id); await again.ready; pr = await again.call('profile'); assert.equal(pr.matches, 0);
  const exp = await again.call('export-data'); assert.equal(exp.profile, null);
  again.close();
});

test('identity secrets are enforced', async () => {
  const id = identity(); const a = player(srv.url, id); await a.ready;
  const bad = player(srv.url, { uid: id.uid, secret: identity().secret });
  await assert.rejects(bad.ready, /BAD_IDENTITY/);
  a.close();
});

test('idle rooms are saved and closed after 30 minutes (shortened here), then reload when someone joins', async () => {
  const s = await startServer({ IDLE_CLOSE_MIN: '0.01', SWEEP_MS: '250' });
  const host = player(s.url); await host.ready; const { code } = await host.call('create', { name: 'Host' });
  await host.act('FILL_BOTS'); host.close();
  let rooms = 1; for (let i = 0; i < 40 && rooms; i++) { await sleep(150); rooms = (await (await fetch(s.url + '/healthz')).json()).rooms; }
  assert.equal(rooms, 0, 'room closed and removed from memory');
  assert.ok(fs.existsSync(path.join(s.dir, 'rooms', code + '.json')), 'room saved to disk');
  const back = player(s.url); await back.ready;
  assert.equal((await back.call('join', { code, name: 'Back' })).ok, true, 'room reloaded on join');
  assert.ok(await back.until(p => p.state && p.state.lobby.members.length === 4));
  assert.equal((await (await fetch(s.url + '/healthz')).json()).rooms, 1);
  back.close(); await s.stop();
});

test('a server restart resumes every room', async () => {
  const s = await startServer(); let s2;
  try {
    const host = player(s.url); await host.ready; const { code } = await host.call('create', { name: 'Host' });
    await host.act('FILL_BOTS'); await host.act('START'); await sleep(900); host.close(); await s.stop();   // stop() kills the process: nothing but the saved file survives
    s2 = await startServer({}, { port: s.port, dir: s.dir });
    assert.equal((await (await fetch(s2.url + '/healthz')).json()).rooms, 1, 'room restored at boot');
    const back = player(s2.url, host.id); await back.ready;
    assert.equal((await back.call('join', { code, name: 'Host' })).ok, true);
    assert.ok(await back.until(p => p.state && p.state.match), 'the match was resumed');
    back.close();
  } finally { await s.stop(); if (s2) await s2.stop(); }
});
/* ---------- Lab 2.6 features over the real server ---------- */
const driveHost = async (p, ms = 70000) => {   // plays the human's compulsory steps; returns the phases seen until the first turn
  const seen = []; const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = p.state && p.state.match; if (m) {
      if (seen[seen.length - 1] !== m.phase) seen.push(m.phase); const me = p.id.uid;
      if (m.phase === 'SEATING_ORDER' && m.draw.winner === me) await p.act('SET_SEAT_ORDER', { order: m.lobby });
      else if (m.phase === 'SHUFFLE' && m.shuf.by === me) await p.act('SHUFFLE_PICK', { mode: 'riffle3', secret: false });
      else if (m.phase === 'DECK_CUT' && m.shuf.cutter === me) await p.act('DECK_CUT', { kind: 'cut', at: 20, peek: true });
      else if (m.phase === 'DEALING' && m.seats[m.dealer] === me && m.dealTo >= 0) await p.act('DEAL_BATCH', { rest: true });
      else if (m.phase === 'TURN') return seen;
    }
    await sleep(120);
  } return seen;
};

test('Lab: shuffle power, deck cut and dealing run through the real server up to the first trick', async () => {
  const { host } = await mkRoom(); await host.act('SET_FUN', { k: 'powers', v: true }); await host.act('FILL_BOTS'); assert.equal((await host.act('START')).ok, true);
  const seen = await driveHost(host);
  assert.ok(seen.includes('SHUFFLE') && seen.includes('DECK_CUT') && seen.includes('DEALING') && seen.at(-1) === 'TURN', seen.join(' > '));
  const m = host.state.match; assert.equal(JSON.stringify(m.opts), JSON.stringify({ shuffle: true, powers: true, blitz: false, bets: true })); assert.ok(m.shuf && m.shuf.actual, 'the shuffle that was used is public');
  assert.equal(host.hand.length, 13); assert.equal(host.state.hands && Object.keys(host.state.hands).length, 0, 'hands are never in the public state');
  host.close();
});

test('Lab: with shuffle power off the deal starts directly, and turns are 90 seconds', async () => {
  const { host } = await mkRoom(); await host.act('SET_FUN', { k: 'shuffle', v: false }); assert.equal((await host.act('SET_FUN', { k: 'blitz', v: true })).reason, 'WRONG_PHASE', 'Blitz no longer exists'); await host.act('FILL_BOTS'); await host.act('START');
  const seen = await driveHost(host); assert.ok(!seen.includes('SHUFFLE') && seen.at(-1) === 'TURN', seen.join(' > '));
  assert.equal(host.state.match.turnMs, 90000); host.close();
});

test('Lab: nicknames and inside jokes are shared, and filtered in public rooms only', async () => {
  const pub = await mkRoom({ public: true }), priv = await mkRoom(); await pub.host.until(p => p.state); await priv.host.until(p => p.state);
  assert.equal((await pub.host.act('SET_NICK', { u: pub.host.id.uid, x: 'stupid king' })).ok, true); assert.equal((await priv.host.act('SET_NICK', { u: priv.host.id.uid, x: 'stupid king' })).ok, true);
  assert.equal((await pub.host.act('ADD_JOKE', { x: '{u} is an idiot' })).ok, true);
  await pub.host.until(p => p.state.lobby.jokes.length === 1); await priv.host.until(p => p.state.lobby.nick[priv.host.id.uid]);
  assert.ok(pub.host.state.lobby.nick[pub.host.id.uid].includes('*') && !pub.host.state.lobby.nick[pub.host.id.uid].includes('stupid'), 'public nickname masked');
  assert.ok(pub.host.state.lobby.jokes[0].x.includes('*')); assert.equal(priv.host.state.lobby.nick[priv.host.id.uid], 'stupid king');
  pub.host.close(); priv.host.close();
});

test('Lab: throws reach the table, only valid ones, at seated players, rate limited', async () => {
  const { host, code } = await mkRoom(); const g = player(srv.url); await g.ready; await g.call('join', { code, name: 'Guest' }); const got = []; g.socket.on('react', m => got.push(m));
  await host.act('FILL_BOTS'); await host.act('START'); await g.until(p => p.state && p.state.match);
  host.socket.emit('react', { k: 'throw', e: '🍅', to: g.id.uid }); host.socket.emit('react', { k: 'throw', e: '💣', to: g.id.uid }); host.socket.emit('react', { k: 'throw', e: '🍅', to: host.id.uid }); host.socket.emit('react', { k: 'throw', e: '🍅', to: 'u-nobody' });
  host.socket.emit('react', { e: '👏' }); host.socket.emit('react', '🔥');
  await sleep(400); const th = got.filter(m => m.k === 'throw'); assert.equal(th.length, 1, 'only the one valid throw'); assert.deepEqual({ by: th[0].by, e: th[0].e, to: th[0].to }, { by: host.id.uid, e: '🍅', to: g.id.uid });
  assert.deepEqual(got.filter(m => !m.k).map(m => m.e).sort(), ['👏', '🔥'], 'plain reactions still work, including the old string form');
  for (let i = 0; i < 8; i++) host.socket.emit('react', { k: 'throw', e: '🥚', to: g.id.uid }); await sleep(300); assert.ok(got.filter(m => m.k === 'throw').length <= 4, 'a flood of throws is cut off');
  host.close(); g.close();
});

test('Lab: table colour and card back unlock by level, and the Hall of Shame is readable by everyone', async () => {
  const p = player(srv.url); await p.ready; await p.call('profile');
  const pr = await p.call('profile'); assert.equal(pr.level, 1); assert.equal(pr.look.theme, 'teal'); assert.ok(pr.challenge.id && pr.challenge.t && pr.challenge.done === false);
  assert.equal((await p.call('set-look', { theme: 'raat' })).ok, false, 'level 5 colour is locked'); assert.equal((await p.call('set-look', { back: 'bogus' })).ok, false);
  const ok = await p.call('set-look', { theme: 'teal', back: 'rani' }); assert.equal(ok.ok, true);
  const hall = await p.call('hall'); assert.ok(Array.isArray(hall.rows)); const api = await (await fetch(srv.url + '/api/hall')).json(); assert.ok(Array.isArray(api.rows));
  p.close();
});
