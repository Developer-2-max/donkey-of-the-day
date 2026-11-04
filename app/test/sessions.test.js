'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('crypto'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { Accounts, deviceLabel, SESSION_TTL_MS } = require('../lib/accounts');
const { Profiles } = require('../lib/profiles');
const { entriesFor } = require('../lib/history');
const S = require('../lib/rules').loadShared();
const { startServer, player } = require('../scripts/testkit');

const tmp = n => path.join(os.tmpdir(), 'dotd-' + n + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');

test('device sessions: list, label, idle expiry, sign one device out, sign everything out', () => {
  let t = 1e12; const a = new Accounts(tmp('acc'), () => t);
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  assert.equal(deviceLabel(chromeWin), 'Chrome on Windows'); assert.equal(deviceLabel(iphone), 'Safari on iPhone'); assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36'), 'Chrome on Android');
  a.signIn('u-a', 'sub1', 'Asha', chromeWin); t += 1000; a.signIn('u-b', 'sub1', 'Asha', iphone); a.signIn('u-c', 'sub2', 'Other', iphone);
  assert.equal(a.keyFor('u-a'), 'g:sub1'); assert.equal(a.keyFor('u-guest'), 'u-guest');
  assert.deepEqual(a.uidsOf('u-a').sort(), ['u-a', 'u-b']); assert.deepEqual(a.uidsOf('u-guest'), ['u-guest']);
  const devs = a.devices('u-a'); assert.equal(devs.length, 2); assert.equal(devs[0].current, true); assert.equal(devs[0].label, 'Chrome on Windows'); assert.equal(devs[1].label, 'Safari on iPhone'); assert.ok(!JSON.stringify(devs).includes('u-b'), 'device ids are opaque');
  assert.equal(a.signOutDevice('u-a', devs[1].id), 'u-b'); assert.equal(a.keyFor('u-b'), 'u-b'); assert.equal(a.devices('u-a').length, 1);
  assert.equal(a.signOutDevice('u-a', a.devices('u-c')[0].id), null, 'cannot sign out another account’s device');
  a.signIn('u-b', 'sub1', 'Asha', iphone); assert.deepEqual(a.signOutAll('u-a').sort(), ['u-a', 'u-b']); assert.equal(a.keyFor('u-a'), 'u-a'); assert.equal(a.who('u-a'), null); assert.equal(a.keyFor('u-c'), 'g:sub2');
  t += SESSION_TTL_MS - 1000; assert.equal(a.keyFor('u-c'), 'g:sub2', 'still signed in just before the limit');
  a.touch('u-c', iphone); t += SESSION_TTL_MS - 1000; assert.equal(a.keyFor('u-c'), 'g:sub2', 'using it renews it');
  t += SESSION_TTL_MS + 5000; assert.equal(a.keyFor('u-c'), 'u-c', 'idle for 90 days: signed out'); assert.equal(a.devices('u-c').length, 0);
});

const fakeState = () => ({ matchId: 'M1', target: 5, handNo: 14, seats: ['u1', 'u2', 'bot'], names: { u1: 'Asha', u2: 'Ben', bot: 'BotKunal' }, bots: { bot: true }, losses: { u1: 5, u2: 2, bot: 1 }, titleOf: { u1: 'Lord Lafda' }, award: { uid: 'u1', at: 77, date: '2026-11-04' } });
test('match history: one entry per human, bots excluded, stored once, newest first, merged on sign-in', () => {
  const es = entriesFor(fakeState(), 'ABCDE'); assert.equal(es.length, 2);
  const asha = es.find(e => e.uid === 'u1').entry, ben = es.find(e => e.uid === 'u2').entry;
  assert.equal(asha.result, 'donkey'); assert.equal(ben.result, 'safe'); assert.equal(ben.myLosses, 2); assert.equal(asha.title, 'Lord Lafda'); assert.deepEqual(asha.players.map(p => p.donkey), [true, false, false]);
  const p = new Profiles(tmp('hist'), S); p.addHistory('u2', ben); p.addHistory('u2', ben); assert.equal(p.history('u2').length, 1, 'a match is stored once');
  p.addHistory('u2', Object.assign({}, ben, { matchId: 'M2', at: 99 })); assert.equal(p.history('u2')[0].matchId, 'M2');
  p.addHistory('g:x', Object.assign({}, ben, { matchId: 'M0', at: 1 })); p.merge('u2', 'g:x'); assert.deepEqual(p.history('g:x').map(h => h.matchId), ['M2', 'M1', 'M0']); assert.equal(p.view('g:x').historyCount, 3);
  for (let i = 0; i < 130; i++) p.addHistory('cap', Object.assign({}, ben, { matchId: 'C' + i, at: i })); assert.equal(p.history('cap', 500).length, 100, 'history is capped');
});

test('Host.swapUid moves a whole seat to a new id: hand, losses, host role, nothing left behind', () => {
  const h = new S.Host({ code: 'SWAPX', uid: 'u-old', name: 'Asha', local: true, out: () => {} });
  h.handle('u-old', { type: 'FILL_BOTS' }); h.handle('u-old', { type: 'START' }); const st = h.st;
  for (let i = 0; i < 200 && !st.hands; i++) { if (st.phase === 'SEATING_ORDER') S.Engine.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, Date.now()); for (const u of st.seats || []) { const a = S.Engine.botAction(st, u); if (a && S.Engine.apply(st, u, a, Date.now()) === null) break; } S.Engine.tick(h.st, (st.deadline || Date.now()) + 1); }
  const before = JSON.parse(JSON.stringify(h.st.hands && h.st.hands['u-old'] || []));
  h.swapUid('u-old', 'u-new');
  assert.equal(h.uid, 'u-new'); assert.ok(!JSON.stringify({ l: h.lobby, s: h.st, p: h.prog }).includes('u-old'), 'no trace of the old id');
  assert.ok(h.lobby.members['u-new'] && !h.lobby.members['u-old']); assert.equal(h.st.names['u-new'], 'Asha');
  if (h.st.hands) assert.equal(JSON.stringify(h.st.hands['u-new']), JSON.stringify(before), 'the same cards'); assert.ok(S.Engine.checkConservation(h.st) !== false);
  assert.equal(h.roster()[0].uid, 'u-new');
});

/* ---------- two devices over the real server ---------- */
const CLIENT = 'sess-client.apps.googleusercontent.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = nonce => { const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'SUB-ASHA', name: 'Asha Verma', iat: now, exp: now + 3600, nonce }); return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url'); };
const signIn = async p => { const { nonce } = await p.call('login-nonce'); const r = await p.call('login', { credential: token(nonce) }); assert.equal(r.ok, true); };

test('resume from another device: My rooms lists the room, joining its code moves the seat, devices can be signed out', async () => {
  const certs = http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.setHeader('cache-control', 'max-age=60'); s.end(JSON.stringify({ keys: [jwk] })); }); await new Promise(r => certs.listen(0, r));
  const srv = await startServer({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CERTS_URL: 'http://127.0.0.1:' + certs.address().port });
  try {
    const a = player(srv.url); await a.ready; await signIn(a);
    const { code } = await a.call('create', { name: 'Asha' }); await a.act('FILL_BOTS'); assert.equal((await a.act('START')).ok, true);
    assert.deepEqual((await a.call('history')).rows, []);
    const mine = (await a.call('my-rooms')).rows; assert.equal(mine.length, 1); assert.equal(mine[0].code, code); assert.equal(mine[0].phase, 'playing'); assert.equal(mine[0].isHost, true); assert.equal(mine[0].me, 'Asha'); assert.equal(mine[0].others.length, 3);
    // a stranger sees nothing, and cannot take the seat
    const stranger = player(srv.url); await stranger.ready; assert.deepEqual((await stranger.call('my-rooms')).rows, []);
    // device B signs in as the same account while A is still connected: it sees the room but cannot take a live seat
    const b = player(srv.url); await b.ready; await signIn(b);
    assert.equal((await b.call('my-rooms')).rows[0].code, code, 'the account’s rooms follow it to the new device');
    assert.equal((await b.call('devices')).rows.length, 2);
    a.close(); await new Promise(r => setTimeout(r, 300));   // device A goes away
    const r = await b.call('join', { code, name: 'Asha' }); assert.equal(r.ok, true); assert.equal(r.claimed, true, 'the seat moved to this device');
    assert.ok(await b.until(p => p.state && p.state.match && p.state.match.names[b.id.uid] === 'Asha'), 'B is seated as Asha');
    assert.ok(!Object.keys(b.state.match.names).includes(a.id.uid), 'the old device no longer holds the seat'); assert.equal(b.state.hostUid, b.id.uid, 'and the host role came with it');
    assert.equal(Object.keys(b.state.match.names).length, 4);
    // sign-in sessions
    const devs = (await b.call('devices')).rows; assert.equal(devs.length, 2); const other = devs.find(d => !d.current);
    const c = player(srv.url, a.id); await c.ready; let kicked = false; c.socket.on('signed-out', () => kicked = true);   // the old browser comes back online
    const out = await b.call('logout-device', { id: other.id }); assert.equal(out.ok, true); assert.equal(out.rows.length, 1); await new Promise(r => setTimeout(r, 200)); assert.equal(kicked, true, 'the signed-out device is told');
    assert.equal((await c.call('profile')).account, null);
    const all = await b.call('logout-all'); assert.equal(all.signedOut, 1); assert.equal((await b.call('profile')).account, null); assert.deepEqual((await b.call('devices')).rows, []);
    b.close(); c.close(); stranger.close();
  } finally { await srv.stop(); certs.close(); }
});
