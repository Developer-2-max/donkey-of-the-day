'use strict';
/* Google accounts and sign-in sessions.
   A browser identity (uid) can be "signed in" to a Google account (sub). While signed in, that browser's profile, stats,
   match history and Hall of Shame entries live under the account, so they follow the player to any device.
   Every sign-in is a device session: it records when it started, when it was last seen and a short device label, expires
   after 90 days without use, and can be signed out one by one or all at once. We keep only the Google account id and name
   (no email, no photo). Seats in rooms still use the browser uid. */
const fs = require('fs'), crypto = require('crypto');
const SESSION_TTL_MS = 90 * 864e5, TOUCH_EVERY_MS = 3600e3;
const devId = uid => crypto.createHash('sha256').update('dev:' + uid).digest('hex').slice(0, 12);
/* "Chrome on Windows", from the User-Agent header (kept short on purpose) */
function deviceLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux|X11/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return br + ' on ' + os;
}
class Accounts {
  constructor(file, clock) {
    this.file = file; this.t = null; this.now = clock || Date.now;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.data = {}; }
    this.data.sessions = this.data.sessions || {}; this.data.accounts = this.data.accounts || {}; this.data.meta = this.data.meta || {};
  }
  /* the account id for a live session, or null; an idle session past its expiry is removed here */
  live(uid) {
    const s = this.data.sessions[uid]; if (!s) return null;
    const m = this.data.meta[uid], last = (m && m.last) || (this.data.accounts[s] && this.data.accounts[s].lastLogin) || 0;
    if (this.now() - last > SESSION_TTL_MS) { delete this.data.sessions[uid]; delete this.data.meta[uid]; this.save(); return null; }
    return s;
  }
  /* the key a browser's progress is stored under */
  keyFor(uid) { const s = this.live(uid); return s ? 'g:' + s : uid; }
  who(uid) { const s = this.live(uid); return s ? { name: this.data.accounts[s] && this.data.accounts[s].name || 'Google player' } : null; }
  signIn(uid, sub, name, ua) {
    const now = this.now(), a = this.data.accounts[sub] = Object.assign(this.data.accounts[sub] || { createdAt: now }, { name: name || 'Google player', lastLogin: now });
    this.data.sessions[uid] = sub; this.data.meta[uid] = { at: now, last: now, ua: String(ua || '').slice(0, 200) }; this.save(); return { from: uid, to: 'g:' + sub, account: a };
  }
  /* a device connecting counts as being seen, at most once an hour */
  touch(uid, ua) { const s = this.live(uid); if (!s) return; const m = this.data.meta[uid] || (this.data.meta[uid] = { at: this.now(), last: 0, ua: '' }); if (this.now() - m.last > TOUCH_EVERY_MS) { m.last = this.now(); if (ua) m.ua = String(ua).slice(0, 200); this.save(); } }
  /* every browser identity signed in to the same account as this one (always including this one) */
  uidsOf(uid) { const s = this.live(uid); if (!s) return [uid]; const out = Object.keys(this.data.sessions).filter(u => this.data.sessions[u] === s && this.live(u)); return out.includes(uid) ? out : [uid, ...out]; }
  devices(uid) {
    const s = this.live(uid); if (!s) return [];
    return this.uidsOf(uid).map(u => { const m = this.data.meta[u] || {}; return { id: devId(u), label: deviceLabel(m.ua), at: m.at || 0, last: m.last || m.at || 0, current: u === uid }; }).sort((x, y) => (y.current - x.current) || (y.last - x.last));
  }
  /* sign one of this account's devices out; returns that device's uid, or null */
  signOutDevice(uid, id) {
    const target = this.uidsOf(uid).find(u => devId(u) === id); if (!target || !this.data.sessions[target]) return null;
    delete this.data.sessions[target]; delete this.data.meta[target]; this.save(); return target;
  }
  /* sign every device out (the account and its progress stay); returns the uids that were signed in */
  signOutAll(uid) {
    const s = this.live(uid); if (!s) return [];
    const gone = Object.keys(this.data.sessions).filter(u => this.data.sessions[u] === s);
    gone.forEach(u => { delete this.data.sessions[u]; delete this.data.meta[u]; }); this.save(); return gone;
  }
  signOut(uid) { delete this.data.sessions[uid]; delete this.data.meta[uid]; this.save(); }
  /* erase an account: returns the keys whose profiles should be deleted */
  erase(uid) {
    const sub = this.data.sessions[uid]; if (!sub) return [uid];
    for (const [u, s] of Object.entries(this.data.sessions)) if (s === sub) { delete this.data.sessions[u]; delete this.data.meta[u]; }
    delete this.data.accounts[sub]; this.save(); return [uid, 'g:' + sub];
  }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 500); this.t.unref && this.t.unref(); }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { console.warn('accounts save', e.message); } }
}
module.exports = { Accounts, deviceLabel, devId, SESSION_TTL_MS };
