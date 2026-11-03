/* Original synthesized music catalog — generated in the browser, no external audio */
const TRACKS = [
  { id: 'chai', title: 'Chai Stall Shuffle', note: 'Bright and bouncy', bpm: 116, swing: .16,
    chords: [[48,52,55],[53,57,60],[45,48,52],[43,47,50]], bass: '0..0..7.0..0.5.7', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.',
    lead: [0,2,4,7,4,2,0,null,4,7,9,7,4,null,2,null], wave: 'triangle', leadOct: 24 },
  { id: 'monsoon', title: 'Monsoon Lounge', note: 'Slow and mellow', bpm: 82, swing: .1,
    chords: [[57,60,64,67],[50,53,57,60],[55,59,62,65],[48,52,55,59]], bass: '0.....0...7.....', kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    lead: [7,null,null,4,null,null,2,null,0,null,null,null,4,null,2,null], wave: 'sine', leadOct: 24 },
  { id: 'bazaar', title: 'Midnight Bazaar', note: 'Moody, with a drone', bpm: 96, swing: 0,
    chords: [[52,59,64],[53,57,60],[52,59,64],[50,53,57]], bass: '0.0.0..0.0..0.1.', kick: 'x..x..x...x..x..', snare: '....x.......x..x', hat: '.xx..xx..xx..xx.',
    lead: [0,1,4,null,5,4,1,0,null,7,8,7,5,4,1,null], wave: 'sawtooth', leadOct: 12, drone: 40 },
  { id: 'trot', title: 'Donkey Trot', note: 'Fast, a little silly', bpm: 132, swing: .2,
    chords: [[43,47,50],[48,52,55],[50,54,57],[43,47,50]], bass: '0...7...0...7...', kick: 'x.x.x.x.x.x.x.x.', snare: '..x...x...x...x.', hat: 'xxxxxxxxxxxxxxxx',
    lead: [12,null,7,null,12,null,7,null,14,12,11,null,7,null,null,null], wave: 'square', leadOct: 12 }
];
const Music = {
  ctx: null, master: null, vol: .55, muted: false, track: null, t0: 0, step: 0, timer: null, noise: null, state: 'off',
  get(id) { return TRACKS.find(t => t.id === id) || TRACKS[0]; },
  enable() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, len, len); const d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
      }
      this.ctx.resume(); this.applyVol(); this.state = 'on'; return true;
    } catch (e) { this.state = 'failed'; return false; }
  },
  applyVol() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol * .5, this.ctx.currentTime, .05); if (this.el) this.el.volume = this.muted ? 0 : this.vol; },
  el: null,
  ensureEl() { if (!this.el) { this.el = new Audio(); this.el.loop = true; this.el.preload = 'auto'; this.el.onerror = () => { this.songError = true; if (window.App) App.render(); }; } return this.el; },
  unlock() { try { const el = this.ensureEl(); if (!el.src) return; const p = el.play(); if (p) p.catch(() => {}); } catch (e) {} },
  playSong(url, offsetMs) {
    this.stopSynth(); const el = this.ensureEl(); this.songError = false;
    if (el.dataset.u !== url) { el.src = url; el.dataset.u = url; }
    const seek = () => { const d = el.duration; if (d && isFinite(d)) el.currentTime = ((offsetMs / 1000) % d + d) % d;
      const p = el.play(); if (p) p.catch(() => { this.blocked = true; if (window.App) App.render(); }); };
    if (el.readyState >= 1) seek(); else el.onloadedmetadata = seek;
    this.applyVol();
  },
  /* play `id`, already `offsetMs` into the room's playback */
  play(id, offsetMs) {
    if (this.el) this.el.pause();
    if (!this.ctx || this.ctx.state === 'closed') return;
    const tr = this.get(id); const sd = 60 / tr.bpm / 4; const loop = 64 * sd;
    const off = ((offsetMs / 1000) % loop + loop) % loop;
    this.track = tr; this.t0 = this.ctx.currentTime - off; this.step = Math.ceil(off / sd);
    clearInterval(this.timer); this.timer = setInterval(() => this.pump(), 25);
  },
  stopSynth() { clearInterval(this.timer); this.timer = null; this.track = null; },
  stop() { this.stopSynth(); if (this.el) this.el.pause(); },
  pump() {
    const tr = this.track; if (!tr || !this.ctx) return;
    const sd = 60 / tr.bpm / 4;
    while (this.t0 + this.step * sd < this.ctx.currentTime + .12) {
      let t = this.t0 + this.step * sd; if (this.step % 2) t += tr.swing * sd;
      if (t >= this.ctx.currentTime - .01) this.sched(tr, this.step % 64, t, sd);
      this.step++;
    }
  },
  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); },
  osc(type, f, t, dur, peak, a = .005, filt) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    let node = o; if (filt) { const bq = c.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = filt; o.connect(bq); node = bq; }
    node.connect(g); g.connect(this.master); this.env(g, t, a, peak, dur); o.start(t); o.stop(t + a + dur + .05);
  },
  hit(t, hp, peak, dur) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = hp ? 'highpass' : 'bandpass'; f.frequency.value = hp ? 7000 : 1800;
    s.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, .002, peak, dur); s.start(t); s.stop(t + dur + .05);
  },
  kick(t) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .14);
    o.connect(g); g.connect(this.master); this.env(g, t, .003, .9, .22); o.start(t); o.stop(t + .3); },
  sched(tr, s, t, sd) {
    const bar = Math.floor(s / 16), st = s % 16, ch = tr.chords[bar];
    if (tr.kick[st] === 'x') this.kick(t);
    if (tr.snare[st] === 'x') this.hit(t, false, .28, .12);
    if (tr.hat[st] === 'x') this.hit(t, true, .07, .04);
    const b = tr.bass[st]; if (b !== '.') this.osc('triangle', this.mtof(ch[0] - 12 + (+b)), t, sd * 1.6, .32, .005, 900);
    if (st === 0 || st === 8) ch.forEach(m => this.osc('sine', this.mtof(m + 12), t, sd * 7, .06, .04));
    if (tr.drone && st === 0) this.osc('sawtooth', this.mtof(tr.drone), t, sd * 15, .035, .2, 500);
    const l = tr.lead[st]; if (l != null) this.osc(tr.wave, this.mtof(ch[0] + tr.leadOct + l), t, sd * 1.2, tr.wave === 'sine' ? .1 : .045, .005, 2600);
  }
};
