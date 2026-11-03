'use strict';
/* Per-player token buckets: each kind of action has a burst size and a refill rate (tokens per second). */
const RULES = {
  act: { cap: 14, rate: 6 },       // card moves and room controls
  chat: { cap: 5, rate: 0.5 },     // one message every 2 s sustained, bursts of 5
  react: { cap: 5, rate: 1 },
  report: { cap: 3, rate: 0.05 },
  join: { cap: 6, rate: 0.2 },     // create / join / export / delete
  upload: { cap: 3, rate: 0.05 },
  throw: { cap: 3, rate: 0.4 },    // thrown tomatoes and chappals
  login: { cap: 12, rate: 0.2 }    // Google sign-in attempts
};
class Buckets {
  constructor(rules = RULES) { this.rules = rules; this.m = new Map(); }
  take(id, kind, now = Date.now()) {
    const r = this.rules[kind]; if (!r) return true;
    const k = id + '|' + kind; let b = this.m.get(k);
    if (!b) { b = { tokens: r.cap, t: now }; this.m.set(k, b); }
    b.tokens = Math.min(r.cap, b.tokens + (now - b.t) / 1000 * r.rate); b.t = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1; return true;
  }
  sweep(now = Date.now()) { for (const [k, b] of this.m) if (now - b.t > 600e3) this.m.delete(k); }
}
module.exports = { Buckets, RULES };
