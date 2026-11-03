'use strict';
/* Verifies a "Sign in with Google" ID token on the server (RS256 signature against Google's published keys,
   issuer, audience = our client id, expiry, and the one-time nonce we issued to this player).
   No third-party library: Node's crypto does the signature check. */
const crypto = require('crypto');
const CERTS_URL = process.env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs';   // overridable so tests can use their own keys
let cache = { at: 0, ttl: 0, keys: null };

async function fetchKeys() {
  if (cache.keys && Date.now() - cache.at < cache.ttl) return cache.keys;
  const r = await fetch(CERTS_URL); if (!r.ok) throw new Error('KEYS_UNAVAILABLE');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || ''), j = await r.json();
  cache = { at: Date.now(), ttl: (m ? +m[1] : 3600) * 1000, keys: j.keys || [] }; return cache.keys;
}
const b64u = s => Buffer.from(s, 'base64url');
const fail = code => { const e = new Error(code); e.code = code; throw e; };

async function verifyIdToken(token, { clientId, nonce, getKeys = fetchKeys, now = Date.now() }) {
  if (!clientId) fail('LOGIN_OFF');
  const parts = String(token || '').split('.'); if (parts.length !== 3 || token.length > 4096) fail('BAD_TOKEN');
  let header, payload; try { header = JSON.parse(b64u(parts[0])); payload = JSON.parse(b64u(parts[1])); } catch (e) { fail('BAD_TOKEN'); }
  if (header.alg !== 'RS256') fail('BAD_TOKEN');
  const jwk = (await getKeys()).find(k => k.kid === header.kid); if (!jwk) fail('BAD_TOKEN');
  let ok = false; try { ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64u(parts[2])); } catch (e) {}
  if (!ok) fail('BAD_TOKEN');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') fail('BAD_TOKEN');
  if (payload.aud !== clientId) fail('BAD_TOKEN');
  if (!(payload.exp * 1000 > now) || payload.iat * 1000 > now + 60e3) fail('EXPIRED');
  if (!nonce || payload.nonce !== nonce) fail('BAD_NONCE');
  if (typeof payload.sub !== 'string' || !payload.sub) fail('BAD_TOKEN');
  return { sub: payload.sub, name: String(payload.name || payload.given_name || '').slice(0, 24) };
}
module.exports = { verifyIdToken };
