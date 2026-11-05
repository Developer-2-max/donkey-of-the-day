'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Passwords, MAX_FAILS, LOCK_MS } = require('../lib/passwords');
const { startServer, player } = require('../scripts/testkit');

const tmp = n => path.join(os.tmpdir(), 'dotd-' + n + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
const code = p => p.then(() => null, e => e.code);

test('passwords: register, verify, case-insensitive names, nothing readable is stored', async () => {
  const f = tmp('pw'), p = new Passwords(f);
  assert.deepEqual(await p.register('Asha_1', 'correct horse'), { sub: 'p:asha_1', name: 'Asha_1' });
  assert.equal(await code(p.register('asha_1', 'another pass')), 'TAKEN', 'usernames are case-insensitive');
  assert.equal(await code(p.register('ab', 'correct horse')), 'BAD_USERNAME'); assert.equal(await code(p.register('has space', 'correct horse')), 'BAD_USERNAME');
  assert.equal(await code(p.register('Ben', 'short')), 'WEAK_PASSWORD'); assert.equal(await code(p.register('Ben', 'x'.repeat(73))), 'WEAK_PASSWORD');
  assert.equal((await p.verify('ASHA_1', 'correct horse')).name, 'Asha_1');
  assert.equal(await code(p.verify('asha_1', 'wrong pass!')), 'BAD_CREDENTIALS'); assert.equal(await code(p.verify('nobody', 'correct horse')), 'BAD_CREDENTIALS', 'same error for an unknown user');
  p.flush(); assert.ok(!fs.readFileSync(f, 'utf8').includes('correct horse'), 'the password is not stored');
  assert.equal((await new Passwords(f).verify('asha_1', 'correct horse')).sub, 'p:asha_1', 'survives a restart');
  p.remove('p:asha_1'); assert.equal(await code(p.verify('asha_1', 'correct horse')), 'BAD_CREDENTIALS');
});

test('passwords: repeated wrong guesses lock the username for a while, even with the right password', async () => {
  let t = 1e12; const p = new Passwords(tmp('lock'), () => t); await p.register('Asha', 'correct horse');
  for (let i = 0; i < MAX_FAILS; i++) assert.equal(await code(p.verify('asha', 'bad guess ' + i)), 'BAD_CREDENTIALS');
  assert.equal(await code(p.verify('asha', 'correct horse')), 'LOCKED');
  t += LOCK_MS + 1; assert.equal((await p.verify('asha', 'correct horse')).name, 'Asha', 'unlocks after the wait');
});

test('login form over the real server: each person gets their own session and progress, rooms follow the account', async () => {
  const srv = await startServer();
  try {
    const a = player(srv.url); await a.ready; const b = player(srv.url); await b.ready;
    assert.equal((await a.call('profile')).passwordLogin, true);
    assert.equal((await a.call('register', { username: 'asha', password: 'short' })).error, 'WEAK_PASSWORD');
    assert.deepEqual(await a.call('register', { username: 'Asha', password: 'correct horse' }), { ok: true, name: 'Asha' });
    assert.deepEqual((await a.call('profile')).account, { name: 'Asha', kind: 'password' });
    assert.equal((await b.call('profile')).account, null, 'another browser is not signed in as Asha');
    assert.equal((await b.call('register', { username: 'ASHA', password: 'correct horse' })).error, 'TAKEN');
    assert.equal((await b.call('password-login', { username: 'asha', password: 'wrong wrong' })).error, 'BAD_CREDENTIALS');
    assert.equal((await b.call('profile')).account, null, 'a failed login does not sign in');
    assert.equal((await b.call('register', { username: 'Ben', password: 'second person' })).ok, true);
    assert.equal((await b.call('profile')).account.name, 'Ben', 'two people, two sessions at once');
    assert.equal((await a.call('profile')).account.name, 'Asha');
    // a room is seated under the browser id, and shows up for the account on another device
    const { code: room } = await a.call('create', { name: 'Asha' });
    const c = player(srv.url); await c.ready; assert.deepEqual((await c.call('my-rooms')).rows, []);
    assert.equal((await c.call('password-login', { username: 'asha', password: 'correct horse' })).ok, true);
    assert.equal((await c.call('my-rooms')).rows[0].code, room); assert.equal((await a.call('devices')).rows.length, 2);
    assert.equal((await c.call('logout')).ok, true); assert.equal((await c.call('profile')).account, null);
    // deleting the account frees the username and removes the password
    assert.equal((await a.call('delete-data')).ok, true);
    assert.equal((await c.call('password-login', { username: 'asha', password: 'correct horse' })).error, 'BAD_CREDENTIALS');
    assert.equal((await c.call('register', { username: 'asha', password: 'brand new pass' })).ok, true);
    a.close(); b.close(); c.close();
  } finally { await srv.stop(); }
});
