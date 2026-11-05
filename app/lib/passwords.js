'use strict';
/* Username + password accounts (the basic login form). Passwords are never stored: only a per-user random salt and a scrypt hash.
   A signed-in password account is an ordinary session in lib/accounts.js under the id 'p:<username>', so progress, match history,
   devices and "resume from another device" work exactly as they do for Google sign-in. Failed attempts are counted per username
   (not just per browser), so guessing a password from many browsers is slowed down too. */
const fs = require('fs'), crypto = require('crypto');
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/, MIN_PW = 8, MAX_PW = 72;
const MAX_FAILS = 5, LOCK_MS = 15 * 60e3;
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => e ? rej(e) : res(k)));
const err = code => Object.assign(new Error(code), { code });

class Passwords {
  constructor(file, clock) {
    this.file = file; this.t = null; this.now = clock || Date.now; this.fails = new Map();   // username -> { n, until }
    try { this.users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.users = {}; }
    this.dummy = crypto.randomBytes(16);   // verifying an unknown username costs the same as a real one
  }
  static norm(u) { return String(u == null ? '' : u).trim().toLowerCase(); }
  /* returns { sub, name } or throws an error whose .code is one of BAD_USERNAME, WEAK_PASSWORD, TAKEN */
  async register(username, password) {
    username = String(username == null ? '' : username).trim(); password = String(password == null ? '' : password);
    if (!USERNAME_RE.test(username)) throw err('BAD_USERNAME');
    if (password.length < MIN_PW || password.length > MAX_PW) throw err('WEAK_PASSWORD');
    const key = Passwords.norm(username); if (this.users[key]) throw err('TAKEN');
    const salt = crypto.randomBytes(16), hash = await scrypt(password, salt);
    if (this.users[key]) throw err('TAKEN');   // someone else registered it while we were hashing
    this.users[key] = { name: username, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: this.now() }; this.save();
    return { sub: 'p:' + key, name: username };
  }
  /* returns { sub, name } or throws BAD_CREDENTIALS / LOCKED; the same error for "no such user" and "wrong password" */
  async verify(username, password) {
    const key = Passwords.norm(username); password = String(password == null ? '' : password).slice(0, 256);
    const f = this.fails.get(key); if (f && f.until > this.now()) throw err('LOCKED');
    const u = this.users[key], salt = u ? Buffer.from(u.salt, 'hex') : this.dummy, hash = await scrypt(password, salt);
    if (u && crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) { this.fails.delete(key); return { sub: 'p:' + key, name: u.name }; }
    const n = ((f && !(f.until && f.until <= this.now()) ? f.n : 0) || 0) + 1;   // a finished lock starts the count again
    this.fails.set(key, { n, until: n >= MAX_FAILS ? this.now() + LOCK_MS : 0 });
    throw err('BAD_CREDENTIALS');
  }
  remove(sub) { const key = String(sub).replace(/^p:/, ''); if (this.users[key]) { delete this.users[key]; this.save(); } }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 500); this.t.unref && this.t.unref(); }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.users)); } catch (e) { console.warn('passwords save', e.message); } }
}
module.exports = { Passwords, USERNAME_RE, MIN_PW, MAX_PW, MAX_FAILS, LOCK_MS };
