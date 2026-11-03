'use strict';
/* Google accounts. A browser identity (uid) can be "signed in" to a Google account (sub). While signed in, that browser's
   profile, stats and Hall of Shame live under the account, so they follow the player to any device. We keep only the
   Google account id and display name (no email, no photo). Seats in rooms still use the browser uid. */
const fs = require('fs');
class Accounts {
  constructor(file) {
    this.file = file; this.t = null;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.data = {}; }
    this.data.sessions = this.data.sessions || {}; this.data.accounts = this.data.accounts || {};
  }
  /* the key a browser's progress is stored under */
  keyFor(uid) { const s = this.data.sessions[uid]; return s ? 'g:' + s : uid; }
  who(uid) { const s = this.data.sessions[uid]; return s ? { name: this.data.accounts[s] && this.data.accounts[s].name || 'Google player' } : null; }
  signIn(uid, sub, name) {
    const a = this.data.accounts[sub] = Object.assign(this.data.accounts[sub] || { createdAt: Date.now() }, { name: name || 'Google player', lastLogin: Date.now() });
    this.data.sessions[uid] = sub; this.save(); return { from: uid, to: 'g:' + sub, account: a };
  }
  signOut(uid) { delete this.data.sessions[uid]; this.save(); }
  /* erase an account: returns the keys whose profiles should be deleted */
  erase(uid) {
    const sub = this.data.sessions[uid]; if (!sub) return [uid];
    for (const [u, s] of Object.entries(this.data.sessions)) if (s === sub) delete this.data.sessions[u];
    delete this.data.accounts[sub]; this.save(); return [uid, 'g:' + sub];
  }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 500); this.t.unref && this.t.unref(); }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { console.warn('accounts save', e.message); } }
}
module.exports = { Accounts };
