'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('crypto'), http = require('http');
const { verifyIdToken } = require('../lib/google');
const { Accounts } = require('../lib/accounts');
const { Profiles } = require('../lib/profiles');
const S = require('../lib/rules').loadShared();
const { startServer, player } = require('../scripts/testkit');

const CLIENT = 'test-client.apps.googleusercontent.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims = {}, key = privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(Object.assign({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', name: 'Asha Verma', iat: now, exp: now + 3600, nonce: 'N1' }, claims));
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url');
}
const getKeys = async () => [jwk];
const ok = (t, o = {}) => verifyIdToken(t, Object.assign({ clientId: CLIENT, nonce: 'N1', getKeys }, o));
const rejects = (p, code) => assert.rejects(p, e => e.code === code);

test('Google token: a valid token is accepted and gives the account id and name', async () => {
  assert.deepEqual(await ok(token()), { sub: '1234567890', name: 'Asha Verma' });
  assert.equal((await ok(token({ iss: 'accounts.google.com' }))).sub, '1234567890');
});
test('Google token: wrong audience, issuer, expiry, nonce, key or signature are all refused', async () => {
  await rejects(ok(token({ aud: 'someone-else' })), 'BAD_TOKEN');
  await rejects(ok(token({ iss: 'https://evil.example' })), 'BAD_TOKEN');
  await rejects(ok(token({ exp: Math.floor(Date.now() / 1000) - 10 })), 'EXPIRED');
  await rejects(ok(token({ nonce: 'other' })), 'BAD_NONCE');
  await rejects(ok(token(), { nonce: undefined }), 'BAD_NONCE');
  await rejects(ok(token({}, privateKey, 'unknown-kid')), 'BAD_TOKEN');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await rejects(ok(token({}, other)), 'BAD_TOKEN');
  const t = token().split('.'); await rejects(ok(t[0] + '.' + b64({ sub: 'attacker', aud: CLIENT, iss: 'accounts.google.com', exp: 9e9, iat: 1, nonce: 'N1' }) + '.' + t[2]), 'BAD_TOKEN');
  const none = b64({ alg: 'none', kid: 'k1' }) + '.' + t[1] + '.'; await rejects(ok(none), 'BAD_TOKEN');
  await rejects(ok('garbage'), 'BAD_TOKEN');
  await rejects(verifyIdToken(token(), { clientId: '', nonce: 'N1', getKeys }), 'LOGIN_OFF');
});

test('accounts + profiles: sign-in moves progress under the account; sign-out leaves it there; erase removes it', () => {
  const dir = require('os').tmpdir(), a = new Accounts(dir + '/dotd-acc-' + Date.now() + '.json'), p = new Profiles(dir + '/dotd-pr-' + Date.now() + '.json', S);
  p.recordMatch([{ uid: 'u-1', name: 'Asha', handsSafe: 5, donkey: false }], { room: 'AAAAA', at: 1 });
  const r = a.signIn('u-1', 'sub1', 'Asha'); p.merge('u-1', r.to);
  assert.equal(a.keyFor('u-1'), 'g:sub1'); assert.equal(p.get('u-1'), undefined); assert.equal(p.view('g:sub1').matches, 1);
  p.recordMatch([{ uid: a.keyFor('u-1'), name: 'Asha', handsSafe: 1, donkey: true }], { room: 'BBBBB', title: 'Lord Lafda', date: 'd', losses: 5, at: 2 });
  // a second device with its own progress signs in to the same account
  p.recordMatch([{ uid: 'u-2', name: 'Asha', handsSafe: 2, donkey: false }], { room: 'CCCCC', at: 3 });
  const r2 = a.signIn('u-2', 'sub1', 'Asha'); p.merge('u-2', r2.to);
  assert.equal(p.view('g:sub1').matches, 3); assert.equal(p.view('g:sub1').hall.length, 1);
  a.signOut('u-2'); assert.equal(a.keyFor('u-2'), 'u-2'); assert.equal(p.view('u-2').matches, 0);
  assert.deepEqual(a.erase('u-1').sort(), ['g:sub1', 'u-1']); assert.equal(a.who('u-1'), null);
});

test('login over the real server: nonce, verified token, progress follows the account, sign out, delete', async () => {
  const certs = http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.setHeader('cache-control', 'max-age=60'); s.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(r => certs.listen(0, r));
  const srv = await startServer({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CERTS_URL: 'http://127.0.0.1:' + certs.address().port });
  try {
    assert.equal((await (await fetch(srv.url + '/api/config')).json()).googleClientId, CLIENT);
    const a = player(srv.url); await a.ready;
    assert.equal((await a.call('profile')).account, null);
    assert.equal((await a.call('login', { credential: token() })).error, 'BAD_NONCE', 'no nonce issued yet');
    let { nonce } = await a.call('login-nonce');
    assert.equal((await a.call('login', { credential: token({ nonce: 'wrong' }) })).error, 'BAD_NONCE');
    assert.equal((await a.call('login', { credential: token({ nonce }) })).error, 'BAD_NONCE', 'the nonce is single use');
    ({ nonce } = await a.call('login-nonce'));
    assert.equal((await a.call('login', { credential: token({ nonce, aud: 'x' }) })).error, 'BAD_TOKEN');
    ({ nonce } = await a.call('login-nonce'));
    const res = await a.call('login', { credential: token({ nonce }) }); assert.deepEqual(res, { ok: true, name: 'Asha Verma' });
    assert.equal((await a.call('profile')).account.name, 'Asha Verma');
    // another browser signs in to the same Google account and sees the same profile
    const b = player(srv.url); await b.ready; ({ nonce } = await b.call('login-nonce'));
    assert.equal((await b.call('login', { credential: token({ nonce }) })).ok, true);
    assert.equal((await b.call('export-data')).account.name, 'Asha Verma');
    assert.equal((await b.call('logout')).ok, true); assert.equal((await b.call('profile')).account, null);
    assert.equal((await a.call('profile')).account.name, 'Asha Verma', 'the other browser stays signed in');
    assert.equal((await a.call('delete-data')).ok, true);
    const a2 = player(srv.url, a.id); await a2.ready; assert.equal((await a2.call('profile')).account, null);
    a.close(); b.close(); a2.close();
  } finally { await srv.stop(); certs.close(); }
});

test('login stays off without a client id', async () => {
  const srv = await startServer();
  try {
    assert.equal((await (await fetch(srv.url + '/api/config')).json()).googleClientId, null);
    const p = player(srv.url); await p.ready;
    assert.equal((await p.call('login', { credential: 'x' })).error, 'LOGIN_OFF'); assert.equal((await p.call('profile')).loginAvailable, false); p.close();
  } finally { await srv.stop(); }
});
