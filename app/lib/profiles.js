'use strict';
/* Per-player progress kept on the server, keyed by the player's identity (a browser, or a Google account once signed in):
   XP and level, daily challenge and streak, table colour and card back, stats, and personal Hall of Shame entries.
   Players can export or delete everything here from their profile. `rules` comes from the shared progress table
   (lib/rules.js), so the server and the pages agree on levels, challenges and unlocks. */
const fs = require('fs');
const HALL_MAX = 50;

class Profiles {
  constructor(file, rules, offsetMin) {
    this.file = file; this.t = null; this.R = rules; this.offsetMin = offsetMin == null ? 330 : offsetMin;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.data = {}; }
  }
  day(now = Date.now()) { return this.R.dayKeyAt(now, this.offsetMin); }
  get(uid) { return this.data[uid]; }
  ensure(uid, name) {
    let p = this.data[uid];
    if (!p) p = this.data[uid] = { name: 'Player', xp: 0, matches: 0, series: { won: 0, lost: 0 }, handsSafe: 0, hall: [], createdAt: Date.now(), lastSeen: Date.now() };
    p.look = p.look || { theme: 'teal', back: 'rani' }; p.chal = p.chal || { done: {}, streak: 0, lastDay: '' };
    if (name) p.name = String(name).slice(0, 24); p.lastSeen = Date.now(); return p;
  }
  touch(uid, name) { this.ensure(uid, name); this.save(); }
  /* players: [{ uid, name, handsSafe, donkey }]; shame: { room, title, date, losses, at } for the series loser. Stats only: XP comes from addXp. */
  recordMatch(players, shame) {
    for (const x of players) {
      const p = this.ensure(x.uid, x.name);
      p.matches++; p.handsSafe += x.handsSafe;
      if (x.donkey) { p.series.lost++; p.hall.unshift({ at: shame.at, room: shame.room, title: shame.title, date: shame.date, losses: shame.losses }); p.hall.length = Math.min(p.hall.length, HALL_MAX); }
      else p.series.won++;
    }
    this.save();
  }
  /* returns { level } when the player just went up a level, else null */
  addXp(uid, n) {
    const p = this.ensure(uid), before = this.R.levelOfXp(p.xp); p.xp += n; this.save();
    const after = this.R.levelOfXp(p.xp); return after > before ? { level: after, unlocked: [...this.R.THEMES, ...this.R.BACKS].filter(x => x.lvl === after).map(x => x.n) } : null;
  }
  /* a challenge counts only if it is today's and not already done today; returns { challenge, xp, streak, levelUp } or null */
  completeChallenge(uid, id, now = Date.now()) {
    const p = this.ensure(uid), day = this.day(now), c = this.R.challengeOfDay(day); if (c.id !== id || p.chal.done[day]) return null;
    const y = this.day(now - 864e5); p.chal.done = { [day]: id }; p.chal.streak = p.chal.lastDay === y ? p.chal.streak + 1 : 1; p.chal.lastDay = day;
    const up = this.addXp(uid, this.R.XP.challenge); this.save();
    return { challenge: c, xp: this.R.XP.challenge, streak: p.chal.streak, levelUp: up };
  }
  setLook(uid, theme, back) {
    const p = this.ensure(uid), lv = this.R.levelOfXp(p.xp); let ok = false;
    if (theme) { const x = this.R.THEMES.find(y => y.id === theme); if (x && x.lvl <= lv) { p.look.theme = theme; ok = true; } }
    if (back) { const x = this.R.BACKS.find(y => y.id === back); if (x && x.lvl <= lv) { p.look.back = back; ok = true; } }
    if (ok) this.save(); return ok;
  }
  /* fold one profile into another (used when a browser signs in to a Google account that already has progress) */
  merge(from, to) {
    const a = this.data[from]; if (!a || from === to) return; const b = this.ensure(to);
    b.xp += a.xp; b.matches += a.matches; b.handsSafe += a.handsSafe; b.series.won += a.series.won; b.series.lost += a.series.lost;
    b.hall = b.hall.concat(a.hall).sort((x, y) => y.at - x.at).slice(0, HALL_MAX); b.createdAt = Math.min(b.createdAt, a.createdAt);
    if ((a.chal && a.chal.streak || 0) > b.chal.streak) b.chal = a.chal;
    delete this.data[from]; this.save();
  }
  view(uid, now = Date.now()) {
    const R = this.R, p = this.data[uid] || { name: null, xp: 0, matches: 0, series: { won: 0, lost: 0 }, handsSafe: 0, hall: [], look: { theme: 'teal', back: 'rani' }, chal: { done: {}, streak: 0, lastDay: '' } };   // looking never creates a profile
    const lv = R.levelOfXp(p.xp), day = this.day(now), c = R.challengeOfDay(day), look = p.look || { theme: 'teal', back: 'rani' }, chal = p.chal || { done: {}, streak: 0 };
    return { name: p.name, xp: p.xp, level: lv, prevLevelXp: (lv - 1) * 100, nextLevelXp: lv * 100, matches: p.matches, series: p.series, handsSafe: p.handsSafe, hall: p.hall,
      look, challenge: { id: c.id, t: c.t, done: chal.done[day] === c.id, streak: chal.streak } };
  }
  remove(uid) { delete this.data[uid]; this.save(); }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 1500); this.t.unref && this.t.unref(); }
  flush() { clearTimeout(this.t); try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { console.warn('profiles save', e.message); } }
}
module.exports = { Profiles };
