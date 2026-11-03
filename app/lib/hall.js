'use strict';
/* The Hall of Shame: one shared list of every finished match from every online room (who became Donkey of the Day, with the final scores).
   It is public to all players, so it holds display names only. Internally each entry also keeps a one-way hash of each player's identity,
   which is never sent to a browser, so a player who deletes their data can have their name removed from past entries. */
const fs = require('fs'), crypto = require('crypto');
const MAX = 2000;
const hid = uid => crypto.createHash('sha256').update('hall:' + uid).digest('hex').slice(0, 16);

class Hall {
  constructor(file) { this.file = file; this.t = null; try { this.rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.rows = []; } }
  /* st: finished match state; names: function uid -> display name (a nickname-free name) */
  add(st, code, nameOf) {
    const a = st.award; if (!a) return;
    if (this.rows.some(r => r.code === code && r.at === a.at)) return;   // a match is recorded once
    this.rows.unshift({ at: a.at, date: a.date, tz: a.tz || '', code, name: nameOf(a.uid), title: (st.titleOf || {})[a.uid] || '', target: st.target, hands: st.handNo,
      players: st.seats.map(u => ({ name: nameOf(u), losses: st.losses[u] || 0, bot: !!st.bots[u], donkey: u === a.uid, h: st.bots[u] ? null : hid(u) })), h: hid(a.uid) });
    if (this.rows.length > MAX) this.rows.length = MAX;
    this.save();
  }
  /* what browsers see: no identity hashes */
  list() { return this.rows.map(r => ({ at: r.at, date: r.date, tz: r.tz, code: r.code, name: r.name, title: r.title, target: r.target, hands: r.hands, players: r.players.map(p => ({ name: p.name, losses: p.losses, bot: p.bot, donkey: p.donkey })) })); }
  /* a player erased their data: their name disappears from past entries */
  anonymize(uid) {
    const h = hid(uid); let n = 0;
    for (const r of this.rows) { if (r.h === h) { r.name = 'Deleted player'; n++; } for (const p of r.players) if (p.h === h) { p.name = 'Deleted player'; n++; } }
    if (n) this.save(); return n;
  }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 1500); this.t.unref && this.t.unref(); }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.rows)); } catch (e) { console.warn('hall save', e.message); } }
}
module.exports = { Hall, hid };
