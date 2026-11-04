'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadShared } = require('../lib/rules');
const S = loadShared(), Engine = S.Engine;
const { makeFilter } = require('../lib/moderation');
const { Buckets } = require('../lib/ratelimit');
const { Profiles } = require('../lib/profiles');
const { Hall } = require('../lib/hall');

test('catalog has 30 tracks in the planned mood mix, each mapped to a synth fallback', () => {
  const counts = {}; S.CATALOG.forEach(t => counts[t.mood] = (counts[t.mood] || 0) + 1);
  assert.equal(S.CATALOG.length, 30);
  assert.deepEqual(counts, { chill: 8, masti: 8, tension: 6, retro: 4, devotional: 4 });
  assert.equal(new Set(S.CATALOG.map(t => t.id)).size, 30);
  S.CATALOG.forEach(t => assert.ok(S.TRACKS.some(s => s.id === t.synth), t.id + ' has a synth fallback'));
});

test('Lab commentary bank: unique stable ids, both commentators in both tiers, only known placeholders', () => {
  const L = S.COMM_LINES; assert.equal(new Set(L.map(l => l.id)).size, L.length);
  for (const who of ['bablu', 'chacha']) for (const tier of ['base', 'spicy']) assert.ok(L.some(l => l.who === who && l.tier === tier), who + '/' + tier);
  for (const kind of ['hand', 'cut', 'bigcut', 'clean', 'out', 'showdown', 'donkey', 'danger', 'auto', 'crown', 'award', 'throw']) assert.ok(L.some(l => l.kind === kind && l.tier === 'base'), kind);
  const known = new Set(['u', 'to', 'a', 'b', 'n', 'total', 'suit', 'loss', 'title', 'item']);
  L.forEach(l => (l.text.match(/\{(\w+)\}/g) || []).forEach(p => assert.ok(known.has(p.slice(1, -1)), l.id + ' uses ' + p)));
  assert.ok(L.length >= 80, 'the Lab bank has ' + L.length + ' lines');
});

test('word filter masks mild insults in English and Hinglish, leaves normal chat and the word gadha alone', () => {
  const f = makeFilter();
  assert.equal(f.clean('what a great cut'), 'what a great cut');
  assert.ok(f.clean('you are a s.t.u.p.i.d person').includes('*') && f.isBad('stuuupid'));
  assert.ok(f.isBad('bewakoof')); assert.equal(f.clean('bhai cut maar'), 'bhai cut maar');
  assert.ok(f.isBad('1d1ot') && f.isBad('LOSER'));
  assert.ok(!f.isBad('Scunthorpe classic') && !f.isBad('dumbbell') && !f.isBad('hello gadha') && !f.isBad('Donkey of the Day'));
  assert.ok(makeFilter('zzzword').isBad('zzzword'));
});

test('rate limiter allows a burst, then throttles, then refills', () => {
  const b = new Buckets({ x: { cap: 3, rate: 1 } });
  assert.ok(b.take('a', 'x', 0) && b.take('a', 'x', 0) && b.take('a', 'x', 0));
  assert.ok(!b.take('a', 'x', 0));
  assert.ok(b.take('b', 'x', 0), 'other players are independent');
  assert.ok(b.take('a', 'x', 1500));
});

const tmp = n => path.join(os.tmpdir(), 'dotd-' + n + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
test('progress rules: 100 XP per level, the daily challenge rolls over at midnight IST, unlocks follow levels', () => {
  assert.equal(S.levelOfXp(0), 1); assert.equal(S.levelOfXp(99), 1); assert.equal(S.levelOfXp(100), 2); assert.equal(S.levelOfXp(450), 5);
  assert.equal(S.dayKeyAt(Date.UTC(2026, 10, 3, 18, 29), 330), '2026-11-03'); assert.equal(S.dayKeyAt(Date.UTC(2026, 10, 3, 18, 31), 330), '2026-11-04');
  assert.equal(S.challengeOfDay('2026-11-03').id, S.challengeOfDay('2026-11-03').id);
  assert.equal(S.THEMES.length, 5); assert.equal(S.BACKS.length, 5); assert.equal(S.CHALLENGES.length, 8);
});

test('profiles: XP and level-ups, daily challenge once a day with streak, locked looks, stats and Hall entries, merge and erase', () => {
  const p = new Profiles(tmp('prof'), S, 330), now = Date.UTC(2026, 11, 1, 6, 0), c = S.challengeOfDay(p.day(now));
  assert.equal(p.addXp('a', 60), null); const up = p.addXp('a', 50); assert.equal(up.level, 2); assert.ok(up.unlocked.includes('Shaadi Lal'));
  assert.equal(p.completeChallenge('a', 'bogus', now), null, 'only the challenge of the day counts');
  const r = p.completeChallenge('a', c.id, now); assert.equal(r.xp, 30); assert.equal(r.streak, 1);
  assert.equal(p.completeChallenge('a', c.id, now), null, 'once a day');
  const next = S.challengeOfDay(p.day(now + 864e5)); assert.equal(p.completeChallenge('a', next.id, now + 864e5).streak, 2, 'consecutive day');
  assert.equal(p.setLook('a', 'lal', 'genda'), true); assert.equal(p.setLook('a', 'raat', null), false, 'level 5 colour is locked at level 2'); assert.equal(p.view('a').look.theme, 'lal');
  p.recordMatch([{ uid: 'a', name: 'Asha', handsSafe: 6, donkey: false }, { uid: 'b', name: 'Ben', handsSafe: 3, donkey: true }], { room: 'ABCDE', title: 'Lord Lafda', date: '2026-11-03', losses: 5, at: 1 });
  assert.equal(p.view('a').series.won, 1); assert.equal(p.view('b').hall[0].title, 'Lord Lafda');
  p.merge('b', 'a'); assert.equal(p.get('b'), undefined); assert.equal(p.view('a').hall.length, 1); assert.equal(p.view('a').series.lost, 1);
  p.remove('a'); assert.equal(p.get('a'), undefined); p.flush();
});

test('Hall of Shame: one entry per match, public list has no identities, erasing a player removes their name', () => {
  const h = new Hall(tmp('hall')), st = { award: { uid: 'u1', at: 5, date: '2026-11-03', tz: 'Asia/Kolkata' }, seats: ['u1', 'u2', 'bot'], bots: { bot: true }, losses: { u1: 5, u2: 2, bot: 1 }, titleOf: { u1: 'Lord Lafda' }, target: 5, handNo: 12 };
  const names = { u1: 'Asha', u2: 'Ben', bot: 'BotKunal' }, nm = u => names[u];
  h.add(st, 'ABCDE', nm); h.add(st, 'ABCDE', nm); assert.equal(h.rows.length, 1, 'recorded once');
  const pub = JSON.stringify(h.list()); assert.ok(!/"h"\s*:/.test(pub) && !pub.includes('u1'), 'no identity hashes or ids are sent to browsers');
  assert.equal(h.list()[0].players.find(p => p.donkey).name, 'Asha'); assert.equal(h.list()[0].title, 'Lord Lafda');
  assert.ok(h.anonymize('u1') >= 2); assert.equal(h.list()[0].name, 'Deleted player'); assert.equal(h.list()[0].players.find(p => p.donkey).name, 'Deleted player'); assert.equal(h.list()[0].players.find(p => p.name === 'Ben').name, 'Ben');
  h.flush();
});

/* drive whole bot-only matches through the engine */
function simulate(players, o = {}) {
  let now = 1e12; const st = Engine.createMatch(Object.assign({ players, now, target: 2 }, o)); let steps = 0;
  while (!['MATCH_RESULT', 'INCOMPLETE'].includes(st.phase) && steps++ < 60000) {
    if (st.phase === 'SEATING_ORDER') Engine.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, now);
    let moved = false;
    for (const u of (st.seats || st.lobby)) { const a = Engine.botAction(st, u); if (a && Engine.apply(st, u, a, now) === null) { moved = true; break; } }
    if (!moved) { if (st.deadline) now = Math.max(now, st.deadline) + 1; Engine.tick(st, now); }
  }
  return st;
}
const bots = n => Array.from({ length: n }, (_, i) => ({ uid: 'b' + i, name: 'Bot' + i, bot: true, level: 'medium' }));
test('four- and five-bot matches finish with a Donkey of the Day, with every Lab fun rule on', () => {
  for (const n of [4, 5]) for (const fun of [undefined, { shuffle: true, powers: true, bets: true }]) {
    const st = simulate(bots(n), { fun });
    assert.equal(st.phase, 'MATCH_RESULT', n + ' players ended in ' + st.phase);
    assert.ok(st.award && st.losses[st.award.uid] >= 2); assert.ok(Engine.checkConservation(st), 'no card lost or duplicated');
  }
});
test('turns are 90 seconds, and Blitz is gone: it cannot be switched on, and old rooms that had it are reset', () => {
  const st = Engine.createMatch({ players: bots(4), now: 0 });
  assert.equal(st.turnMs, 90000); assert.equal(Engine.publicView(st).turnMs, 90000);
  const h = mk(); assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k: 'blitz', v: true } }), 'WRONG_PHASE'); assert.ok(!('blitz' in h.lobby.fun));
  const old = mk(); old.restore({ lobby: Object.assign({}, old.lobby, { fun: Object.assign({}, old.lobby.fun, { blitz: true }), blitz: true }), music: old.music, st: null, seq: 0 });
  assert.ok(!('blitz' in old.lobby.fun)); old.handle('host', { type: 'FILL_BOTS' }); old.handle('host', { type: 'START' }); assert.equal(old.st.turnMs, 90000);
});
test('the engine offers the 11 shuffle modes and 4 magic cards', () => {
  assert.equal(Engine.SHUF.length, 11); assert.deepEqual([...Engine.POWERS], ['peek', 'shield', 'swap', 'reverse']);
});

const mk = (o = {}) => new S.Host(Object.assign({ code: 'TESTX', uid: 'host', name: 'Host', local: true, out: () => {} }, o));
test('Host: Start needs only full seats; no ready or music step', () => {
  const h = mk();
  assert.equal(h.handle('host', { type: 'START', payload: {} }), 'SEATS_NOT_FULL');
  assert.equal(h.handle('host', { type: 'FILL_BOTS', payload: {} }), null);
  assert.equal(h.handle('host', { type: 'START', payload: {} }), null, 'start works with no ready and no music chosen'); assert.ok(h.st);
  assert.deepEqual(Object.keys(h.roster()[0]).sort(), ['bot', 'joinedAt', 'name', 'uid']);
});
test('Host: Lab fun rules are host-only, lobby-only and validated; they reach the match', () => {
  const h = mk(); assert.equal(h.lobby.fun.shuffle, true); assert.equal(h.lobby.fun.bets, true); assert.equal(h.lobby.fun.powers, false);
  assert.equal(h.handle('guest', { type: 'SET_FUN', payload: { k: 'powers', v: true } }), 'NOT_HOST');
  assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k: 'nonsense', v: true } }), 'WRONG_PHASE');
  assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k: 'spice', v: 'volcano' } }), 'WRONG_PHASE');
  for (const [k, v] of [['powers', true], ['mute', true], ['shuffle', false]]) assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k, v } }), null);
  assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k: 'spice', v: 'teekha' } }), null);
  h.handle('host', { type: 'FILL_BOTS' }); h.handle('host', { type: 'START' });
  assert.equal(JSON.stringify(h.st.opts), JSON.stringify({ shuffle: false, powers: true, blitz: false, bets: true })); assert.equal(h.st.turnMs, 90000);
  assert.equal(h.handle('host', { type: 'SET_FUN', payload: { k: 'bets', v: false } }), 'NOT_HOST', 'locked once the match starts');
});
test('Host: nicknames and inside jokes', () => {
  const h = mk();
  assert.equal(h.handle('host', { type: 'SET_NICK', payload: { u: 'host', x: '  Pappu   Pehelwan  ' } }), null); assert.equal(h.lobby.nick.host, 'Pappu Pehelwan');
  assert.equal(h.handle('stranger', { type: 'SET_NICK', payload: { u: 'host', x: 'x' } }), 'NOT_IN_MATCH');
  assert.equal(h.handle('host', { type: 'SET_NICK', payload: { u: 'nobody', x: 'x' } }), 'WRONG_PHASE');
  assert.equal(h.handle('host', { type: 'SET_NICK', payload: { u: 'host', x: '' } }), null); assert.equal(h.lobby.nick.host, undefined);
  assert.equal(h.handle('host', { type: 'ADD_JOKE', payload: { x: '{u} ki chai thandi ho gayi' } }), null); assert.equal(h.lobby.jokes.length, 1);
  assert.equal(h.handle('host', { type: 'ADD_JOKE', payload: { x: '   ' } }), 'EMPTY_NAME');
  assert.equal(h.handle('host', { type: 'DEL_JOKE', payload: { i: 5 } }), 'WRONG_PHASE'); assert.equal(h.handle('host', { type: 'DEL_JOKE', payload: { i: 0 } }), null); assert.equal(h.lobby.jokes.length, 0);
});
test('Host: music is changeable at any time by seated players, but not by the player with the most losses', () => {
  const h = mk();
  assert.equal(h.handle('host', { type: 'SET_MUSIC', payload: { track: 'masti-03' } }), null);
  assert.equal(h.handle('host', { type: 'SET_MUSIC', payload: { track: 'tension-01' } }), null, 'no 30-second lock');
  assert.equal(h.handle('host', { type: 'SET_MUSIC', payload: { track: 'nope' } }), 'WRONG_PHASE');
  assert.equal(h.handle('stranger', { type: 'SET_MUSIC', payload: { track: 'masti-01' } }), 'WATCHERS_NO_MUSIC');
  h.handle('host', { type: 'FILL_BOTS' }); h.handle('host', { type: 'START' }); h.st.losses[h.uid] = 2;
  assert.equal(h.handle('host', { type: 'SET_MUSIC', payload: { track: 'masti-01' } }), 'LOSER_NO_MUSIC');
});
test('Host: uploaded songs are refused in public rooms', () => {
  assert.equal(mk({ public: true }).handle('host', { type: 'SET_MUSIC', payload: { song: { id: 'a'.repeat(32), title: 'x' } } }), 'UPLOADS_OFF');
});
test('Host: "Mute the Donkey" silences only the last hand’s Donkey, for one hand', () => {
  const h = mk(); h.handle('host', { type: 'SET_FUN', payload: { k: 'mute', v: true } }); h.handle('host', { type: 'FILL_BOTS' }); h.handle('host', { type: 'START' });
  h.st.handNo = 3; h.st.lastResult = { uid: 'host', handNo: 2 };
  assert.equal(h.isMuted('host'), true); assert.equal(h.isMuted(h.roster()[1].uid), false);
  h.st.handNo = 4; assert.equal(h.isMuted('host'), false, 'the next hand they may talk again');
  h.st.handNo = 3; h.lobby.fun.mute = false; assert.equal(h.isMuted('host'), false, 'off unless the host turned it on');
});
test('Host: XP and daily-challenge events follow the Lab rules, never replay old events, and only humans earn', () => {
  const got = []; const h = mk({ onProgress: (u, ev) => got.push([u, ev]) });
  h.handle('host', { type: 'FILL_BOTS' }); h.handle('host', { type: 'START' }); const st = h.st;
  st.seats = st.seats || st.lobby; st.finished = st.finished || st.seats.map(() => false);
  h.progressTick(); assert.equal(got.length, 0, 'the first tick of a match only sets the baseline');
  const bot = st.seats.find(u => st.bots[u]);
  st.events = [{ id: 1, k: 'cut', u: 'host', to: bot, total: 6, h: 1 }, { id: 2, k: 'out', u: 'host', h: 1 }, { id: 3, k: 'out', u: bot, h: 1 }, { id: 4, k: 'donkey', u: bot, h: 1, losses: 1 }];
  st.lastResult = { uid: bot, handNo: 1, bets: { host: bot } };
  h.progressTick(); const flat = got.map(([u, e]) => u + ':' + JSON.stringify(e));
  assert.ok(flat.includes('host:{"challenge":"big5"}')); assert.ok(flat.includes('host:{"challenge":"first"}')); assert.ok(flat.includes('host:{"xp":5}'), 'first out earns 5'); assert.ok(flat.includes('host:{"xp":10}'), 'someone else was the Donkey: 10');
  assert.ok(flat.includes('host:{"challenge":"bet"}')); assert.ok(!flat.some(x => x.startsWith(bot)), 'bots earn nothing');
  const n = got.length; h.progressTick(); assert.equal(got.length, n, 'events are not replayed');
  st.phase = 'MATCH_RESULT'; st.award = { uid: bot, at: 1, date: 'd' }; st.losses = Object.fromEntries(st.seats.map(u => [u, u === 'host' ? 1 : 3])); h.progressTick();
  const end = got.slice(n).map(([u, e]) => u + ':' + JSON.stringify(e)); assert.ok(end.includes('host:{"xp":20}')); assert.ok(end.includes('host:{"challenge":"lowloss"}'));
  const m = got.length; h.progressTick(); assert.equal(got.length, m, 'the match result pays out once');
});

/* a whole match with a human at the table (driven here by the bot logic): XP and challenges are paid out, the match end fires once */
test('Host: a full match with a human awards XP only to the human, and reports the match end once', () => {
  let ends = 0; const got = []; const h = mk({ onMatchEnd: () => ends++, onProgress: (u, e) => got.push([u, e]) });
  h.handle('host', { type: 'SET_TARGET', payload: { n: 2 } }); h.handle('host', { type: 'SET_FUN', payload: { k: 'powers', v: true } }); h.handle('host', { type: 'FILL_BOTS' }); h.handle('host', { type: 'START' });
  const st = h.st; let now = Date.now(), steps = 0;
  while (!['MATCH_RESULT', 'INCOMPLETE'].includes(st.phase) && steps++ < 60000) {
    if (st.phase === 'SEATING_ORDER') Engine.apply(st, st.draw.winner, { type: 'SET_SEAT_ORDER', payload: { order: st.lobby.slice() } }, now);
    let moved = false;
    for (const u of (st.seats || [])) { let a = Engine.botAction(st, u); if (u === 'host' && st.phase === 'HAND_RESULT') a = { type: 'READY_NEXT_HAND' }; if (a && Engine.apply(st, u, a, now) === null) { moved = true; break; } }
    if (!moved) { now = Math.max(now + 1, (st.deadline || now) + 1); Engine.tick(st, now); }
    h.progressTick(); h.matchEnd();
  }
  assert.equal(st.phase, 'MATCH_RESULT'); assert.equal(ends, 1);
  assert.ok(got.length > 0 && got.every(([u]) => u === 'host'), 'only the human is paid');
  assert.ok(got.some(([, e]) => e.xp === 20), 'the match bonus'); assert.ok(got.filter(([, e]) => e.xp === 10 || e.xp === 5).length >= 2, 'a payout for each Donkey hand');
});
