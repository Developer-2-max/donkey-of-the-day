/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const BUILD = { version: '2.6', web: true };
const TEASES = ['Patte sambhal, gadhe ki aawaz aa rahi hai 🫏', 'Itne patte? Dukaan khol li kya? 📦', 'Cut ka darr saaf dikh raha hai 😂', 'Aaj toh title pakka! 👑🫏', 'Chal chal, jaldi khel ⏱️', 'Mast chaal thi... dusre ke liye 😆'];
const REASONS = { NO_POWER: "You don’t have that magic card.", NOT_IN_MATCH: 'Only players at this table can do that.', NOT_YOUR_TURN: "It isn’t your turn.", MUST_FOLLOW_SUIT: 'You still have the led suit, so you must follow it.', MUST_LEAD_ACE: 'The first trick opens with the Ace of Spades.',
  MUST_CUT: "You have none of the led suit. Choose cards of one other suit to cut.", MIXED_CUT_SUITS: 'A cut must use cards of one suit only.', EMPTY_CUT: 'Select at least one card to cut.',
  CARD_NOT_OWNED: "That card isn’t in your hand.", INVALID_BATCH: "That batch is larger than this player’s remaining cards.", WRONG_PHASE: 'That action no longer applies.', STALE_STATE: 'Slow down a little, then try again.',
  NOT_HOST: 'Only the host can do that.', ROOM_FULL: 'Every seat is taken.', SEATS_NOT_FULL: 'Fill every seat first. Add friends or tap Fill with bots.', CANNOT_CUT_WHEN_LEADING: 'You lead this trick, so play any single card.',
  LOSER_NO_MUSIC: 'You have the most losses, so the music is out of your hands until you make a comeback.', UPLOADS_OFF: 'Song uploads are turned off in public rooms. Pick one of the built-in songs.',
  WATCHERS_NO_MUSIC: 'Only seated players can change the music.', EMPTY_NAME: 'Type a name first.' };
const LOGIN_ERR = { LOGIN_OFF: 'Google sign-in is not switched on for this server.', BAD_NONCE: 'That sign-in expired. Try the Google button again.', EXPIRED: 'That sign-in expired. Try again.', BAD_TOKEN: 'Google sign-in could not be verified. Try again.', LIMIT: 'Slow down a little, then try again.' };
const ERR = { NO_ROOM: 'No room uses that code. Check it with your host.', OFFLINE: 'Not connected to the game server. Check your internet and try again.', TIMEOUT: 'The server took too long to answer. Try again.', TOO_MANY_ROOMS: 'The server is full right now. Try again in a while.', SERVER: 'Something went wrong on the server. Try again.' };

/* ---------- network: one Socket.IO connection to our own game server ---------- */
const Net = {
  uid: null, connected: false, ready: false, socket: null, ident: null, autoTried: false, retriedIdentity: false,
  want: new URLSearchParams(location.search).get('room'),
  identity() {
    let id = LS.get('dotd-web-id');
    if (!id || !id.uid || !id.secret) {
      const r = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
      id = { uid: 'u-' + r(8), secret: r(24) }; LS.set('dotd-web-id', id);
    }
    return id;
  },
  get nroom() { return this.connected; },
  init() {
    this.ident = this.identity(); this.uid = this.ident.uid;
    const s = this.socket = io({ auth: { uid: this.ident.uid, secret: this.ident.secret }, transports: ['websocket', 'polling'] });
    s.on('connect', () => {
      this.connected = true; Prog.load();
      if (App.code && !App.local && App.view === 'room') App.rejoin();   // after a dropped connection the server replays the full state
      else if (!this.autoTried) { this.autoTried = true; const last = LS.get('dotd-last');
        // a reload or reopened invite link puts you straight back in your seat
        if (this.want && last && last.code === this.want.toUpperCase() && last.name) { App.name = last.name; App.render(); App.joinRoom(this.want, !!last.watch); return; } }
      App.render(); });
    s.on('disconnect', () => { this.connected = false; App.render(); });
    s.on('connect_error', e => { this.connected = false;
      if (e && e.message === 'BAD_IDENTITY' && !this.retriedIdentity) { this.retriedIdentity = true; LS.del('dotd-web-id'); this.ident = this.identity(); this.uid = App.uid = this.ident.uid; s.auth = { uid: this.ident.uid, secret: this.ident.secret }; s.connect(); }
      App.render(); });
    s.on('state', m => App.onWebState(m));
    s.on('chat', list => { App.chatDocs = { server: { msgs: list } }; renderChat(); });
    s.on('songs', songs => { App.songs = songs || {}; if (App.sheet === 'music') App.renderSheet(); });
    s.on('presence', uids => { App.online = new Set(uids); App.render(); });
    s.on('react', m => Fun.onReact(m.by, m));
    s.on('progress', m => { if (m && m.toast) App.toast(m.toast); Prog.load(); });
    this.ready = true;
  },
  online() { return this.connected; },
  canWatch() { return this.connected; },
  emit(t, d) { if (this.socket && t === 'react') this.socket.emit('react', d); },
  call(ev, data) { return new Promise(res => { const s = this.socket; if (!s || !s.connected) return res({ error: 'OFFLINE' }); s.timeout(10000).emit(ev, data, (err, r) => res(err ? { error: 'TIMEOUT' } : (r || {}))); }); }
};

/* ---------- recorded commentary voices ----------
   The Lab spoke every line with the phone's built-in voice, which fails on many phones. Here a line plays a recording when
   /audio/commentary/<line id>.mp3 exists on the server, and is text only otherwise (the commentary strip always shows the text).
   Audio is unlocked by the player's first tap, on the same audio engine as the music, which dips while a line plays. */
const Commentary = {
  gain: null, bufs: new Map(), pending: new Map(), manifest: { music: {}, commentary: {} }, unlocked: false, busyUntil: 0, prefetched: false,
  async loadManifest() { try { const r = await fetch('/audio/manifest.json', { cache: 'no-cache' }); if (r.ok) this.manifest = await r.json(); } catch (e) {} },
  hasClip(id) { return !!(this.manifest.commentary || {})[id]; },
  /* must run inside a tap or key press: browsers keep audio locked until then */
  unlock() {
    try { Music.ensureCtx(); Music.mediaSession(); if (Music.ctx && !this.gain) { this.gain = Music.ctx.createGain(); this.gain.connect(Music.ctx.destination); } this.unlocked = !!Music.ctx; } catch (e) { this.unlocked = false; }
    this.prefetch(); try { Fun.paint(); } catch (e) {}
  },
  load(id) {
    if (this.bufs.has(id)) return Promise.resolve(this.bufs.get(id));
    if (!this.pending.has(id)) {
      const p = (async () => { const r = await fetch('/audio/commentary/' + encodeURIComponent(this.manifest.commentary[id])); if (!r.ok) throw new Error('missing'); const ab = await r.arrayBuffer();
        const buf = await new Promise((res, rej) => Music.ctx.decodeAudioData(ab, res, rej)); this.bufs.set(id, buf); return buf; })();
      p.catch(() => this.pending.delete(id)); this.pending.set(id, p);
    }
    return this.pending.get(id);
  },
  /* fetch the clips this phone can play in the background, so the sound is ready the moment the event happens */
  prefetch() {
    if (!this.unlocked || this.prefetched || typeof Fun === 'undefined') return; this.prefetched = true; const w = Fun.set.who;
    COMM_LINES.filter(l => (w === 'mix' || l.who === w) && (l.tier === 'base' || Fun.set.mode === 'teekha') && this.hasClip(l.id)).forEach(l => this.load(l.id).catch(() => {}));
  },
  /* true if a recording started; onTalk(true/false) lets the commentator icon animate while it speaks */
  play(id, pri, onTalk) {
    if (!this.unlocked || !this.hasClip(id)) return false;
    if (Date.now() < this.busyUntil && pri < 2) return false;
    this.load(id).then(buf => { const ctx = Music.ctx; if (!ctx) return; if (ctx.state !== 'running') ctx.resume();
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain); this.busyUntil = Date.now() + buf.duration * 1000;
      if (onTalk) onTalk(true); src.onended = () => { this.busyUntil = 0; if (onTalk) onTalk(false); }; src.start(); }).catch(() => { if (onTalk) onTalk(false); });
    return true;
  }
};

/* the first tap or key press anywhere starts the room music and unlocks commentary, so Start never waits on audio */
(function () {
  const first = () => { ['click', 'keydown', 'touchend'].forEach(t => document.removeEventListener(t, first, true));
    Commentary.unlock(); if (App.musicPick.src !== 'own') App.startAudio(); };
  ['click', 'keydown', 'touchend'].forEach(t => document.addEventListener(t, first, true));
})();

/* ---------- app ---------- */
const SUITSYM = { C: '♣', D: '♦', H: '♥', S: '♠' }, RNAME = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
const SUIT_SETS = { en: { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' }, one: { C: 'Club', D: 'Diamond', H: 'Heart', S: 'Spade' }, hi: { C: 'Kilwar', D: 'Chaukat', H: 'Badam', S: 'Ispik' } };
function suitName(x, one) { const e = (one ? SUIT_SETS.one : SUIT_SETS.en)[x], h = SUIT_SETS.hi[x], m = App.suitMode; return m === 'hi' ? h : m === 'both' ? h + ' (' + e + ')' : e; }
const fmtLog = t => esc(t).replace(/\[\[([CDHS])\]\]/g, (_, x) => suitName(x)).replace(/\{\{([CDHS]_(?:10|[2-9JQKA]))\}\}/g, (_, c) => '<b>' + short(c) + '</b>');
const SEAT_COLORS = ['#F2A516', '#EC5F8C', '#3FC7A4', '#7EB2FF', '#C49BFF'];
function colorOf(u) { const p = App.pub; const list = (p.match && p.match.lobby) || (p.lobby.members || []).map(x => x.uid); const i = list.indexOf(u); return SEAT_COLORS[(i < 0 ? 0 : i) % 5]; }
function avatar(u) { return `<span class="av" style="--c:${colorOf(u)}" aria-hidden="true">${esc((nameOf(u).replace(/^Bot(?=[A-Z])/, '')[0] || '?').toUpperCase())}</span>`; }
const cardName = c => (RNAME[c.slice(2)] || c.slice(2)) + ' of ' + suitName(c[0]);
const short = c => c.slice(2) + SUITSYM[c[0]];
function cardHTML(c, cls = '', attrs = '') {
  const red = c[0] === 'D' || c[0] === 'H';
  return `<button type="button" class="card ${red ? 'red' : ''} ${cls}" aria-label="${cardName(c)}" data-card="${c}" ${attrs}><span class="r">${c.slice(2)}</span><span class="s">${SUITSYM[c[0]]}</span><span class="big" aria-hidden="true">${SUITSYM[c[0]]}</span></button>`;
}
const cardStatic = (c, cls = '') => cardHTML(c, cls, 'tabindex="-1" disabled style="opacity:1;cursor:default"');

const App = {
  view: 'home', uid: null, name: '', code: null, host: null, isHost: false, local: false, pub: null, hand: [], sel: [], pending: null,
  extra: null, offset: 0, lastRecv: 0, online: new Set(), dealCount: 3, seatOrder: null, musicKey: '', homeMsg: '', joining: false, createPublic: false, profile: null, mutedUsers: new Set(LS.get('dotd-muted') || []), suitMode: LS.get('dotd-suits') || 'both', practiceLevel: LS.get('dotd-botlevel') || 'medium',
  musicPick: (LS.get('dotd-music') || {}).src === 'own' ? { src: 'own' } : { src: 'room' }, chatDocs: {}, localChat: [], chatOpen: false, chatSeen: 0, openSets: new Set(), watching: false, songs: {}, localSongs: [], teaseTarget: '', clipJob: null,

  async boot() {
    this.name = LS.get('dotd-name') || '';
    this.render();
    Net.init(); this.uid = Net.uid;
    Commentary.loadManifest().then(() => { this.musicKey = ''; if (this.pub) this.syncMusic(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    // an invite link (/?room=ABCDE) fills in the code on the join screen
    if (Net.want) { const t = setInterval(() => { const el = document.getElementById('code'); if (el) { el.value = Net.want.toUpperCase(); clearInterval(t); } }, 100); setTimeout(() => clearInterval(t), 5000); }
    this.render();
    setInterval(() => this.tickUI(), 200);
  },
  toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.add('hidden'), 3800); },

  /* ----- entering rooms ----- */
  setName() { const v = ($('#nm') && $('#nm').value.trim().slice(0, 24)) || ''; if (!v) { this.homeMsg = 'Enter a display name first.'; this.render(); return false; } this.name = v; LS.set('dotd-name', v); return true; },
  newCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 5; i++) s += A[Engine.secureRand(A.length)]; return s; },
  startPractice(seats) {
    if (!this.setName()) return;
    this.local = true; this.isHost = true; this.code = 'PRACTICE';
    this.host = new Host({ code: this.code, uid: this.uid, name: this.name, local: true, out: (d, h, x, e) => this.receive(d, h, x, e), seats, botLevel: this.practiceLevel, onQuip: (u, x) => this.botSay(u, x) });
    this.chatDocs = {}; this.localChat = []; this.chatSeen = 0;
    for (let i = 1; i < seats; i++) this.host.handle(this.uid, { type: 'ADD_BOT', payload: {} });
    this.view = 'room'; this.host.changed();
  },
  async createRoom() {
    if (!this.setName() || this.joining) return; this.joining = true; this.render();
    const r = await Net.call('create', { name: this.name, public: !!this.createPublic });
    this.joining = false;
    if (r.error) { this.homeMsg = ERR[r.error] || 'Couldn’t create the room.'; return this.render(); }
    this.local = false; this.watching = false; this.code = r.code; if (!this.pub || this.pub.code !== r.code) this.pub = null; this.view = 'room';
    LS.set('dotd-last', { code: r.code, name: this.name, watch: false }); history.replaceState(null, '', '?room=' + r.code); this.render();
  },
  async joinRoom(code, watch) {
    if (!this.setName() || this.joining) return; code = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) { this.homeMsg = 'Room codes have five letters.'; return this.render(); }
    this.joining = true; this.render();
    const r = await Net.call('join', { code, name: this.name, watch: !!watch });
    this.joining = false;
    if (r.error) { this.homeMsg = ERR[r.error] || 'Couldn’t join that room.'; return this.render(); }
    this.local = false; this.watching = !!watch; this.code = code; if (!this.pub || this.pub.code !== code) this.pub = null; this.view = 'room';
    LS.set('dotd-last', { code, name: this.name, watch: !!watch }); history.replaceState(null, '', '?room=' + code); this.render();
  },
  rejoin() { Net.call('join', { code: this.code, name: this.name, watch: this.watching }); },
  async leave() {
    this.closeSheet();
    if (this.host) this.host.timers.forEach(clearTimeout);
    if (!this.local) await Net.call('leave', {});
    Music.stop(); this.musicKey = ''; this.chatOpen = false; this.chatDocs = {}; this.localChat = []; renderChat();
    Object.assign(this, { watching: false, view: 'home', host: null, isHost: false, local: false, pub: null, hand: [], sel: [], pending: null, code: null, seatOrder: null });
    history.replaceState(null, '', location.pathname); this.render();
  },

  /* ----- state in ----- */
  receive(doc, hand, hint, extra) { this.pub = doc; this.hand = hand || []; this.hint = hint || null; this.extra = extra || null; this.offset = 0; this.lastRecv = Date.now(); this.afterPub(); },
  onWebState(m) {   // m.extra carries private info such as a Peek result
    const doc = m.doc; if (!doc || (this.code && doc.code !== this.code)) return;
    if (this.pub && doc.seq < this.pub.seq && doc.hostUid === this.pub.hostUid) return;
    this.pub = doc; this.hand = m.hand || []; this.hint = m.hint || null; this.extra = m.extra || null;
    this.isHost = doc.hostUid === this.uid; this.lastRecv = Date.now(); this.offset = Date.now() - doc.writtenAt;
    this.afterPub();
  },

  afterPub() {
    const m = this.pub.match;
    // keep only legal selection
    this.sel = this.sel.filter(c => this.hand.includes(c));
    if (!m || m.phase !== 'SEATING_ORDER') this.seatOrder = null;
    if (m && m.phase === 'DEALING' && m.dealTo >= 0) { const left = m.quotas[m.dealTo] - m.dealt[m.dealTo]; this.dealCount = Math.max(1, Math.min(this.dealCount, left)); }
    this.syncMusic(); try { Fun.onPub(this.pub); } catch (e) { console.warn('fun', e); } this.render();
  },
  /* the room's song is the same for everyone: the server stores which track plays and when it started, each phone seeks to that moment */
  trackFor(mu) { return mu.kind === 'song' ? null : (catalogTrack(mu.track) || catalogTrack(DEFAULT_TRACK)); },
  syncMusic() {
    const mu = this.pub && this.pub.music, pk = this.musicPick;
    if (pk.src === 'own') { Music.stop(); this.musicKey = 'own'; return; }
    if (!mu || Music.state !== 'on') return;
    const key = (mu.kind === 'song' ? 'song:' + mu.song.id : mu.track) + '@' + mu.startedAt; if (key === this.musicKey) return;
    this.musicKey = key; const at = () => Date.now() - (mu.startedAt + this.offset);
    if (mu.kind === 'song') { const loc = this.localSongs.find(x => x.id === mu.song.id); Music.playSong(loc ? loc.url : '/songs/' + mu.song.id, at()); return; }
    const t = this.trackFor(mu), file = (Commentary.manifest.music || {})[t.id];
    // a recorded file when the server has one, the built-in synth when it does not (or the file fails to play)
    if (file) Music.playSong('/audio/music/' + encodeURIComponent(file), at(), () => Music.play(t.synth, at())); else Music.play(t.synth, at());
  },
  /* called from a first tap or key press: no re-render, so the tap that triggered it still lands on its button */
  startAudio() {
    Music.unlock(); if (!Music.enable()) return;
    this.musicKey = ''; this.syncMusic(); const lbl = document.querySelector('.chip.mus .lbl'); if (lbl) lbl.textContent = ' ' + this.musicLabel();
  },
  setMusic(pick) {
    this.musicPick = pick; LS.set('dotd-music', pick);
    if (pick.src !== 'own') Music.unlock();
    if (pick.src !== 'own' && !Music.enable()) { this.toast('This browser blocked audio. Tap again, or check the device’s sound settings.'); return; }
    this.musicKey = ''; this.syncMusic();
    this.render(); if (this.sheet) this.renderSheet();
  },
  musicLabel() { const pk = this.musicPick, mu = this.pub && this.pub.music; if (pk.src === 'own') return 'My music app'; if (Music.state !== 'on') return 'Tap for sound'; if (Music.muted) return 'Muted';
    return mu && mu.kind === 'song' ? mu.song.title : (this.trackFor(mu || { track: DEFAULT_TRACK }) || {}).title; },
  /* any seated player can change the song at any time; the player with the most losses cannot (a Donkey punishment) */
  musicBlock() {
    const p = this.pub, m = p.match;
    const seated = m ? !!m.names[this.uid] : (p.lobby.members || []).some(x => x.uid === this.uid);
    if (!seated) return { why: 'Only seated players can change the music.' };
    if (m && m.losses) { const max = Math.max(...Object.values(m.losses)); if (max > 0 && m.losses[this.uid] === max) return { why: 'You have the most losses (' + max + '), so you can’t change the song until you make a comeback.' }; }
    return null;
  },

  songList() { return [...this.localSongs.map(x => ({ id: x.id, title: x.title, by: this.uid })), ...Object.entries(this.songs).map(([id, d]) => ({ id, title: d.title, by: d.by, clip: d.clip }))]; },
  async addSong(file) {
    if (!file) return; if (file.size > 20e6) { this.toast('That file is over 20 MB. Pick a shorter song.'); return; }
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My song';
    if (this.local) { this.localSongs.push({ id: 'local-' + Math.random().toString(36).slice(2, 9), title, url: URL.createObjectURL(file) }); this.toast('Added “' + title + '”.'); this.renderSheet(); return; }
    this.clipJob = { msg: 'Uploading…' }; this.renderSheet();
    try {
      const q = new URLSearchParams({ room: this.code, uid: Net.uid, secret: Net.ident.secret, title });
      const res = await fetch('/api/song?' + q, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'UPLOAD');
      this.toast('Added “' + title + '” for the whole room.');
    } catch (e) { this.toast(e.message === 'TYPE' ? 'That file type isn’t supported. Try MP3 or M4A.' : e.message === 'FULL' ? 'This room already has the maximum number of songs.' : e.message === 'UPLOADS_OFF' ? REASONS.UPLOADS_OFF : e.message === 'SLOW_DOWN' ? 'Slow down a little, then try again.' : 'Upload failed. Try again.'); }
    this.clipJob = null; this.renderSheet();
  },


  /* ----- actions out ----- */
  send(type, payload = {}) {
    if (this.host) { const r = this.host.act(this.uid, { type, payload }); if (r) this.toast(REASONS[r] || r); return; }
    if (this.pending) return;
    this.pending = { id: Date.now(), at: Date.now() }; this.render();
    Net.call('act', { type, payload }).then(r => { this.pending = null; if (r.error || r.reason) this.toast(REASONS[r.reason] || ERR[r.error] || 'That move was not accepted.'); this.render(); });
  },

  enableAudio() { Commentary.unlock(); this.setMusic({ src: 'room' }); },
  /* ----- chat ----- */
  chatList() {
    const out = [...this.localChat];
    Object.entries(this.chatDocs).forEach(([k, d]) => (d.msgs || []).forEach(m => out.push({ id: m.id, u: m.u || k, t: m.t, x: m.x })));
    return out.filter(m => m && typeof m.x === 'string' && !this.mutedUsers.has(m.u)).sort((a, b) => a.t - b.t).slice(-80);
  },
  sendChat(text) {
    text = String(text || '').trim().slice(0, 240); if (!text) return;
    if (V7.muted()) { this.toast('Donkey ko bolne ki permission nahi 🤐 You can chat again next hand.'); return; }
    if (this.local) { this.localChat.push({ id: 'l' + Date.now(), u: this.uid, t: Date.now(), x: text }); renderChat(); return; }
    Net.call('chat', text).then(r => { if (r.error) this.toast(r.error === 'MUTED' ? 'Donkey ko bolne ki permission nahi 🤐 You can chat again next hand.' : 'Message not sent. Slow down a little.'); });
    this.chatSeen = this.chatList().length + 1;
  },
  botSay(u, x) { if (this.local) { this.localChat.push({ id: 'b' + Date.now() + u, u, t: Date.now(), x }); renderChat(); } },
  reportMsg(id) { Net.call('report', { id: +id }).then(r => this.toast(r.ok ? 'Reported. A moderator will review it.' : 'Could not report that message.')); },
  muteUser(u) { const s = this.mutedUsers; s.has(u) ? s.delete(u) : s.add(u); LS.set('dotd-muted', [...s]); this.toast(s.has(u) ? nameOf(u) + ' is muted on this device.' : nameOf(u) + ' is unmuted.'); renderChat(); },

  async openProfile() { this.profile = null; this.openSheet('profile'); await this.loadProfile(); },
  async loadProfile() { this.profile = await Net.call('profile'); if (this.sheet === 'profile') { this.renderSheet(); this.setupGoogle(); } },
  /* Google sign-in: the server hands out a one-time nonce, Google's button returns a signed token carrying it, the server verifies and links this browser to the account */
  async setupGoogle() {
    const pr = this.profile, host = document.getElementById('gbtn'); if (!pr || pr.account || !pr.loginAvailable || !host) return;
    const cfg = await (Net.config || (Net.config = fetch('/api/config').then(r => r.json()).catch(() => ({})))); if (!cfg.googleClientId) return;
    const n = await Net.call('login-nonce'); if (!n.nonce) return;
    try {
      await (this.gsi || (this.gsi = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => { this.gsi = null; rej(new Error('gsi')); }; document.head.appendChild(s); })));
      google.accounts.id.initialize({ client_id: cfg.googleClientId, nonce: n.nonce, callback: r => this.googleLogin(r.credential), ux_mode: 'popup', auto_select: false });
      const el = document.getElementById('gbtn'); if (el) google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
    } catch (e) { const el = document.getElementById('gbtn'); if (el) el.innerHTML = '<p class="note">Could not load Google sign-in. Check your connection and try again.</p>'; }
  },
  async googleLogin(credential) {
    const r = await Net.call('login', { credential });
    if (r.ok) { this.toast('Signed in as ' + r.name + '.'); this.profile = null; if (this.sheet === 'profile') this.renderSheet(); await this.loadProfile(); }
    else { this.toast(LOGIN_ERR[r.error] || 'Sign-in failed. Try again.'); this.setupGoogle(); }
  },
  async googleLogout() { await Net.call('logout'); this.toast('Signed out.'); this.profile = null; if (this.sheet === 'profile') this.renderSheet(); await this.loadProfile(); },
  async exportData() {
    const d = await Net.call('export-data'); if (d.error) return this.toast(ERR[d.error] || 'Could not export.');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'donkey-of-the-day-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async deleteData() {
    if (!confirm('Delete your profile, stats, Hall of Shame entries, chat messages and uploaded songs from this server? This cannot be undone.')) return;
    const r = await Net.call('delete-data'); if (r.error) return this.toast(ERR[r.error] || 'Could not delete.');
    ['dotd-web-id', 'dotd-last', 'dotd-name', 'dotd-muted', 'dotd-music', 'dotd-cm-muted'].forEach(k => LS.del(k)); location.href = '/';
  },
  tickUI() {
    document.querySelectorAll('[data-dl]').forEach(el => {
      const dl = +el.dataset.dl + this.offset, total = +el.dataset.total, left = Math.max(0, dl - Date.now());
      const i = el.querySelector('i'); if (i) i.style.width = (100 * left / total) + '%';
      const lab = el.nextElementSibling; if (lab && lab.classList.contains('tlabel')) lab.textContent = Math.ceil(left / 1000) + 's';
    });
    document.querySelectorAll('[data-cd]').forEach(el => { const left = Math.max(0, +el.dataset.cd + this.offset - Date.now()); el.textContent = '(' + Math.ceil(left / 1000) + ' s)';
      if (!left && !el.dataset.fired) { el.dataset.fired = 1; setTimeout(() => this.sheet && this.renderSheet(), 50); } });
  },
  bubbles: {}, lastChatKey: null,
  showBubble(uid, text) {
    this.bubbles[uid] = { x: text, at: Date.now() };
    const el = document.querySelector(`[data-seat="${CSS.escape(uid || '')}"]`); if (!el) return;
    el.querySelectorAll('.bubble').forEach(b => b.remove());
    el.insertAdjacentHTML('beforeend', bubbleHTML(uid));
  },
  showReaction(uid, e) {
    if (!['👏', '😂', '🫏', '😬', '🔥'].includes(e)) return;
    const el = document.querySelector(`[data-seat="${CSS.escape(uid || '')}"]`); if (!el) return;
    const s = document.createElement('span'); s.className = 'react'; s.textContent = e; s.setAttribute('aria-hidden', 'true'); el.appendChild(s); setTimeout(() => s.remove(), 2500);
  },

  /* ----- sheets ----- */
  openSheet(kind) { this.sheet = kind; this.renderSheet(); },
  closeSheet() { this.sheet = null; $('#sheet').classList.add('hidden'); },
  renderSheet() {
    const sh = $('#sheet'); if (!this.sheet) return sh.classList.add('hidden');
    let h = '';
    if (this.sheet === 'menu') h = `<h2>Menu</h2><div class="row"><button class="btn" data-a="scores">Scores and history</button><button class="btn alt" data-a="fun-comm">🎙️ Commentary</button><button class="btn alt" data-a="music">♪ Music</button>${this.local ? '' : '<button class="btn alt" data-a="fun-hall">🫏 Hall of Shame</button>'}<button class="btn alt" data-a="help">How to play</button><button class="btn alt" data-a="leave">Leave room</button>${Net.online() ? '<button class="btn alt" data-a="profile">⭐ My profile and progress</button>' : ''}</div><section class="blk"><h3 style="font-size:20px">Suit names</h3><div style="margin-top:8px">${suitSeg()}</div><p class="note">Kilwar ♣, Chaukat ♦, Badam ♥, Ispik ♠</p></section><p class="note" style="margin-top:14px">Donkey of the Day ${BUILD.version}. ${this.local ? 'Practice table on this device.' : 'Room ' + esc(this.code) + '.'}</p>`;
    if (this.sheet === 'help') h = `<h2>How to play</h2>${rulesHTML()}`;
    if (this.sheet === 'comm') h = Fun.commHTML();
    if (this.sheet === 'hall') h = `<h2>Hall of Shame</h2>${Fun.hallHTML()}`;
    if (this.sheet === 'v7-peek') h = V7.peekSheet();
    if (this.sheet === 'v7-prog') h = profileHTML();
    if (this.sheet === 'music') h = `<h2>Music</h2>${musicHTML()}`;
    if (this.sheet === 'player') h = playerSheetHTML();
    if (this.sheet === 'profile') h = profileHTML();
    if (this.sheet === 'tracker') h = `<h2>Tracker</h2>${trackerHTML()}`;
    if (this.sheet === 'story') h = `<h2>Table story</h2>${storyHTML()}`;
    if (this.sheet === 'scores') h = `<h2>Scores</h2>${scoresHTML(true)}`;
    if (this.sheet === 'leave') h = `<h2>Leave the room?</h2><p>${this.local ? 'This practice game will end.' : (this.watching ? 'You’ll stop watching this room.' : 'Your seat is kept. If you are away during your turn, moves are made for you, and after two of them the game pauses.')}</p><div class="row"><button class="btn gold" data-a="leave-now">Leave</button>${this.isHost && this.pub && this.pub.match && !['MATCH_RESULT','INCOMPLETE'].includes(this.pub.match.phase) ? '<button class="btn alt" data-a="end-match">End match without a result</button>' : ''}</div>`;
    sh.innerHTML = `<div><div class="row" style="justify-content:flex-end"><button class="btn alt small" data-a="close-sheet">Close</button></div>${h}</div>`;
    sh.classList.remove('hidden');
  },

  /* ----- rendering ----- */
  render() {
    const root = $('#app'), ae = document.activeElement; const fk = ae && ae.dataset && (ae.dataset.card || ae.dataset.a);
    const keep = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.id && root.contains(ae) ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
    const drafts = {}; root.querySelectorAll('input.t[id]').forEach(i => drafts[i.id] = i.value);
    if (this.view === 'home') root.innerHTML = homeHTML();
    else if (!this.pub) root.innerHTML = `<div class="wrap"><p>Connecting to room ${esc(this.code)}…</p><button class="btn alt" data-a="leave-now">Back</button></div>`;
    else { const m = this.pub.match; root.innerHTML = m && (m.names[this.uid] || this.watching) ? gameHTML() : lobbyHTML(); }
    Object.entries(drafts).forEach(([id, v]) => { const i = document.getElementById(id); if (i && i.dataset.live !== 'server') i.value = v; });
    if (keep) { const i = document.getElementById(keep.id); if (i) { i.value = keep.v; i.focus({ preventScroll: true }); try { i.setSelectionRange(keep.s, keep.s); } catch (e) {} } }
    else if (fk) { const el = root.querySelector(`[data-card="${fk}"],[data-a="${fk}"]`); if (el) el.focus({ preventScroll: true }); }
    document.body.classList.toggle('inroom', this.view === 'room' && !!this.pub);
    document.body.classList.toggle('ingame', !!root.querySelector('#game'));
    renderChat();
    if (this.sheet && this.sheet !== 'menu' && this.sheet !== 'leave' && this.sheet !== 'help' && this.sheet !== 'profile') this.renderSheet();
    this.tickUI(); this.fitHand();
  },
  /* spread the cards across the available width (all 13 visible on a phone), instead of a sideways scrollbar */
  fitHand() {
    const h = document.querySelector('#game .hand'); if (!h) return; const cs = [...h.querySelectorAll('.card')]; if (cs.length < 2) return;
    const cs0 = getComputedStyle(h), avail = h.clientWidth - parseFloat(cs0.paddingLeft) - parseFloat(cs0.paddingRight), w = cs[0].offsetWidth;
    const gaps = h.querySelectorAll('.gap').length * 14, step = (avail - gaps - w) / (cs.length - 1), margin = Math.max(-(w - 17), Math.min(4, step - w));
    cs.forEach((c, i) => { c.style.marginRight = i === cs.length - 1 ? '0' : margin + 'px'; });
  }
};

/* ---------- views ---------- */
function rulesHTML(open = true) {
  return `<details class="rules" ${open ? 'open' : ''}><summary>Rules</summary><ol>
<li>Four or five players, one 52-card deck, no jokers or trumps. Ace is high, 2 is low.</li>
<li>Everyone draws a card. The highest draw arranges the seats; a second draw makes the lowest card the first dealer. Ties redraw.</li>
<li>The dealer deals clockwise in batches of their choice, from one card to a player’s whole share. With five players, 2 extra cards go to one player (or one each to two players, if the host chooses that). The extra-card seat moves one place clockwise every hand.</li>
<li>The Ace of Spades opens the first trick. Everyone must follow the led suit if they can.</li>
<li>If everyone follows, the trick is discarded and the highest card of the led suit leads next, with any card.</li>
<li>If you can’t follow, you cut: give one or more cards of a single other suit. The table pile and your cards go to whoever played the highest card of the led suit. Everyone sees them for 20 seconds, then you lead next.</li>
<li>Run out of cards and you’re safe for this hand. The last player holding cards is the Donkey, takes a loss and deals next.</li>
<li>The host declares the series before the match: first to 2, 3 or 5 Donkey losses, consecutive or not, becomes Donkey of the Day, dated in the room’s timezone.</li></ol></details>
<details class="rules"><summary>Proposed house-rule defaults in this version</summary><ul>
<li>A cut is allowed on the opening Spades trick too.</li>
<li>Emptying your hand only counts once the trick or pickup finishes, so your last card can still collect a pickup.</li>
<li>If the player who should lead is out, the lead passes clockwise.</li>
<li>If everyone empties on the final trick, the highest card of that trick takes the loss.</li>
<li>If the same position comes round three times in one hand, it’s a stalemate: whoever holds the most cards takes the loss (the player due to lead, on a tie).</li>
<li>90 seconds per move (10 seconds in Blitz mode). When time runs out, your lowest legal card is played, or one lowest card is cut. After two automatic moves in a row the game pauses up to 2 minutes for you, then ends without an award. If your phone drops, your seat is held, and moves are made for you if it is your turn.</li>
<li>Music is optional. The room plays one song for everyone, in sync. Any seated player can change it, except the player with the most losses. You can mute it, lower it, or use your own music app.</li></ul></details>`;
}
function musicHTML() {
  const p = App.pub, mu = p.music, pk = App.musicPick, blk = App.musicBlock(), pubRoom = !!p.lobby.public;
  const nowTitle = mu.kind === 'song' ? mu.song.title : App.trackFor(mu).title;
  const opt = (src, title, note) => `<button class="track ${pk.src === src ? 'sel' : ''}" data-a="pick-src" data-src="${src}" aria-pressed="${pk.src === src}"><span class="grow"><b>${title}</b><br><span class="note">${note}</span></span></button>`;
  const dis = blk ? 'disabled' : '';
  const songs = pubRoom ? [] : App.songList();
  const anyRecorded = Object.keys(Commentary.manifest.music || {}).length > 0;
  return `<h3 style="font-size:20px">What you hear</h3><p class="note">Music is optional and never blocks Start. The room song begins after your first tap.</p>
  <div class="tracks">${opt('room', 'Room music', 'The song the table is playing, in sync')}${opt('own', 'My music app', 'Spotify, JioSaavn or YouTube Music playing alongside the game')}</div>
  ${pk.src === 'own' ? `<p class="note">Start your playlist in the app, then come back. Your app keeps playing in the background.</p><a class="btn alt" href="https://open.spotify.com" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none">Open Spotify</a>` : ''}
  ${pk.src !== 'own' && Music.state !== 'on' ? '<p><button class="btn gold small" data-a="audio">🔊 Turn on sound</button></p>' : ''}
  ${Music.blocked || Music.songError ? `<p class="err">${Music.songError ? 'This device can’t play the current song file, so the built-in version plays instead.' : 'Your browser paused the music.'} <button class="btn alt small" data-a="audio">Try again</button></p>` : ''}
  <section class="blk"><h3 style="font-size:20px">Room music</h3>
  <div class="nowbar"><span class="grow">Now playing: <b>${esc(nowTitle)}</b>${mu.by ? '<br><span class="note">picked by ' + esc(nameOf(mu.by)) + '</span>' : ''}</span>
    <button class="btn gold" data-a="next-song" ${blk ? 'disabled' : ''}>⏭ Next song</button></div>
  <p class="note">Any seated player can change the song at any time. Whoever has the most losses can’t touch the music until they make a comeback.</p>
  ${anyRecorded ? '' : '<p class="note">Recorded songs have not been added to this server yet, so every track plays as its built-in version.</p>'}
  ${blk ? `<p class="err" role="status">${blk.why}</p>` : ''}
  ${MOODS.map(md => `<h4 class="sub">${esc(md.label)}</h4><div class="tracks">${CATALOG.filter(t => t.mood === md.id).map(t => `<button class="track ${mu.kind !== 'song' && mu.track === t.id ? 'sel' : ''}" data-a="set-track" data-t="${t.id}" ${dis}><span class="grow"><b>${esc(t.title)}</b></span></button>`).join('')}</div>`).join('')}
  ${pubRoom ? '<p class="note">Song uploads are turned off in public rooms. Use a private room to add your own songs.</p>' : `<h4 class="sub">Songs added by players</h4>
  <div class="tracks">${songs.map(x => `<button class="track ${mu.kind === 'song' && mu.song.id === x.id ? 'sel' : ''}" data-a="set-song" data-id="${esc(x.id)}" data-t="${esc(x.title)}" ${dis}><span class="grow"><b>${esc(x.title)}</b><br><span class="note">Added by ${esc(nameOf(x.by))}</span></span></button>`).join('') || '<p class="note">No songs yet.</p>'}</div>
  ${App.clipJob ? `<p class="status">${App.clipJob.msg}</p>` : `<label class="btn alt" style="display:inline-block;margin-top:10px">Add a song from this device<input type="file" accept="audio/*,video/mp4,video/webm,.m4a,.mp3" data-change="song" hidden></label>
  <p class="note">MP3, M4A, WAV and OGG files up to 20 MB. Add only music you’re allowed to share with your friends.</p>`}`}</section>
  ${Music.state === 'on' && pk.src !== 'own' ? `<section class="blk"><label class="f" for="vol">Volume on this device</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${Music.vol}" style="width:100%">
  <div class="row" style="margin-top:8px"><button class="btn alt small" data-a="mute" aria-pressed="${Music.muted}">${Music.muted ? 'Unmute' : 'Mute'}</button><span class="note">Muting only affects you.</span></div></section>` : ''}`;
}
function signInHTML(pr) {
  if (pr.account) return `<p>Signed in with Google as <b>${esc(pr.account.name)}</b>. Your XP, stats and Hall of Shame follow you to any device.</p><div class="row"><button class="btn alt small" data-a="logout">Sign out</button></div>`;
  if (!pr.loginAvailable) return '<p class="note">Sign-in is not switched on for this server yet.</p>';
  return '<p class="note">Sign in with Google to keep your XP, stats and Hall of Shame on every device. We store only your Google account ID and name, never your email or photo.</p><div id="gbtn" style="min-height:44px"></div>';
}
function profileHTML() {
  const pr = App.profile;
  if (!pr) return '<h2>My profile</h2><p class="note">Loading…</p>';
  if (pr.error) return `<h2>My profile</h2><p class="err">${esc(ERR[pr.error] || 'Could not load your profile.')}</p>`;
  const into = Math.max(0, Math.min(100, pr.xp - pr.prevLevelXp));
  const hall = pr.hall.length ? `<ol class="hall">${pr.hall.map(h => `<li><b>${esc(h.title || 'Donkey of the Day')}</b> <span class="note">${esc(h.date || '')}, room ${esc(h.room)}, ${h.losses} losses</span></li>`).join('')}</ol>` : '<p class="note">Nobody has crowned you Donkey of the Day yet. Keep it that way.</p>';
  return `<h2>${esc(pr.name || App.name || 'My profile')}</h2>
  <p>Level <b>${pr.level}</b> · ${pr.xp} XP</p><div class="xpbar" role="progressbar" aria-valuenow="${into}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to level ${pr.level + 1}"><i style="width:${into}%"></i></div>
  <p class="note">${pr.nextLevelXp - pr.xp} XP to level ${pr.level + 1}. Hands, escapes, matches and challenges all earn XP, and new levels unlock table colours and card backs.</p>
  ${Prog.challengeHTML()}${Prog.lookHTML()}
  <section class="blk"><h3 style="font-size:20px">Stats</h3><p>${pr.matches} matches · ${pr.series.won} series safe · ${pr.series.lost} series lost · ${pr.handsSafe} hands finished safe</p></section>
  <section class="blk"><h3 style="font-size:20px">My Hall of Shame entries</h3>${hall}<button class="btn alt small" data-a="fun-hall">🫏 Open the Hall of Shame</button></section>
  <section class="blk"><h3 style="font-size:20px">Sign in</h3>${signInHTML(pr)}</section>
  <section class="blk"><h3 style="font-size:20px">Your data</h3><p class="note">${pr.account ? 'Your progress is saved to your Google account on this server.' : 'Your progress is saved on this server against this browser. Clearing browser data or switching device starts a fresh profile unless you sign in.'} The Hall of Shame is public and shows display names. You can download or delete everything we hold about you.</p>
  <div class="row"><button class="btn alt small" data-a="export-data">Download my data</button><button class="btn alt small" data-a="delete-data">Delete my data</button></div></section>`;
}
function suitSeg() {
  return `<span class="seg" role="group" aria-label="Suit names">${[['en', 'English'], ['hi', 'Hinglish'], ['both', 'Both']].map(([k, l]) => `<button data-a="suits" data-k="${k}" aria-pressed="${App.suitMode === k}">${l}</button>`).join('')}</span>`;
}
function homeHTML() {
  const last = LS.get('dotd-last'), online = Net.online();
  const netNote = online ? '' : '<p class="note">Connecting to the game server…</p>';
  return `<div class="wrap" id="home"><div class="hero"><h1>Donkey of the Day</h1>
  <p class="tag">Follow suit, cut when you can’t, and don’t be the last one holding cards.</p>
  <input id="nm" class="t namein" maxlength="24" autocomplete="nickname" value="${esc(App.name)}" placeholder="Your name at the table" aria-label="Your display name">
  <div class="row quick"><button class="btn alt small" data-a="help" aria-label="How to play">📖 Rules</button>${online ? '<button class="btn alt small" data-a="profile">⭐ My profile</button>' : ''}<button class="btn alt small" data-a="fun-hall" ${Net.canWatch() ? '' : 'disabled'}>🫏 Hall of Shame</button></div>
  ${App.homeMsg ? `<p class="err" role="alert">${esc(App.homeMsg)}</p>` : ''}
  <div class="row suitrow"><span>Suit names</span>${suitSeg()}<span class="ver">v${BUILD.version}</span></div></div>
  ${Prog.challengeHTML()}
  <div class="homeform">
  <div class="choice"><h3>Play with friends</h3>${netNote}
    <div class="row" style="margin-top:6px"><button class="btn gold" data-a="create" ${online && !App.joining ? '' : 'disabled'}>Create room</button>
    ${last && last.code ? `<button class="btn alt" data-a="rejoin" ${online ? '' : 'disabled'}>Rejoin ${esc(last.code)}</button>` : ''}</div>
    <label class="note pubrow"><input type="checkbox" data-change="public" ${App.createPublic ? 'checked' : ''}> Public room (chat is filtered, song uploads are off)</label>
    <div class="joinrow"><input id="code" class="t" maxlength="5" aria-label="Room code" placeholder="CODE" autocapitalize="characters"><button class="btn" data-a="join" ${online && !App.joining ? '' : 'disabled'}>Join</button><button class="btn alt" data-a="watch" ${Net.canWatch() && !App.joining ? '' : 'disabled'} title="Follow a match, chat and tease without a seat">Watch</button></div></div>
  <div class="choice"><h3>Practice with bots</h3>
    <div class="row" style="margin-top:6px"><select class="lvl" data-change="plevel" aria-label="Bot level">${LEVELS.map(([k, l]) => `<option value="${k}" ${App.practiceLevel === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn" data-a="practice" data-n="4">4 players</button><button class="btn alt" data-a="practice" data-n="5">5 players</button></div></div>
  </div><p class="note foot"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p></div>`;
}
/* the Lab's fun rules as tap-to-toggle chips, so they are one tap away instead of buried in settings */
function funChipsHTML(L, H) {
  const F = L.fun || {}, rules = [['shuffle', '🔀', 'Shuffle power'], ['powers', '✨', 'Magic cards'], ['blitz', '⚡', 'Blitz'], ['bets', '🎲', 'Bets'], ['mute', '🤐', 'Mute Donkey']];
  return `<div class="rulechips" role="group" aria-label="Fun rules">${rules.map(([k, i, n]) => H
    ? `<button class="rulechip ${F[k] ? 'on' : ''}" data-a="v7-fun" data-k="${k}" data-v="${F[k] ? '0' : '1'}" aria-pressed="${!!F[k]}"><span aria-hidden="true">${i}</span> ${n}</button>`
    : `<span class="rulechip ${F[k] ? 'on' : 'off'}"><span aria-hidden="true">${i}</span> ${n}</span>`).join('')}</div>`;
}
function lobbyHTML() {
  const p = App.pub, L = p.lobby, me = (L.members || []).find(x => x.uid === App.uid), H = App.isHost, m = p.match;
  if (!me) {
    const why = (L.kicked || []).includes(App.uid) ? 'The host removed you from this lobby.' : m ? 'A match is being played in this room. You can be seated after it ends and the host returns to the lobby.' : L.members.length >= L.seatsWanted ? 'Every seat in this room is taken.' : 'Joining…';
    if (App.watching) return `<div class="wrap"><div class="note">Room code</div><div class="code">${esc(App.code)}</div><p>👀 You’re watching. The table appears here when the host starts the match.</p>
      <ul class="list">${L.members.map(x => `<li>${avatar(x.uid)}<span class="grow">${esc(x.name)}${x.bot ? ' 🤖' : ''}</span></li>`).join('')}</ul>
      <div class="row" style="margin-top:14px"><button class="btn alt" data-a="music">Music</button><button class="btn alt chatbtn" data-a="chat">Chat${unreadBadge()}</button><button class="btn alt" data-a="leave-now">Stop watching</button></div></div>`;
    return `<div class="wrap"><h1 class="code">${esc(App.code)}</h1><p>${why}</p><div class="row">${m || L.members.length >= L.seatsWanted ? '<button class="btn gold" data-a="watch-instead">Watch instead</button>' : ''}<button class="btn alt" data-a="leave-now">Back to home</button></div></div>`;
  }
  const full = L.members.length === L.seatsWanted, missing = L.seatsWanted - L.members.length;
  const nowTitle = p.music.kind === 'song' ? p.music.song.title : App.trackFor(p.music).title;
  const startWhy = !full ? `Waiting for ${missing} more player${missing > 1 ? 's' : ''}. ${App.local ? '' : 'Share the code, or fill the seats with bots.'}` : 'Every seat is filled. Music is optional, so you can start now.';
  return foldSections(`<div class="wrap lobby">
  <div class="row lobhead"><div class="grow">${App.local ? '<h1>Practice table</h1>' : '<h1>Table lobby</h1>'}</div>
   <button class="btn alt small" data-a="help" aria-label="How to play">?</button><button class="btn alt small" data-a="leave">Leave</button></div>
  ${App.local ? '' : `<section class="invite" aria-label="Invite friends"><div class="note">Room code · ${L.public ? 'public room, chat is filtered' : 'private room'}</div>
   <div class="bigcode" aria-label="Room code ${esc(App.code.split('').join(' '))}">${esc(App.code)}</div>
   <div class="row"><button class="btn gold" data-a="share-invite">📲 Share invite</button><button class="btn alt" data-a="copy-code">Copy link</button></div>
   <p class="note">${H ? 'You’re the host: you pick the rules and press Start. The game runs on the server, so closing this page won’t stop it.' : 'Waiting for the host to start the match.'}</p></section>`}
  ${funChipsHTML(L, H)}
  <section class="blk"><h2>Players ${L.members.length}/${L.seatsWanted}</h2><ul class="list">
  ${L.members.map(x => `<li>${avatar(x.uid)}<span class="dot ${x.bot || App.online.has(x.uid) || x.uid === App.uid || App.local ? 'on' : ''}" title="${x.bot ? 'Bot' : App.online.has(x.uid) ? 'Connected' : 'Not connected'}"></span>
   <span class="grow pname">${esc(x.name)}${x.uid === App.uid ? ' (you)' : ''}${x.uid === p.hostUid ? ' <span class="tagp">Host</span>' : ''}${x.bot && !H ? ` <span class="tagp">🤖 Bot, ${(LEVELS.find(l => l[0] === x.level) || LEVELS[1])[1]}</span>` : ''}</span>
   ${x.bot && H ? `<span class="tagp" title="Bot">🤖</span><select class="lvl" data-change="botlevel" data-u="${esc(x.uid)}" aria-label="Level for ${esc(x.name)}">${LEVELS.map(([k, l]) => `<option value="${k}" ${x.level === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
   ${H && x.uid !== App.uid ? `<button class="btn alt small rm" data-a="remove" data-u="${esc(x.uid)}" aria-label="Remove ${esc(x.name)}">✕</button>` : ''}</li>`).join('')}</ul>
  ${H ? `<details class="set" data-set="Table settings" ${App.openSets.has('Table settings') ? 'open' : ''}><summary>Table settings</summary><div class="row" style="margin-top:12px"><span>Seats</span><span class="seg">${[4, 5].map(n => `<button data-a="seats" data-n="${n}" aria-pressed="${L.seatsWanted === n}">${n}</button>`).join('')}</span>
   <button class="btn alt small" data-a="add-bot" ${full ? 'disabled' : ''}>Add a bot</button><button class="btn alt small" data-a="fill-bots" ${full ? 'disabled' : ''}>Fill with bots</button></div>
   <div class="row" style="margin-top:10px"><span>Bot thinking time</span><span class="seg"><button data-a="speed" data-k="real" aria-pressed="${L.botSpeed !== 'quick'}">5–15 s</button><button data-a="speed" data-k="quick" aria-pressed="${L.botSpeed === 'quick'}">Quick</button></span></div>
   ${L.seatsWanted === 5 ? `<div class="row" style="margin-top:10px"><span>Five-player deal</span><span class="seg"><button data-a="mode" data-m="single" aria-pressed="${L.mode === 'single'}">12 to one player</button><button data-a="mode" data-m="split" aria-pressed="${L.mode === 'split'}">11 to two players</button></span></div>` : ''}`
   : `<p class="note">${L.seatsWanted} seats${L.seatsWanted === 5 ? (L.mode === 'single' ? ', one player gets 12 cards each hand' : ', two players get 11 cards each hand') : ''}.</p>`}
  <p class="note">Award date timezone: ${esc(L.tz)}. Humans get ${L.blitz ? '10 seconds (Blitz)' : '90 seconds'} per move.</p>${H ? '</details>' : ''}
  ${(L.watchers || []).length ? `<p class="note">👀 Watching: ${L.watchers.map(w => esc(w.name)).join(', ')}</p>` : ''}</section>
  ${conspiracyHTML(L, H)}${V7.lobbyHTML(L, H)}
  <section class="blk"><h2>Series</h2>
   ${H ? `<div class="row"><span>First to</span><span class="seg">${[2, 3, 5].map(n => `<button data-a="series" data-n="${n}" aria-pressed="${(L.target || 5) === n}">${n}</button>`).join('')}</span><span>Donkey losses</span></div>`
   : `<p>First to <b>${L.target || 5}</b> Donkey losses becomes Donkey of the Day.</p>`}
   <p class="note">The series is announced when the match starts and can’t change mid-match.</p></section>
  <section class="blk"><h2>Donkey names by level</h2>
   <p class="note">Each loss moves a player up a level and gives them a random name from that level’s list. The player who loses the series gets a level 5 name. The others can swap a name for another or type their own.</p>
   ${H ? `<div class="row"><span class="seg"><button data-a="titles-on" data-k="1" aria-pressed="${L.titlesOn}">On</button><button data-a="titles-on" data-k="0" aria-pressed="${!L.titlesOn}">Off</button></span></div>
    ${L.titlesOn ? `<ol class="titles">${L.titles.map((l, i) => `<li><label class="note" for="tl${i}">${i === 4 ? 'Level 5, series loser' : 'Level ' + (i + 1) + ', loss ' + (i + 1)}</label><input id="tl${i}" class="t" data-live="server" data-change="levels" value="${esc(l.join(', '))}"></li>`).join('')}</ol><p class="note">Separate names with commas.</p>` : ''}`
   : L.titlesOn ? `<ol class="titles">${L.titles.map((l, i) => `<li><span class="note">Level ${i + 1}</span><span>${l.map(esc).join(', ')}</span></li>`).join('')}</ol>` : '<p class="note">Donkey names are off for this room.</p>'}</section>
  <section class="blk"><h2>Suit names</h2><div class="row">${suitSeg()}</div></section>
  <section class="blk"><h2>Music</h2><p>Room track: <b>${esc(nowTitle)}</b>. You hear: <b>${esc(App.musicLabel())}</b></p>
   <div class="row"><button class="btn alt small" data-a="music">Choose music</button></div></section>
  <div class="lobbybar"><section class="blk you">
   <div class="row"><span class="tagp go">♪ ${esc(App.musicLabel())}</span><button class="btn alt small" data-a="music">Music</button><button class="btn alt chatbtn2" data-a="chat">💬 Chat${unreadBadge()}</button></div>
   </section>
  ${H ? `<section class="blk startrow"><button class="btn gold" data-a="start" ${full ? '' : 'disabled'}>Start match</button>${full ? '' : '<button class="btn alt" data-a="fill-bots">Fill with bots</button>'}<span class="note">${startWhy}</span></section>` : `<p class="note" style="margin-top:22px">${startWhy} The host starts the match.</p>`}
  </div></div>`);
}
function foldSections(html) {
  const parts = []; let first = -1;
  html = html.replace(/<section class="blk"><h2>([^<]+)<\/h2>([\s\S]*?)<\/section>/g, (all, t, body, off) => {
    if (/^Players/.test(t)) return all;
    parts.push(`<section class="sub"><h3>${t}</h3>${body}</section>`); return '\u0000';
  });
  const i = html.indexOf('\u0000'); if (i < 0) return html;
  html = html.replace(/\u0000/g, '');
  const fold = `<details class="set" data-set="Room settings" ${App.openSets.has('Room settings') ? 'open' : ''}><summary>Room settings</summary>${parts.join('')}</details>`;
  return html.slice(0, i) + fold + html.slice(i);
}
function pipsHTML(n, of) { of = of || (App.pub && App.pub.match && App.pub.match.target) || (App.pub && App.pub.lobby && App.pub.lobby.target) || 5; return `<span class="pips" aria-label="${n} of ${of} losses">${Array.from({ length: of }, (_, i) => i).map(i => `<span class="pip ${i < n ? 'on' : ''}"></span>`).join('')}</span>`; }
function timerHTML(dl, total) { if (!dl) return ''; return `<div class="timer" data-dl="${dl}" data-total="${total}"><i></i></div><div class="tlabel"></div>`; }
function seatsOrder(m) { const s = m.seats || m.lobby; const i = s.indexOf(App.uid); return i < 0 ? s : [...s.slice(i + 1), ...s.slice(0, i)]; }
function shortName(u) { const n = nameOf(u); return n.replace(/^Bot(?=[A-Z])/, ''); }
function nameOf(u) { const p = App.pub; if (p.match && p.match.names[u]) return p.match.names[u]; const m = (p.lobby.members || []).find(x => x.uid === u); return m ? m.name : 'Player'; }

function gameHTML() {
  const p = App.pub, m = p.match, others = seatsOrder(m), base = Math.floor(52 / m.n), spect = !m.names[App.uid];
  const maxL = Math.max(0, ...Object.values(m.losses)); const think = p.lobby.botThinking;
  const turnU = m.phase === 'TURN' ? m.actor : m.phase === 'DEALING' ? m.seats[m.dealer] : m.phase === 'SEATING_ORDER' ? m.draw.winner : m.phase === 'PAUSED' ? m.pauseFor : null;
  const seatChip = u => { const i = m.seats ? m.seats.indexOf(u) : -1; const done = m.finished && m.finished[i];
    const extra = i >= 0 && m.quotas ? m.quotas[i] - base : 0;
    const cnt = m.counts ? (m.phase === 'DEALING' ? `${m.counts[u]}/${m.quotas[i]}` : `${m.counts[u]} card${m.counts[u] === 1 ? '' : 's'}`) : '';
    const off = !m.bots[u] && !App.local && !App.online.has(u) && u !== App.uid && Net.nroom;
    const played = (m.table || []).find(t => m.seats[t.s] === u); const title = m.titleOf && m.titleOf[u];
    return `<div class="seat ${turnU === u ? 'turn' : ''} ${done ? 'done' : ''} ${V7.seatCls(m, u)}" data-seat="${esc(u)}" data-a="player" data-u="${esc(u)}" role="button" tabindex="0" aria-label="${esc(nameOf(u))}: details and cards played" style="--c:${colorOf(u)}">${V7.orn(m, u)}<div class="nm" title="${esc(nameOf(u))}">${avatar(u)}${off ? '<span class="dot" title="Not connected"></span>' : ''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(shortName(u))}</span>${(m.targets || []).includes(u) ? '<span title="Targeted by the bots" aria-label="Targeted">🎯</span>' : ''}${maxL > 0 && m.losses[u] === maxL ? '<span title="Most losses so far">👑🫏</span>' : ''}</div>
    ${title ? `<div class="ttl2" title="Level ${(m.levelOf || {})[u] || ''} Donkey: ${esc(title)}"><span class="lvlbadge">L${(m.levelOf || {})[u] || '?'}</span> ${esc(title)}</div>` : ''}
    <div class="ct">${done ? 'Out' : cnt}${i === m.dealer && m.handNo ? '<span class="badge" title="Dealer">D</span>' : ''}${extra > 0 ? `<span class="badge x" title="Gets ${extra} extra this hand">+${extra}</span>` : ''}${m.bots[u] && m.levels ? `<span class="badge x" title="${(LEVELS.find(l => l[0] === m.levels[u]) || LEVELS[1])[1]} bot">🤖<span class="lvtxt"> ${(LEVELS.find(l => l[0] === m.levels[u]) || LEVELS[1])[1]}</span></span>` : ''}</div>
    ${pipsHTML(m.losses[u])}${fxHTML(m, u)}${think && think.u === u && m.phase === 'TURN' && m.actor === u ? '<span class="fx think">🤔 thinking</span>' : ''}${historyHTML(m, u, 3)}${bubbleHTML(u)}</div>`; };
  const myI = m.seats ? m.seats.indexOf(App.uid) : -1;
  return `<div id="game" class="ph-${m.phase} ${Fun.showdownCls(m)}"><div class="felt">
   <div class="topbar"><span class="ttl grow">${m.handNo ? 'Hand ' + m.handNo : 'Setting up'} <span class="series" title="Series: first to ${m.target} losses">🏁 to ${m.target}</span></span>
    ${Net.nroom ? `<span class="reactbar ${App.reactOpen ? 'open' : ''}" aria-label="Reactions"><button class="reacttog" data-a="react-toggle" aria-expanded="${!!App.reactOpen}" aria-label="Reactions">😀</button><span class="reopts">${['👏', '😂', '🫏', '😬'].map(e => `<button data-a="react" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</span></span>` : ''}
    <button class="chip mus" data-a="music" aria-label="Music: ${esc(App.musicLabel())}">♪<span class="lbl"> ${esc(App.musicLabel())}</span></button><button class="chip chatchip" data-a="chat" aria-label="Chat">💬<span class="lbl"> Chat</span>${unreadBadge()}</button>
    <button class="chip" data-a="menu" aria-label="Menu">☰<span class="lbl"> Menu</span></button></div>
   ${spect ? `<div class="watchbar">👀 You’re watching. Cards stay hidden.</div>` : ''}
   <div class="seats" style="--cols:${others.length}">${others.map(seatChip).join('')}</div>
   <div class="dir">${Fun.dirInner(m.seats ? (spect ? 'Play passes clockwise ↻ left to right' : 'Play passes clockwise ↻ left to right, then to you') : '')}</div>
   <div class="center" aria-live="polite">${bannerHTML(m)}${centerHTML(m)}</div>
   ${stripHTML(m)}${chatLineHTML()}</div>
   ${spect ? `<div class="me spect"><div class="info"><span>👀</span><b>${esc(App.name || 'Guest')}</b><span class="grow"></span><span class="note">${(p.lobby.watchers || []).length} watching</span></div>
     <div class="actions"><button class="btn gold" data-a="chat">Chat and tease${unreadBadge()}</button><button class="btn alt" style="color:var(--ink)" data-a="leave">Stop watching</button></div></div>` : `
   <div class="me" data-seat="${esc(App.uid)}" style="position:relative">${bubbleHTML(App.uid)}${V7.punished(m, App.uid) ? V7.orn(m, App.uid) : ''}<div class="info">${avatar(App.uid)}<b>${esc(nameOf(App.uid))}</b>${(m.targets || []).includes(App.uid) ? '<span title="The bots are ganging up on you">🎯</span>' : ''}${m.titleOf && m.titleOf[App.uid] ? `<span class="ttl3">${esc(m.titleOf[App.uid])}</span>` : ''}${myI === m.dealer && m.handNo ? '<span class="badge">D</span>' : ''}${pipsHTML(m.losses[App.uid])}<span class="grow"></span>
    <span class="note">${m.phase === 'DEALING' ? (m.counts ? m.counts[App.uid] + ' dealt to you so far' : '') : App.hand.length ? App.hand.length + ' cards' : m.finished && m.finished[myI] ? 'You are out this hand' : ''}</span></div>
    <div class="myhist">${historyHTML(m, App.uid, 12, true)}</div>
    ${V7.meHTML(m)}${handHTML(m)}${actionsHTML(m)}</div>`}</div>`;
}
function ledHigh(m) { let b = null; (m.table || []).forEach(t => { if (t.c[0] === m.led && (!b || Engine.rankOf(t.c) > Engine.rankOf(b.c))) b = t; }); return b; }
function centerHTML(m) {
  const T = Engine.T, me = App.uid;
  if ((m.phase === 'SHUFFLE' || m.phase === 'DECK_CUT') && m.shuf) return V7.centerHTML(m);
  switch (m.phase) {
    case 'SEATING_DRAW': case 'DEALER_DRAW': { const seat = m.phase === 'SEATING_DRAW';
      return `${seat ? `<div class="seriesban">🏁 Series declared: first to <b>${m.target}</b> Donkey losses</div>` : ''}<h2>${seat ? 'Drawing for seats' : 'Drawing for dealer'}</h2><p class="note" style="color:var(--feltMuted)">${seat ? 'Highest card arranges the seating.' : 'Lowest card deals first. Ace is high.'}</p>
      ${m.draw.rounds.map((r, k) => `${k ? '<p class="note" style="color:var(--feltMuted)">Tie. The tied players draw again.</p>' : ''}<div class="draws">${Object.entries(r).map(([u, c]) => playedHTML(u, c, '', false)).join('')}</div>`).join('')}
      <p class="status"><b>${esc(nameOf(m.draw.winner))}</b> ${seat ? 'arranges the seats' : 'deals first'}.</p>`; }
    case 'SEATING_ORDER': {
      if (m.draw.winner !== me) return `<h2>Seating</h2><p class="status"><b>${esc(nameOf(m.draw.winner))}</b> is arranging who sits next to whom.</p>${timerHTML(m.deadline, T.seatOrder)}`;
      if (!App.seatOrder) { const l = m.lobby.slice(); const i = l.indexOf(me); App.seatOrder = [...l.slice(i), ...l.slice(0, i)]; }
      return `<h2>Arrange the seats</h2><p style="margin:0">You drew highest. Set the clockwise order, starting from you.</p>
      <ol class="order">${App.seatOrder.map((u, i) => `<li><span>${i + 1}. ${esc(nameOf(u))}${u === me ? ' (you)' : ''}</span>${i > 1 ? `<button data-a="seat-up" data-i="${i}" aria-label="Move ${esc(nameOf(u))} earlier">↑</button>` : ''}${i > 0 && i < App.seatOrder.length - 1 ? `<button data-a="seat-down" data-i="${i}" aria-label="Move ${esc(nameOf(u))} later">↓</button>` : ''}</li>`).join('')}</ol>
      <button class="btn gold" data-a="seat-confirm" ${App.pending ? 'disabled' : ''}>Confirm seating</button>${timerHTML(m.deadline, T.seatOrder)}`; }
    case 'DEALING': {
      const dealerU = m.seats[m.dealer], r = m.dealTo, ru = m.seats[r], left = m.quotas[r] - m.dealt[r];
      const prog = `<div class="prog">${m.seats.map((u, i) => `<span>${esc(nameOf(u))}</span><span class="bar"><i style="width:${100 * m.dealt[i] / m.quotas[i]}%"></i></span><span>${m.dealt[i]}/${m.quotas[i]}</span>`).join('')}</div>`;
      if (dealerU !== me) return `<h2>Dealing</h2>${V7.shufLine(m)}<p class="status"><b>${esc(nameOf(dealerU))}</b> is dealing to ${esc(nameOf(ru))}. You see your own cards as they arrive.</p>${prog}${timerHTML(m.deadline, T.batch)}`;
      if (m.shuf && m.shuf.picked) return V7.planDealHTML(m, ru, left, prog);
      return `<h2>You’re dealing</h2>${V7.shufLine(m)}<p style="margin:0">Next to ${ru === me ? 'you' : '<b>' + esc(nameOf(ru)) + '</b>'}: ${left} card${left > 1 ? 's' : ''} left in their share.</p>
      <div class="stepper"><button data-a="deal-minus" aria-label="One fewer">−</button><output aria-live="polite">${App.dealCount}</output><button data-a="deal-plus" aria-label="One more">+</button></div>
      <div class="row" style="justify-content:center"><button class="btn gold" data-a="deal" ${App.pending ? 'disabled' : ''}>Deal ${App.dealCount}</button><button class="btn alt" data-a="deal-all" ${App.pending ? 'disabled' : ''}>Deal all ${left}</button></div>${V7.dealStyles(left)}
      ${prog}${timerHTML(m.deadline, T.batch)}<div class="tlabel">The deal finishes automatically one card at a time if time runs out.</div>`; }
    case 'TURN': {
      const hi = ledHigh(m), act = m.actor;
      const tbl = m.table.length ? `<div class="trick">${m.table.map((t, k) => playedHTML(m.seats[t.s], t.c, k + 1, hi && hi.s === t.s)).join('')}</div>` : '';
      const head = m.table.length ? `<p style="margin:0">${suitName(m.led)} led. Highest: <b>${short(hi.c)}</b> by ${esc(nameOf(m.seats[hi.s]))}.</p>` : `<p style="margin:0">${m.firstTrick ? 'The Ace of Spades opens.' : 'New trick.'}</p>`;
      const thinking = m.bots[act];
      return `${head}${tbl}<p class="status">${act === me ? '<b>Your turn.</b> You have ' + Math.round((m.turnMs || T.turn) / 1000) + ' seconds.' : thinking ? '🤔 <b>' + esc(nameOf(act)) + '</b> is thinking…' : 'Waiting for <b>' + esc(nameOf(act)) + '</b>.'}</p>${thinking ? '' : timerHTML(m.deadline, m.turnMs || T.turn)}${m.trick && m.trick.rev ? '<p class="note" style="color:var(--marigold)">↩️ Reverse: this trick goes anticlockwise.</p>' : ''}`; }
    case 'CUT_REVEAL': return oldCutHTML(m.transfer, m) + timerHTML(m.deadline, T.reveal);
    case 'TRICK_END': { const hi = ledHigh(m), w = m.seats[hi.s];
      return `<p style="margin:0">Everyone followed ${suitName(m.led)}.</p><div class="trick">${m.table.map((t, k) => playedHTML(m.seats[t.s], t.c, k + 1, t.s === hi.s)).join('')}</div>
      <p class="status">✅ ${w === me ? '<b>You</b> played' : '<b>' + esc(nameOf(w)) + '</b> played'} highest (${short(hi.c)}) and ${w === me ? 'lead' : 'leads'} next.</p>${timerHTML(m.deadline, Engine.T.trickEnd)}`; }
    case 'HAND_END': { const r = m.lastResult, fv = m.finalView;
      return `<h2>Last card played!</h2>
      ${fv ? (fv.kind === 'cut' ? oldCutHTML({ giver: fv.giver, recipient: fv.recipient, table: fv.cards, cut: fv.cut }, m, true) : `<p style="margin:0">Final trick: everyone followed ${suitName(fv.led)}.</p><div class="trick">${fv.cards.map((t, k) => playedHTML(m.seats[t.s], t.c, k + 1, false)).join('')}</div>`) : ''}
      <p class="status">🫏 ${r.uid === me ? '<b>You are</b>' : '<b>' + esc(nameOf(r.uid)) + '</b> is'} left holding cards.</p>${timerHTML(m.deadline, Engine.T.handEnd)}<div class="tlabel">Results in a moment…</div>`; }
    case 'HAND_RESULT': { const r = m.lastResult, humans = m.seats.filter(u => !m.bots[u]), rd = humans.filter(u => m.ready[u]).length;
      return `<div class="ass" aria-hidden="true">🫏</div><h2>${r.uid === me ? 'You are' : esc(nameOf(r.uid)) + ' is'} the Donkey of hand ${r.handNo}</h2><p class="lvl-line">${m.losses[r.uid]} of ${m.target} losses${r.level ? ` · Level ${r.level} Donkey` : ''}</p><p style="margin:0">${esc(r.reason)} ${esc(nameOf(r.uid))} deals next.</p>${titleBlock(m, r)}${V7.handExtras(m)}
      ${scoreChips(m)}<button class="btn gold" data-a="next" ${m.ready[me] || App.pending ? 'disabled' : ''}>${m.ready[me] ? 'Waiting for others' : 'Ready for next hand'}</button><div class="tlabel">${rd}/${humans.length} ready</div>${timerHTML(m.deadline, T.ready)}`; }
    case 'MATCH_RESULT': { const a = m.award;
      return `<div class="award"><div class="cap">${esc(a.date)} · ${esc(a.tz)}</div><h2>Donkey of the Day</h2><div class="who">${esc(nameOf(a.uid))}</div>${m.titleOf && m.titleOf[a.uid] ? `<div class="rank">${esc(m.titleOf[a.uid])}</div>` : ''}${titleBlock(m, m.lastResult, true)}<div class="cap">${m.target} losses in ${m.handNo} hand${m.handNo === 1 ? "" : "s"}</div>${scoresHTML(false)}<div class="cap">Match ${esc(m.matchId)}</div></div>${V7.comeback(m)}
      <div class="row" style="justify-content:center">${App.isHost ? '<button class="btn gold" data-a="rematch">Rematch</button><button class="btn alt" data-a="lobby">Back to lobby</button>' : '<span class="note" style="color:var(--feltMuted)">The host can start a rematch.</span>'}<button class="btn alt" data-a="copy-result">Copy result</button>${App.local ? '' : '<button class="btn alt" data-a="fun-hall">🫏 Hall of Shame</button>'}</div>`; }
    case 'PAUSED': return `<h2>Paused</h2><p>${m.pauseFor === me ? 'Two of your moves were made automatically. Resume to keep playing.' : 'Waiting for <b>' + esc(nameOf(m.pauseFor)) + '</b>. Two of their moves were made automatically.'}</p>${m.pauseFor === me ? '<button class="btn gold" data-a="resume">Resume playing</button>' : ''}${timerHTML(m.deadline, T.pause)}<div class="tlabel">If time runs out, the match ends without an award.</div>`;
    case 'INCOMPLETE': return `<h2>Match ended</h2><p>${esc(m.incompleteReason || '')} No Donkey of the Day is awarded for an unfinished match. Completed hands stay in the score table.</p>${scoreChips(m)}
      ${App.isHost ? '<div class="row" style="justify-content:center"><button class="btn gold" data-a="rematch">Rematch</button><button class="btn alt" data-a="lobby">Back to lobby</button></div>' : ''}`;
  }
  return '';
}
function playedHTML(u, c, ord, hi, compact) {
  return `<div class="played ${hi ? 'hi' : ''} ${compact ? 'cmp' : ''}" style="--c:${colorOf(u)}">${ord !== '' ? `<span class="ord" aria-label="${ord === 'cut' ? 'Cut card' : 'Played ' + ord}">${ord === 'cut' ? '✂' : ord}</span>` : ''}${cardStatic(c, compact ? 'sm' : 'lg')}<span class="who">${avatar(u)}<span>${u === App.uid ? 'You' : esc(shortName(u))}</span></span>${hi ? '<span class="hitag">Highest</span>' : ''}</div>`;
}
function historyHTML(m, u, max, mine) {
  const h = ((m.playedBy || {})[u] || []); if (!h.length) return mine ? '' : '';
  const cur = m.trick ? m.trickNo : null; const list = h.slice(-max);
  return `<div class="hist" aria-label="${mine ? 'You' : esc(nameOf(u))} played">${mine ? '<span class="note">You played</span>' : ''}${h.length > max ? '<span class="more">…</span>' : ''}${list.map(p => `<span class="hcard k-${p.k} ${m.table && m.table.some(t => t.c === p.c) ? 'now' : ''}" title="${p.k === 'cut' ? 'Cut' : p.k === 'lead' ? 'Led' : 'Followed'}: ${cardName(p.c)}">${cardStatic(p.c, 'mini')}</span>`).join('')}</div>`;
}
function oldCutHTML(t, m, past) {
  const me = App.uid, g = m.seats[t.giver], rc = m.seats[t.recipient], all = [...t.table.map(x => x.c), ...t.cut];
  return `<h2>${g === me ? 'You' : esc(nameOf(g))} cut</h2><p style="margin:0">${rc === me ? '<b>You</b> pick' : '<b>' + esc(nameOf(rc)) + '</b> picks'} up ${all.length} cards: the table pile and ${t.cut.length} ${suitName(t.cut[0][0])}.${past ? '' : ' ' + (g === me ? 'You lead' : esc(nameOf(g)) + ' leads') + ' next.'}</p>
  <div class="trick" style="max-height:44vh;overflow:auto">${t.table.map((x, k) => playedHTML(m.seats[x.s], x.c, k + 1, x.s === t.recipient)).join('')}${t.cut.map(c => playedHTML(g, c, 'cut', false)).join('')}</div>`;
}
function transferHTML(t, m, past) {
  const g = m.seats[t.giver], rc = m.seats[t.recipient], total = t.table.length + t.cut.length, me = App.uid;
  const cs = t.cut[0][0];
  return `<div class="xfer" style="--g:${colorOf(g)};--r:${colorOf(rc)}">
    <div class="xflow"><span class="xp g">${avatar(g)}<b>${g === me ? 'You' : esc(nameOf(g))}</b><small>cut</small></span>
      <span class="xarrow" aria-hidden="true"><i></i><em>✂️ ${t.cut.length} ${suitName(cs)} + ${t.table.length} from table</em></span>
      <span class="xp r">${avatar(rc)}<b>${rc === me ? 'You' : esc(nameOf(rc))}</b><small>picks up ${total}</small></span></div>
    <p class="xwhy">No ${suitName(t.table[0].c[0])} left, so ${g === me ? 'you' : esc(nameOf(g))} cut. ${rc === me ? 'You' : esc(nameOf(rc))} played the highest ${suitName(t.table[0].c[0], true)}, so ${rc === me ? 'you take' : 'takes'} everything. ${past ? '' : (g === me ? 'You lead' : esc(nameOf(g)) + ' leads') + ' next.'}</p>
    <div class="xgroups"><div class="xg"><div class="xgh">From the table</div><div class="trick">${t.table.map((x, k) => playedHTML(m.seats[x.s], x.c, k + 1, x.s === t.recipient)).join('')}</div></div>
    <div class="xg cutg"><div class="xgh">✂️ Cut by ${g === me ? 'you' : esc(nameOf(g))}: ${t.cut.length} ${suitName(cs)}</div><div class="trick">${t.cut.map(c => playedHTML(g, c, 'cut', false)).join('')}</div></div></div></div>`;
}
function playerSheetHTML() {
  const m = App.pub.match, u = App.sheetUid; if (!m || !m.names[u]) return '';
  const h = (m.playedBy || {})[u] || [], byTrick = {}; h.forEach(p => (byTrick[p.t] = byTrick[p.t] || []).push(p));
  const r = m.counts ? Engine.estimate(m, App.uid, m.names[App.uid] ? App.hand : []).rows.find(x => x.u === u) : null;
  const lbl = { lead: 'Led', follow: 'Followed', cut: 'Cut' };
  return `<div class="row">${avatar(u)}<h2 style="margin:0">${esc(nameOf(u))}</h2></div>
   ${Fun.throwRow(u)}
   <p>${m.losses[u]} of ${m.target} losses${m.titleOf && m.titleOf[u] ? ` · <span class="lvlbadge">L${(m.levelOf || {})[u]}</span> ${esc(m.titleOf[u])}` : ''}${m.counts ? ` · ${m.counts[u]} cards now` : ''}</p>
   ${r ? `<h3 style="font-size:20px">Chance of having none</h3><div class="row">${Engine.SUITS.map(x => `<span class="rk ${r.pv[x] >= .6 ? 'hot' : r.pv[x] >= .25 ? 'warm' : ''}">${SUITSYM[x]} ${suitName(x).split(' ')[0]} ${r.shown[x] ? '✂️ 100%' : pct(r.pv[x])}</span>`).join('')}</div>` : ''}
   <h3 style="font-size:20px;margin-top:14px">Played this hand</h3>
   ${h.length ? Object.entries(byTrick).map(([t, ps]) => `<div class="ev"><span class="note" style="width:64px">Trick ${t}</span>${ps.map(p => `<span class="hl k-${p.k}">${lbl[p.k]} ${cardStatic(p.c, 'mini')}</span>`).join('')}</div>`).join('') : '<p class="note">Nothing yet this hand.</p>'}
   ${r && r.known.length ? `<p class="note" style="margin-top:10px">Still holding from a pickup: ${r.known.map(short).join(' ')}</p>` : ''}`;
}
function titleBlock(m, r, compact) {
  if (!r || !r.title) return '';
  const me = App.uid, mine = r.uid === me, seated = !!m.names[me];
  let h = compact ? '' : `<p class="status" style="margin:4px 0">${mine ? 'You are' : esc(nameOf(r.uid)) + ' is'} now <span class="lvlbadge">L${r.level || '?'}</span> <b>${esc(r.title)}</b></p>`;
  if (compact) return h;
  if (mine) h += '<p class="note" style="color:var(--feltMuted);margin:0">The others can rename you.</p>';
  else if (seated) h += `<div class="row" style="justify-content:center">${(r.titleOptions || []).map(o => `<button class="btn alt small" data-a="crown" data-t="${esc(o)}" ${App.pending ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    <div class="row" style="justify-content:center"><input id="rename" class="t" maxlength="40" placeholder="Or type a name" style="max-width:220px;color:var(--ink)"><button class="btn small" data-a="rename" ${App.pending ? 'disabled' : ''}>Rename</button></div>`;
  if (r.crownedBy) h += `<p class="note" style="color:var(--feltMuted);margin:0">Named by ${esc(nameOf(r.crownedBy))}</p>`;
  return h;
}
function unreadBadge() { const n = App.chatList().length - App.chatSeen; return n > 0 && !App.chatOpen ? ` <span class="unread">${n > 9 ? '9+' : n}</span>` : ''; }
function renderChat() {
  const el = $('#chat'); const show = App.view === 'room' && !!App.pub;
  el.classList.toggle('hidden', !show); if (!show) return;
  el.classList.toggle('open', App.chatOpen);
  const list = App.chatList(); if (App.chatOpen || window.matchMedia('(min-width: 900px)').matches) App.chatSeen = list.length;
  const box = $('#chatlist'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = list.length ? list.map(x => `<div class="cmsg ${x.u === App.uid ? 'mine' : ''}" style="--c:${colorOf(x.u)}"><span class="from">${avatar(x.u)}${x.u === App.uid ? 'You' : esc(nameOf(x.u))}</span><span class="txt">${esc(x.x)}</span>${x.u !== App.uid && !App.local && x.id ? `<span class="mod"><button class="lnk" data-a="report" data-id="${esc(x.id)}" title="Report this message" aria-label="Report this message">Report</button><button class="lnk" data-a="mute-user" data-u="${esc(x.u)}" title="Mute or unmute this player on this device" aria-label="Mute this player">Mute</button></span>` : ''}</div>`).join('')
    : `<p class="note">No messages yet. Say hello to the table.</p>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
  const lastMsg = list[list.length - 1], key = lastMsg ? lastMsg.u + ':' + lastMsg.t : '';
  if (key !== App.lastChatKey) { const first = App.lastChatKey == null; App.lastChatKey = key;
    const cl = document.querySelector('.chatline'); if (cl) cl.outerHTML = chatLineHTML();
    if (!first && lastMsg) App.showBubble(lastMsg.u, lastMsg.x); }
  const tz = $('#teases'), mm = App.pub.match, ppl = mm ? (mm.seats || mm.lobby) : (App.pub.lobby.members || []).map(x => x.uid);
  if (!ppl.includes(App.teaseTarget)) App.teaseTarget = ppl.find(u => u !== App.uid) || '';
  tz.innerHTML = `<label class="note" for="teaseto">Tease</label><select id="teaseto" class="lvl" data-change="tease-to">${ppl.filter(u => u !== App.uid).map(u => `<option value="${esc(u)}" ${u === App.teaseTarget ? 'selected' : ''}>${esc(nameOf(u))}</option>`).join('')}</select>
    <div class="teaserow">${TEASES.map(t => `<button class="chip2" data-a="tease" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  document.querySelectorAll('.unread').forEach(u => u.remove());
  const n = list.length - App.chatSeen;
  if (n > 0) document.querySelectorAll('[data-a="chat"]').forEach(b => b.insertAdjacentHTML('beforeend', ` <span class="unread">${n > 9 ? '9+' : n}</span>`));
}
/* ---------- table story ---------- */
const EV_ICON = { cut: '✂️', clean: '✅', out: '🏁', donkey: '🫏', auto: '⏱️', crown: '👑' };
function evAge(e) { return Date.now() - (e.t + App.offset); }
function who(u) { return u === App.uid ? 'You' : esc(nameOf(u)); }
function eventText(e) {
  switch (e.k) {
    case 'cut': return `${who(e.u)} cut ${e.n} ${suitName(e.suit)} on the ${suitName(e.led)} trick. ${who(e.to)} ${e.to === App.uid ? 'pick' : 'picks'} up ${e.total}.`;
    case 'clean': return `Everyone followed ${suitName(e.suit)}. ${who(e.u)} played highest (${short(e.c)}) and ${e.u === App.uid ? 'lead' : 'leads'}.`;
    case 'out': return `${who(e.u)} ${e.u === App.uid ? 'are' : 'is'} out of cards and safe this hand.`;
    case 'donkey': return `${who(e.u)} ${e.u === App.uid ? 'are' : 'is'} the Donkey: loss ${e.losses}${e.title ? ', now ' + esc(e.title) : ''}.`;
    case 'auto': return `${who(e.u)} ran out of time, so a move was made automatically.`;
    case 'crown': return `${who(e.u)} crowned ${who(e.to)} as ${esc(e.title)}.`;
    default: return V7.evText(e);
  }
}
function evRow(e) {
  return `<div class="ev ev-${e.k}"><span class="evi" aria-hidden="true">${EV_ICON[e.k] || '•'}</span>${avatar(e.u)}${e.to ? '<span class="arrow" aria-hidden="true">→</span>' + avatar(e.to) : ''}<span class="evt">${eventText(e)}</span>${e.k === 'cut' ? `<span class="evcards">${e.cards.map(c => cardStatic(c, 'mini')).join('')}</span>` : ''}</div>`;
}
function bubbleHTML(u) {
  const b = App.bubbles[u]; if (!b) return ''; const age = Date.now() - b.at; if (age > 4500) { delete App.bubbles[u]; return ''; }
  return `<span class="bubble" style="animation-delay:-${age}ms">${esc(b.x.length > 60 ? b.x.slice(0, 58) + '…' : b.x)}</span>`;
}
function chatLineHTML() {
  const l = App.chatList(), x = l[l.length - 1];
  return `<button class="chatline" data-a="chat" aria-label="Open table chat">💬 ${x ? `${avatar(x.u)}<b>${x.u === App.uid ? 'You' : esc(shortName(x.u))}</b><span>${esc(x.x)}</span>` : '<span>Table chat: players and watchers all see messages here</span>'}</button>`;
}
function stripHTML(m) {
  const evs = (m.events || []).filter(e => e.h === m.handNo).slice(-6).reverse();
  return `<div class="strip"><button class="chip" data-a="tracker">📋 Tracker</button><button class="chip" data-a="story">📜 Story</button>
  <div class="stripevs" aria-label="Recent events">${evs.map(e => `<span class="sev" style="--c:${colorOf(e.u)}" title="${eventText(e).replace(/<[^>]+>/g, '')}">${EV_ICON[e.k]}${avatar(e.u)}${e.k === 'cut' ? `<b>+${e.total}</b>${avatar(e.to)}` : ''}</span>`).join('') || '<span class="note" style="color:var(--feltMuted)">Events of this hand appear here.</span>'}</div></div>`;
}
function bannerHTML(m) {
  if (!['TURN', 'CUT_REVEAL'].includes(m.phase)) return '';
  const e = (m.events || []).slice(-1)[0]; if (!e || e.h !== m.handNo || evAge(e) > 7000 || !['cut', 'out', 'clean'].includes(e.k)) return '';
  if (m.phase === 'CUT_REVEAL' && e.k === 'cut') return '';
  const age = Math.max(0, evAge(e));
  return `<div class="banner b-${e.k}" style="animation-delay:-${age}ms;--c:${colorOf(e.u)}"><span class="bi" aria-hidden="true">${EV_ICON[e.k]}</span>${avatar(e.u)}${e.to ? '<span class="arrow">→</span>' + avatar(e.to) : ''}<span>${eventText(e)}</span></div>`;
}
function fxHTML(m, u) {
  const evs = (m.events || []).filter(e => e.h === m.handNo && evAge(e) < 6000 && (e.u === u || e.to === u)).slice(-1);
  return evs.map(e => { const age = Math.max(0, evAge(e)); let t = '';
    if (e.k === 'cut' && e.to === u) t = `📦 +${e.total}`; else if (e.k === 'cut') t = `✂️ ${e.n}`; else if (e.k === 'out') t = '🏁 Safe'; else if (e.k === 'auto') t = '⏱️ Auto'; else if (e.k === 'clean') t = '✅ Leads';
    return t ? `<span class="fx fx-${e.k}${e.to === u ? '-to' : ''}" style="animation-delay:-${age}ms">${t}</span>` : ''; }).join('');
}
function storyHTML() {
  const m = App.pub.match, evs = (m.events || []).slice().reverse();
  if (!evs.length) return '<p class="note">Cuts, pickups and escapes appear here as they happen.</p>';
  let h = '', last = null;
  evs.forEach(e => { if (e.h !== last) { h += `<h3 style="font-size:20px;margin-top:12px">Hand ${e.h}</h3>`; last = e.h; } h += evRow(e); });
  return `<div class="story">${h}</div>`;
}

/* ---------- tracker: what everyone could be holding ---------- */
function trackerData(m) { return Engine.estimate(m, App.uid, m.names[App.uid] ? App.hand : []); }
const pct = p => Math.round(p * 100) + '%';
const RK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }; const rk = r => RK[r] || String(r);
function riskHTML(m) {
  if (m.phase !== 'TURN' || !m.table.length || !m.trick) return '';
  const d = trackerData(m), rest = m.trick.order.slice(m.trick.pos + 1).map(i => m.seats[i]);
  const items = rest.map(u => { const r = d.rows.find(x => x.u === u); return r ? { u, p: r.pv[m.led] } : null; }).filter(Boolean);
  if (!items.length) return '<div class="risk">You play last in this trick, so nobody can cut after you.</div>';
  return `<div class="risk">Could cut after you: ${items.map(x => `<span class="rk ${x.p >= .6 ? 'hot' : x.p >= .25 ? 'warm' : ''}">${avatar(x.u)}${esc(nameOf(x.u))} ${pct(x.p)}</span>`).join('')}</div>`;
}
function checklist(m, d) {
  const out = [], mine = App.hand, S = Engine.SUITS;
  if ((m.targets || []).length) out.push(['🎯', `Pro bots are ganging up on ${m.targets.map(who).join(' and ')}.`]);
  S.forEach(x => { const my = mine.filter(c => c[0] === x); if (!my.length) return;
    if (d.otherCount[x] === 0) out.push(['⚠️', `Nobody else has any ${suitName(x)}. If you lead it, the next player cuts onto you.`]);
    else { const myTop = Math.max(...my.map(Engine.rankOf)); if (myTop > d.top[x]) out.push(['👑', `You hold the top ${suitName(x, true)} still in play (${rk(myTop)}). Playing it makes you the pickup target if someone is out of ${suitName(x)}.`]); } });
  d.rows.forEach(r => { const sh = Object.keys(r.shown); if (sh.length) out.push(['✂️', `${who(r.u)} has shown no ${sh.map(x => suitName(x)).join(' or ')} by cutting.`]);
    S.filter(x => !r.shown[x] && r.pv[x] >= .6).forEach(x => out.push(['🔎', `${who(r.u)} is probably out of ${suitName(x)} (${pct(r.pv[x])}).`])); });
  d.rows.filter(r => r.count <= 2).forEach(r => out.push(['🏁', `${who(r.u)} has ${r.count} card${r.count === 1 ? '' : 's'} left and may escape soon.`]));
  d.rows.filter(r => r.known.length).forEach(r => out.push(['📦', `${who(r.u)} still holds ${r.known.map(short).join(' ')} from a pickup.`]));
  const most = d.rows.reduce((a, r) => Math.max(a, r.count), 0); if (mine.length > most && mine.length) out.push(['🫏', `You hold the most cards (${mine.length}). Shed high cards whenever nobody can cut after you.`]);
  return out;
}
function trackerHTML() {
  const m = App.pub.match;
  if (!m || !m.counts || !['TURN', 'CUT_REVEAL'].includes(m.phase)) return '<p class="note">The tracker fills in once cards are being played.</p>';
  const d = trackerData(m), S = Engine.SUITS;
  const cell = (r, x) => { const p = r.pv[x]; const cls = r.shown[x] ? 'sure' : p >= .6 ? 'hot' : p >= .25 ? 'warm' : 'cool';
    return `<td class="pv ${cls}" title="${who(r.u)}: chance of having no ${suitName(x)}${r.why[x] === 'pattern' ? ', raised from ' + pct(r.base[x]) + ' by their play pattern' : ''}">${r.shown[x] ? '✂️ 100%' : pct(p)}${r.why[x] === 'pattern' ? '<sup>↑</sup>' : ''}</td>`; };
  const pats = [];
  d.rows.forEach(r => { Engine.SUITS.forEach(x => { if (r.why[x] !== 'pattern') return;
      const led = ((m.ledBy || {})[r.u] || {})[x] || 0, cutw = ((m.cutWith || {})[r.u] || {})[x] || 0, hi = ((m.highBy || {})[r.u] || {})[x] || 0;
      pats.push(`${who(r.u)} has ${[led ? `led ${suitName(x)} ${led === 1 ? 'once' : led + ' times'}` : '', cutw ? `cut with ${suitName(x)}` : '', hi ? `thrown a high ${suitName(x, true)} they didn’t need to (so they kept small ones or are about to run out)` : ''].filter(Boolean).join(' and ')} this hand. People usually shed the suits they hold few of, so the chance they have none goes from ${pct(r.base[x])} to <b>${pct(r.pv[x])}</b>.`); });
    const sty = (m.style || {})[r.u]; if (sty && sty.hi >= 2) pats.push(`${who(r.u)}’s high-card habit: ${sty.hiCut || 0} of ${sty.hi} suits where they threw a high card were later cut. The tracker trusts this signal ${r.hw >= .5 ? 'a lot' : r.hw >= .25 ? 'somewhat' : 'only a little'} for them.`);
    if (sty && sty.led >= 2) pats.push(`${who(r.u)}’s habit this match: later cut on ${sty.shed} of the ${sty.led} suits they led (pattern weight ×${r.lam.toFixed(1)}).`); });
  const cl = checklist(m, d);
  return `<p class="note">Each figure is the chance that a player has <b>no</b> cards of that suit, so they would cut if it’s led. Worked out from your hand, everything played, cuts shown and cards picked up in the open, then adjusted (marked ↑) by how each player has been leading and cutting. Estimates, not certainties.</p>
  <div style="overflow-x:auto"><table class="trk"><thead><tr><th>Player</th><th>Cards</th>${S.map(x => `<th>${SUITSYM[x]}<br><span class="note">${suitName(x).split(' ')[0]}</span></th>`).join('')}</tr></thead>
  <tbody>${d.rows.map(r => `<tr><td>${avatar(r.u)} ${who(r.u)}</td><td>${r.count}${r.known.length ? `<div class="kn">${r.known.map(c => cardStatic(c, 'mini')).join('')}</div>` : ''}</td>${S.map(x => cell(r, x)).join('')}</tr>`).join('')}</tbody></table></div>
  ${riskHTML(m) ? `<h3 style="font-size:20px;margin-top:14px">This trick</h3>${riskHTML(m)}` : ''}
  ${pats.length ? `<h3 style="font-size:20px;margin-top:14px">Patterns spotted</h3><ul class="check">${pats.map(t => `<li><span aria-hidden="true">🧠</span><span>${t}</span></li>`).join('')}</ul>` : ''}
  <h3 style="font-size:20px;margin-top:14px">Worth remembering</h3>
  <ul class="check">${cl.length ? cl.map(([i, t]) => `<li><span aria-hidden="true">${i}</span><span>${t}</span></li>`).join('') : '<li><span>•</span><span>Nothing stands out yet. Watch for the first cut.</span></li>'}</ul>
  <h3 style="font-size:20px;margin-top:14px">Cards still out, by suit</h3>
  <p class="note">${S.map(x => `${SUITSYM[x]} ${suitName(x).split(' ')[0]}: ${d.otherCount[x]} with others${d.top[x] ? ', highest ' + rk(d.top[x]) : ''}`).join('<br>')}</p>`;
}
function conspiracyHTML(L, H) {
  const pros = L.members.filter(x => x.bot && x.level === 'pro').length, T = L.targets || [];
  if (!H) return T.length ? `<section class="blk"><h2>Bot conspiracy</h2><p>🎯 Pro bots are ganging up on <b>${T.map(u => esc(nameOf(u))).join(', ')}</b>.${L.hints ? ' Everyone else gets whispered hints.' : ''}</p></section>` : '';
  return `<section class="blk"><h2>Bot conspiracy</h2><p class="note">Pro bots team up against the players you pick. They share what the targets hold, steer pickups onto them and go easy on everyone else. Targets are shown to the whole table.</p>
  <ul class="list">${L.members.map(x => `<li>${avatar(x.uid)}<span class="grow">${esc(x.name)}${x.uid === App.uid ? ' (you)' : ''}</span><button class="btn small ${T.includes(x.uid) ? 'gold' : 'alt'}" data-a="target" data-u="${esc(x.uid)}" aria-pressed="${T.includes(x.uid)}">${T.includes(x.uid) ? '🎯 Target' : 'Make target'}</button></li>`).join('')}</ul>
  <div class="row" style="margin-top:10px"><span>Whisper hints to everyone else</span><span class="seg"><button data-a="hints" data-k="1" aria-pressed="${L.hints}">On</button><button data-a="hints" data-k="0" aria-pressed="${!L.hints}">Off</button></span></div>
  ${T.length && !pros ? '<p class="err">No bot is set to Pro, so nobody is conspiring yet.</p>' : ''}</section>`;
}
function scoreChips(m) {
  const rows = (m.seats || m.lobby).slice().sort((a, b) => m.losses[b] - m.losses[a]);
  return `<div class="scorechips" aria-label="Losses">${rows.map(u => `<span class="sc">${avatar(u)}${u === App.uid ? 'You' : esc(shortName(u))} <b>${m.losses[u]}</b></span>`).join('')}</div>`;
}
function scoresHTML(full) {
  const m = App.pub.match; if (!m) return '';
  const rows = (m.seats || m.lobby).slice().sort((a, b) => m.losses[b] - m.losses[a]);
  return `<table class="scores"><thead><tr><th>Player</th><th>Losses</th></tr></thead><tbody>${rows.map(u => `<tr><td>${esc(nameOf(u))}</td><td>${m.losses[u]}</td></tr>`).join('')}</tbody></table>
  ${full && m.history.length ? `<h3 style="font-size:20px;margin-top:14px">Hand by hand</h3><ol>${m.history.map(h => `<li>Hand ${h.handNo}: ${esc(nameOf(h.uid))}</li>`).join('')}</ol>` : ''}
  ${full ? V7.statsHTML(m) : ''}
  ${full ? `<h3 style="font-size:20px;margin-top:14px">Recent events</h3><ul>${m.log.slice().reverse().map(l => `<li>${fmtLog(l)}</li>`).join('')}</ul>` : ''}`;
}
function myTurnInfo(m) {
  if (m.phase !== 'TURN' || m.actor !== App.uid) return null;
  const h = App.hand;
  if (!m.table.length) return { lead: true, legal: m.firstTrick ? ['S_A'] : h.slice() };
  const f = h.filter(c => c[0] === m.led); return f.length ? { legal: f } : { cut: true, legal: h.slice() };
}
function handHTML(m) {
  if (m.phase === 'DEALING') { let pv = null; return `<div class="hand" role="group" aria-label="Cards dealt to you so far">${App.hand.map(c => { const gap = pv && pv !== c[0] ? '<span class="gap"></span>' : ''; pv = c[0]; return gap + cardStatic(c); }).join('') || '<span class="note" style="padding:20px 0">Your cards appear here as they’re dealt.</span>'}</div>`; }
  const info = myTurnInfo(m); let prev = null;
  return `<div class="hand" role="group" aria-label="Your hand">${App.hand.map(c => { const gap = prev && prev !== c[0] ? '<span class="gap"></span>' : ''; prev = c[0];
    const dim = info && !info.legal.includes(c); return gap + cardHTML(c, dim ? 'dim' : '', `aria-pressed="${App.sel.includes(c)}"`); }).join('')}</div>`;
}
function actionsHTML(m) {
  const info = myTurnInfo(m); if (!info) return '';
  return (info.cut ? '' : riskHTML(m)) + (App.hint ? `<div class="whisper" role="note">🤫 ${fmtLog(App.hint)}</div>` : '') + actionsCore(m, info);
}
function actionsCore(m, info) {
  const sel = App.sel, busy = !!App.pending;
  if (info.cut) {
    const hi = ledHigh(m), rec = nameOf(m.seats[hi.s]), s = sel[0] && sel[0][0];
    const suits = [...new Set(App.hand.map(c => c[0]))];
    return `<div class="actions cutbar"><div class="msg">✂️ No ${suitName(m.led)}: cut cards of one suit to <b>${esc(rec)}</b> (highest ${suitName(m.led, true)}).</div>
    ${suits.map(x => `<button class="btn alt small" style="color:var(--ink)" data-a="cut-all" data-s="${x}" aria-label="Select all ${suitName(x)}">All ${SUITSYM[x]}</button>`).join('')}
    ${sel.length ? '<button class="btn alt small" style="color:var(--ink)" data-a="clear">Clear</button>' : ''}<button class="btn gold" data-a="cut" ${sel.length && !busy ? '' : 'disabled'} aria-label="${sel.length ? `Give ${sel.length} ${suitName(s)}` : 'Select cards to give'}">${sel.length ? `Give ${sel.length} ${SUITSYM[s]}` : 'Select cards'}</button></div>`;
  }
  const c = sel[0], ok = c && info.legal.includes(c);
  const why = c && !ok ? (m.table.length ? `You still have ${suitName(m.led)}.` : 'Open with the Ace of Spades.') : (info.lead ? (m.firstTrick ? 'Play the Ace of Spades to open.' : 'You lead. Play any card.') : `Follow ${suitName(m.led)}.`);
  return `<div class="actions"><div class="msg ${c && !ok ? 'err' : ''}">${why}</div><button class="btn gold" data-a="play" ${ok && !busy ? '' : 'disabled'}>${c ? 'Play ' + short(c) : 'Select a card'}</button></div>`;
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const cardEl = e.target.closest('.hand [data-card]');
  if (cardEl) { const c = cardEl.dataset.card, m = App.pub && App.pub.match, info = m && myTurnInfo(m); if (!info) return;
    if (info.cut) { if (App.sel.length && App.sel[0][0] !== c[0]) App.sel = [c]; else App.sel = App.sel.includes(c) ? App.sel.filter(x => x !== c) : [...App.sel, c]; }
    else App.sel = App.sel[0] === c ? [] : [c];
    App.render(); return; }
  const b = e.target.closest('[data-a]'); if (!b) { if (e.target.id === 'sheet') App.closeSheet(); return; }
  const a = b.dataset.a, m = App.pub && App.pub.match;
  switch (a) {
    case 'create': App.createRoom(); break;
    case 'join': App.joinRoom($('#code').value); break;
    case 'rejoin': { const l = LS.get('dotd-last'); if ($('#nm') && !$('#nm').value) $('#nm').value = l.name || ''; App.joinRoom(l.code); break; }
    case 'practice': App.startPractice(+b.dataset.n); break;
    case 'plevel': App.practiceLevel = b.dataset.k; LS.set('dotd-botlevel', App.practiceLevel); App.render(); break;
    case 'suits': App.suitMode = b.dataset.k; LS.set('dotd-suits', App.suitMode); App.render(); if (App.sheet) App.renderSheet(); break;
    case 'pick-src': App.setMusic({ src: b.dataset.src }); break;
    case 'next-song': { const mu = App.pub.music, list = [...CATALOG.map(t => ({ track: t.id, key: 's:' + t.id })), ...(App.pub.lobby.public ? [] : App.songList().map(x => ({ song: { id: x.id, title: x.title }, key: 'g:' + x.id })))];
      const cur = mu.kind === 'song' ? 'g:' + mu.song.id : 's:' + mu.track, i = list.findIndex(x => x.key === cur), nx = list[(i + 1) % list.length];
      App.send('SET_MUSIC', nx.song ? { song: nx.song } : { track: nx.track }); if (Music.state !== 'on' && App.musicPick.src !== 'own') App.enableAudio(); setTimeout(() => App.renderSheet(), 120); break; }
    case 'set-track': App.send('SET_MUSIC', { track: b.dataset.t }); setTimeout(() => App.renderSheet(), 80); break;
    case 'set-song': App.send('SET_MUSIC', { song: { id: b.dataset.id, title: b.dataset.t } }); setTimeout(() => App.renderSheet(), 80); break;
    case 'watch': App.joinRoom($('#code').value, true); break;
    case 'watch-instead': App.joinRoom(App.code, true); break;
    case 'speed': App.send('SET_BOT_SPEED', { speed: b.dataset.k }); break;
    case 'series': App.send('SET_TARGET', { n: +b.dataset.n }); break;
    case 'player': App.sheetUid = b.dataset.u; App.openSheet('player'); break;
    case 'rename': { const v = $('#rename') && $('#rename').value; App.send('CROWN', { name: v }); break; }
    case 'tease': { const t = App.teaseTarget, line = b.dataset.t; App.sendChat((t ? '@' + nameOf(t) + ' ' : '') + line); break; }
    case 'chat': App.chatOpen = !App.chatOpen; renderChat(); if (App.chatOpen) setTimeout(() => $('#chatin').focus(), 50); App.render(); break;
    case 'chat-close': App.chatOpen = false; renderChat(); App.render(); break;
    case 'chat-send': App.sendChat($('#chatin').value); $('#chatin').value = ''; break;
    case 'titles-on': App.send('SET_TITLES', { on: b.dataset.k === '1' }); break;
    case 'crown': App.send('CROWN', { name: b.dataset.t }); break;
    case 'tracker': App.openSheet('tracker'); break;
    case 'story': App.openSheet('story'); break;
    case 'target': { const L = App.pub.lobby, u = b.dataset.u; const t = L.targets.includes(u) ? L.targets.filter(x => x !== u) : [...L.targets, u]; App.send('SET_CONSPIRACY', { targets: t }); break; }
    case 'hints': App.send('SET_CONSPIRACY', { hints: b.dataset.k === '1' }); break;
    case 'help': App.openSheet('help'); break;
    case 'menu': App.openSheet('menu'); break;
    case 'music': App.openSheet('music'); break;
    case 'scores': App.openSheet('scores'); break;
    case 'leave': App.openSheet('leave'); break;
    case 'close-sheet': App.closeSheet(); break;
    case 'leave-now': App.leave(); break;
    case 'end-match': App.closeSheet(); App.send('END_MATCH'); break;
    case 'copy-code': try { await navigator.clipboard.writeText(`Join my Donkey of the Day room. Open the game page, choose Join room and enter ${App.code}.`); App.toast('Invite copied.'); } catch (x) { App.toast('Room code: ' + App.code); } break;
    case 'audio': App.enableAudio(); break;
    case 'mute': Music.muted = !Music.muted; Music.applyVol(); App.renderSheet(); App.render(); break;
    case 'fill-bots': App.send('FILL_BOTS'); break;
    case 'share-invite': { const url = location.origin + '/?room=' + App.code, text = 'Join my Donkey of the Day game! Room ' + App.code + ' 🫏';
      if (navigator.share) { try { await navigator.share({ title: 'Donkey of the Day', text, url }); } catch (x) {} } else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener'); break; }
    case 'react-toggle': App.reactOpen = !App.reactOpen; App.render(); break;
    case 'profile': App.openProfile(); break;
    case 'logout': App.googleLogout(); break;
    case 'export-data': App.exportData(); break;
    case 'delete-data': App.deleteData(); break;
    case 'report': App.reportMsg(b.dataset.id); break;
    case 'mute-user': App.muteUser(b.dataset.u); break;
    case 'seats': App.send('SET_SEATS', { n: +b.dataset.n }); break;
    case 'mode': App.send('SET_MODE', { mode: b.dataset.m }); break;
    case 'add-bot': App.send('ADD_BOT'); break;
    case 'remove': App.send('REMOVE', { uid: b.dataset.u }); break;
    case 'start': App.send('START'); break;
    case 'seat-up': case 'seat-down': { const i = +b.dataset.i, j = a === 'seat-up' ? i - 1 : i + 1, o = App.seatOrder; [o[i], o[j]] = [o[j], o[i]]; App.render(); break; }
    case 'seat-confirm': App.send('SET_SEAT_ORDER', { order: App.seatOrder }); break;
    case 'deal-minus': App.dealCount = Math.max(1, App.dealCount - 1); App.render(); break;
    case 'deal-plus': { const r = m.dealTo; App.dealCount = Math.min(m.quotas[r] - m.dealt[r], App.dealCount + 1); App.render(); break; }
    case 'deal': App.send('DEAL_BATCH', { count: App.dealCount }); break;
    case 'deal-all': { const r = m.dealTo; App.send('DEAL_BATCH', { count: m.quotas[r] - m.dealt[r] }); break; }
    case 'play': { const c = App.sel[0]; App.sel = []; App.send('PLAY_CARD', { card: c }); break; }
    case 'cut': { const cs = App.sel.slice(); App.sel = []; App.send('CUT_CARDS', { cards: cs }); break; }
    case 'cut-all': App.sel = App.hand.filter(c => c[0] === b.dataset.s); App.render(); break;
    case 'clear': App.sel = []; App.render(); break;
    case 'next': App.send('READY_NEXT_HAND'); break;
    case 'resume': App.send('RESUME'); break;
    case 'rematch': App.send('REMATCH'); break;
    case 'lobby': App.send('BACK_TO_LOBBY'); break;
    case 'react': Net.emit('react', { e: b.dataset.e }); App.reactOpen = false; if (matchMedia('(max-width:430px)').matches) App.render(); break;
    default: V7.click(a, b) || Fun.click(a, b); break;
    case 'copy-result': { const a2 = m.award, rows = m.seats.map(u => `${nameOf(u)} ${m.losses[u]}`).join(', ');
      const t = `Donkey of the Day: ${nameOf(a2.uid)}${m.titleOf && m.titleOf[a2.uid] ? ' (' + m.titleOf[a2.uid] + ')' : ''}, ${m.target} losses, ${a2.date} (${a2.tz}). Final losses: ${rows}.`;
      try { await navigator.clipboard.writeText(t); App.toast('Result copied.'); } catch (x) { App.toast(t); } break; }
  }
});
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.input === 'v7-cut') { App.cutAt = +e.target.value; const n = $('#cutn'); if (n) n.textContent = App.cutAt; const pile = document.querySelector('.deckpile'); if (pile) pile.outerHTML = V7.deckHTML(52, App.cutAt); return; } if (e.target.id === 'vol') { Music.vol = +e.target.value; Music.applyVol(); } if (e.target.id === 'nm') App.name = e.target.value; });
document.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.set) { if (d.open) App.openSets.add(d.dataset.set); else App.openSets.delete(d.dataset.set); } }, true);
document.addEventListener('change', e => {
  const t = e.target, k = t.dataset && t.dataset.change; if (!k) return;
  if (k === 'plevel') { App.practiceLevel = t.value; LS.set('dotd-botlevel', t.value); }
  if (k === 'v7-secret') App.shufSecret = t.checked;
  if (k === 'v7-peek') App.cutPeek = t.checked;
  if (k === 'song') { App.addSong(t.files && t.files[0]); t.value = ''; }
  if (k === 'public') { App.createPublic = t.checked; }
  if (k === 'tease-to') App.teaseTarget = t.value;
  if (k === 'levels') App.send('SET_TITLES', { levels: [0, 1, 2, 3, 4].map(i => document.getElementById('tl' + i).value) });
  if (k === 'botlevel') App.send('SET_BOT_LEVEL', { uid: t.dataset.u, level: t.value });
  if (k === 'title') App.send('SET_TITLES', { titles: [0, 1, 2, 3, 4].map(i => document.getElementById('tt' + i).value) });
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('seat')) { e.preventDefault(); e.target.click(); return; }
  if (e.key === 'Enter' && e.target.id === 'chatin') { App.sendChat(e.target.value); e.target.value = ''; return; } if (e.key === 'Escape' && App.sheet) App.closeSheet(); if (e.key === 'Enter' && e.target.id === 'code') App.joinRoom(e.target.value); });
let rzT = null; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (App.view === 'room') App.render(); }, 150); });
/* ---------- v6: live commentary, throws, final showdown, Hall of Shame ---------- */
const Fun = {
  set: (() => { const st = Object.assign({ mode: 'teekha', who: 'mix', voice: true, sfx: true }, LS.get('dotd-fun') || {}); if (!st.vv) { st.voice = true; st.vv = 2; LS.set('dotd-fun', st); } return st; })(),
  cur: null, fb: '', mkey: null, lastEv: 0, seen: new Set(), seenHand: 0, lastPick: {}, lastThrow: 0, hall: null, fadeT: null,
  save() { LS.set('dotd-fun', this.set); },
  hash(s) { s = String(s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); },
  persona(seed) { const w = this.set.who; return w === 'mix' ? (seed % 2 ? 'chacha' : 'bablu') : (COMM[w] ? w : 'bablu'); },
  mode() { const s = V7.fun().spice; return s && s !== 'device' ? s : this.set.mode; },
  line(k, seed, vars) {
    const pk = this.persona(seed), P = COMM[pk], jokes = (App.pub && App.pub.lobby && App.pub.lobby.jokes) || [];
    if (jokes.length && ['cut', 'bigcut', 'donkey', 'out', 'award', 'danger', 'clean'].includes(k) && (seed >> 3) % 4 === 0) { const tx = jokes[seed % jokes.length].x.replace(/\{(\w+)\}/g, (_, v) => vars[v] != null ? vars[v] : ''); return { text: tx.charAt(0).toUpperCase() + tx.slice(1), p: pk }; }
    let pool = (P.base[k] || []).slice(); const nb = pool.length; if (this.mode() === 'teekha') pool = pool.concat(P.spicy[k] || []);
    if (!pool.length) return null;
    let i = seed % pool.length; const lk = pk + k; if (pool.length > 1 && this.lastPick[lk] === i) i = (i + 1) % pool.length; this.lastPick[lk] = i;
    const tx = pool[i].replace(/\{(\w+)\}/g, (_, v) => vars[v] != null ? vars[v] : ''); return { text: tx.charAt(0).toUpperCase() + tx.slice(1), p: pk, id: pk + (i < nb ? '.base.' + k + '.' + i : '.spicy.' + k + '.' + (i - nb)) };
  },
  say(k, seed, vars, o = {}) {
    if (this.mode() === 'off') return;
    const pri = o.pri || 0, c = this.cur;
    if (c && Date.now() - c.at < 3000 && (c.pri || 0) > pri) return;
    const l = this.line(k, seed, vars || {}); if (!l) return;
    this.cur = { text: l.text, p: l.p, id: l.id, at: Date.now(), pri, big: pri >= 2 };
    clearTimeout(this.fadeT); this.fadeT = setTimeout(() => this.paint(), 12100);
    if (o.paint) this.paint();
    if (!o.quiet) this.speak(l, pri);
  },
  dirInner(fb) {
    this.fb = fb; const c = this.cur, on = this.mode() !== 'off';
    if (!on) return `<span aria-hidden="true">${fb}</span>`;
    if (!c || Date.now() - c.at > 12000) return `<button class="mic-idle" data-a="fun-comm" aria-label="Commentary settings">🎙️</button><span class="dtext" aria-hidden="true">${fb}</span>`;
    const P = COMM[c.p], age = Math.max(0, Date.now() - c.at);
    return `<button class="mic ${c.big ? 'big' : ''}" data-a="fun-comm" style="animation-delay:-${age}ms" aria-label="${esc(P.name)} says: ${esc(c.text)}. Commentary settings"><span class="mav ${this.talking ? 'talk' : ''}" aria-hidden="true">${P.icon}</span><span class="mname">${esc(P.name)}</span><span class="mline">${esc(c.text)}</span><span class="mvol" aria-hidden="true">${this.set.voice && Commentary.unlocked ? '🔊' : '🔇'}</span></button>`;
  },
  paint() { const el = document.querySelector('#game .dir'); if (el) el.innerHTML = this.dirInner(this.fb); },
  setTalk(on) { this.talking = on; Music.duck = on ? .3 : 1; Music.applyVol(); document.querySelectorAll('.mic .mav').forEach(e => e.classList.toggle('talk', on)); },
  /* a recording plays when the server has one for this line; otherwise the line is text only */
  speak(l, pri) { if (!this.set.voice || !l.id) return; Commentary.play(l.id, pri, on => this.setTalk(on)); },
  sfx(kind) {
    if (!this.set.sfx || !Music.ctx || !Music.noise) return; const c = Music.ctx; try { c.resume(); } catch (e) {}
    const t = c.currentTime + .02, out = c.createGain(); out.gain.value = .5; out.connect(c.destination);
    const tone = (type, f0, f1, at, dur, vol) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + .03); g.gain.exponentialRampToValueAtTime(.0001, t + at + dur); o.connect(g); g.connect(out); o.start(t + at); o.stop(t + at + dur + .05); };
    const noise = (at, dur, vol, ft, fq) => { const s = c.createBufferSource(); s.buffer = Music.noise; const f = c.createBiquadFilter(); f.type = ft; f.frequency.value = fq; const g = c.createGain();
      g.gain.setValueAtTime(vol, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + dur); s.connect(f); f.connect(g); g.connect(out); s.start(t + at, Math.random() * .5); s.stop(t + at + dur + .05); };
    if (kind === 'heehaw') [0, .9].forEach(a => { tone('sawtooth', 560, 760, a, .32, .22); tone('sawtooth', 420, 200, a + .34, .5, .26); });
    if (kind === 'drum') { for (let i = 0; i < 26; i++) noise(i * .055, .05, .05 + i * .012, 'bandpass', 260); noise(1.45, .9, .45, 'highpass', 5000); tone('sine', 90, 45, 1.45, .45, .5); }
    if (kind === 'fanfare') [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f * 1.002, i * .16, i === 3 ? .8 : .2, .28));
    if (kind === 'splat') { noise(0, .18, .5, 'lowpass', 900); tone('sine', 300, 60, 0, .15, .3); }
    if (kind === 'whoosh') noise(0, .35, .16, 'bandpass', 1400);
    if (kind === 'thwack') { noise(0, .08, .7, 'highpass', 1800); tone('square', 180, 90, 0, .08, .18); }
    if (kind === 'ding') { tone('sine', 1320, 1320, 0, .6, .18); tone('sine', 1760, 1760, .12, .6, .12); }
  },
  active(m) { return m.seats && m.finished ? m.seats.filter((u, i) => !m.finished[i]) : []; },
  showdownCls(m) { return m.phase === 'TURN' && m.seats && m.seats.length >= 3 && this.active(m).length === 2 ? 'showdown' : ''; },
  /* called with every new public state, before it is drawn */
  onPub(p) {
    const m = p && p.match; if (!m || !m.matchId) return;
    const sd = String(m.matchId), mk = sd + ':' + (p.hostUid || '');
    if (mk !== this.mkey) { this.mkey = mk; this.lastEv = Math.max(0, ...(m.events || []).map(e => e.id || 0)); this.seen = new Set(); this.seenHand = m.handNo; if (m.award) this.seen.add('aw' + m.award.at); return; }
    if (m.handNo && m.handNo !== this.seenHand) { this.seenHand = m.handNo; this.say('hand', this.hash(sd + 'h' + m.handNo), {}, { quiet: true }); }
    (m.events || []).forEach(e => { if (!e.id || e.id <= this.lastEv) return; this.lastEv = e.id; if (evAge(e) > 15000) return; this.onEvent(m, e, this.hash(sd + ':' + e.id)); });
    const act = this.active(m), sk = 'sd' + m.handNo;
    if (this.showdownCls(m) && !this.seen.has(sk)) { this.seen.add(sk); this.say('showdown', this.hash(sd + sk), { a: V7.nick(act[0]), b: V7.nick(act[1]) }, { pri: 2 }); this.sfx('drum'); }
    if (m.phase === 'MATCH_RESULT' && m.award && !this.seen.has('aw' + m.award.at)) {
      this.seen.add('aw' + m.award.at); this.say('award', this.hash(sd + 'aw'), { u: V7.nick(m.award.uid) }, { pri: 3 }); this.sfx('fanfare');
    }
  },
  onEvent(m, e, seed) {
    const v = { u: V7.nick(e.u), to: e.to ? V7.nick(e.to) : '', n: e.n, total: e.total, suit: e.suit ? SUIT_SETS.hi[e.suit] : '', loss: e.losses, title: e.title || '' };
    switch (e.k) {
      case 'cut': { const big = e.total >= 8; this.say(big ? 'bigcut' : 'cut', seed, v, { pri: big ? 1 : 0 }); this.sfx(big ? 'thwack' : 'whoosh'); break; }
      case 'clean': if (seed % 3 === 0) this.say('clean', seed, v, { quiet: true }); break;
      case 'out': this.say('out', seed, v); break;
      case 'donkey': this.say(e.losses === m.target - 1 ? 'danger' : 'donkey', seed, v, { pri: 2 }); this.sfx('heehaw'); break;
      case 'auto': this.say('auto', seed, v); break;
      case 'crown': this.say('crown', seed, v, { pri: 1 }); break;
    }
  },
  /* ----- throws ----- */
  throwRow(u) {
    const m = App.pub && App.pub.match; if (!m || u === App.uid) return '';
    return `<h3 style="font-size:20px;margin-top:4px">Throw at ${esc(shortName(u))}</h3><div class="throws" role="group" aria-label="Throw something at ${esc(nameOf(u))}">${THROWS.map(t => `<button class="throw" data-a="fun-throw" data-u="${esc(u)}" data-e="${t.e}"><span aria-hidden="true">${t.e}</span>${t.l}</button>`).join('')}</div>`;
  },
  throwAt(to, e) {
    const T = THROWS.find(x => x.e === e), m = App.pub && App.pub.match; if (!T || !to || !m) return;
    if (Date.now() - this.lastThrow < 2500) { App.toast('Thoda ruko! One throw every few seconds.'); return; }
    this.lastThrow = Date.now(); App.closeSheet();
    this.fly(App.uid, to, T); Net.emit('react', { k: 'throw', e, to });
    this.botReply(to, T);
  },
  botReply(to, T) { const m = App.pub && App.pub.match; if (App.local && m && m.bots[to] && Math.random() < .6) { const xs = BOT_HIT[T.n]; setTimeout(() => App.botSay(to, xs[Math.floor(Math.random() * xs.length)]), 1300); } },
  onReact(by, d) {
    if (d && d.k === 'throw') {
      if (by === App.uid) return; const T = THROWS.find(x => x.e === d.e), m = App.pub && App.pub.match;
      if (T && d.to && m && m.names[d.to]) { this.fly(by, d.to, T); this.botReply(d.to, T); } return;
    }
    App.showReaction(by, d && d.e);
  },
  fly(from, to, T) {
    const q = u => document.querySelector(`#game [data-seat="${CSS.escape(u || '')}"]`);
    const a = q(from) || document.querySelector('#game .topbar'), b = q(to); if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x0 = ra.left + ra.width / 2, y0 = ra.top + Math.min(ra.height / 2, 28), x1 = rb.left + rb.width / 2, y1 = rb.top + Math.min(rb.height / 2, 28);
    const nm = u => App.pub && App.pub.match && App.pub.match.names[u] ? shortName(u) : 'Koi';
    this.say('throw', this.hash(from + to + T.e + Math.floor(Date.now() / 4000)), { u: nm(from), to: nm(to), item: T.n }, { quiet: true, paint: true });
    const hit = () => { this.sfx(T.hit); const s = document.createElement('span'); s.className = 'hit hit-' + T.n; s.innerHTML = HITFX[T.n]; s.setAttribute('aria-hidden', 'true');
      s.style.left = x1 + 'px'; s.style.top = y1 + 'px'; document.body.appendChild(s); setTimeout(() => s.remove(), 1900);
      const tb = q(to); if (tb) { tb.classList.add('shake'); setTimeout(() => tb.classList.remove('shake'), 500); } };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !document.body.animate) { hit(); return; }
    const p = document.createElement('span'); p.className = 'proj'; p.textContent = T.e; p.setAttribute('aria-hidden', 'true'); document.body.appendChild(p);
    const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 90;
    const an = p.animate([{ transform: `translate(${x0}px,${y0}px) translate(-50%,-50%) rotate(0deg) scale(.8)` }, { transform: `translate(${mx}px,${my}px) translate(-50%,-50%) rotate(300deg) scale(1.3)`, offset: .5 }, { transform: `translate(${x1}px,${y1}px) translate(-50%,-50%) rotate(620deg) scale(1)` }], { duration: 650, easing: 'cubic-bezier(.3,.1,.5,1)' });
    an.onfinish = () => { p.remove(); hit(); }; setTimeout(() => { if (p.isConnected) { p.remove(); hit(); } }, 1500);
  },
  /* ----- Hall of Shame: kept by the server, shared by every room ----- */
  async loadHall() {
    this.hall = { loading: true }; if (App.sheet === 'hall') App.renderSheet();
    const r = await Net.call('hall'); this.hall = r.error ? { err: true } : { rows: r.rows || [] };
    if (App.sheet === 'hall') App.renderSheet();
  },
  hallHTML() {
    if (App.local) return '<p class="note">The Hall of Shame keeps results from online rooms. Play a room with friends to fill it.</p>';
    const h = this.hall; if (!h || h.loading) return '<p class="note">Loading the Hall of Shame…</p>';
    if (h.err) return '<p class="err">The Hall of Shame didn’t load. Check your connection and try again.</p><button class="btn alt small" data-a="fun-hall-reload">Try again</button>';
    const rows = h.rows || []; if (!rows.length) return '<p class="note">No Donkey of the Day yet. When a match ends, the loser lands here with the date and final score.</p>';
    const agg = {}; rows.forEach(r => (r.players || []).forEach(p => { if (p.bot) return; const k = (p.name || '').trim().toLowerCase(); if (!k) return;
      const g = agg[k] = agg[k] || { name: p.name, titles: 0, losses: 0, games: 0, month: 0 }; g.games++; g.losses += p.losses || 0; if (p.donkey) { g.titles++; const d = new Date(r.at || 0), n = new Date(); if (d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()) g.month++; } }));
    const board = Object.values(agg).sort((x, y) => y.titles - x.titles || y.losses / y.games - x.losses / x.games);
    const top = board[0] && board[0].titles ? board[0] : null;
    return `${top ? `<div class="shame"><div class="stamp" aria-hidden="true">🫏</div><div class="cap">Reigning champion of shame</div><div class="who">${esc(top.name)}</div><div class="cap">${top.titles} time${top.titles === 1 ? '' : 's'} Donkey of the Day in ${top.games} match${top.games === 1 ? '' : 'es'}</div></div>` : ''}
    <h3 style="font-size:20px;margin-top:14px">Leaderboard</h3>
    <div class="tblwrap"><table class="hallt"><thead><tr><th scope="col">Player</th><th scope="col" title="Donkey of the Day titles">🫏 Titles</th><th scope="col">This month</th><th scope="col">Matches</th><th scope="col">Losses per match</th></tr></thead>
    <tbody>${board.map((g, i) => `<tr><td><b>${i + 1}.</b> ${esc(g.name)}</td><td class="num"><b>${g.titles}</b></td><td class="num">${g.month}</td><td class="num">${g.games}</td><td class="num">${(g.losses / g.games).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="font-size:20px;margin-top:14px">Every Donkey of the Day</h3>
    <div class="hall-list">${rows.slice(0, 40).map(r => `<div class="hrow"><div class="hd">${esc(r.date || '')}</div><div class="hn">${esc(r.name || 'Player')}${r.title ? ` <span class="ttl3">${esc(r.title)}</span>` : ''}</div>
      <div class="hp">${(r.players || []).map(p => `<span class="hc ${p.donkey ? 'me' : ''}">${esc((p.name || '').replace(/^Bot(?=[A-Z])/, ''))} <b>${p.losses}</b></span>`).join('')}</div></div>`).join('')}</div>`;
  },
  /* ----- settings ----- */
  commHTML() {
    const s = this.set, seg = (a, cur, opts, lbl) => `<span class="seg wrapseg" role="group" aria-label="${lbl}">${opts.map(([k, l]) => `<button data-a="${a}" data-k="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</span>`;
    const clips = Object.keys(Commentary.manifest.commentary || {}).length;
    return `<h2>Commentary</h2>
    <section class="blk" style="margin-top:10px"><h3 style="font-size:20px">Commentary</h3><div style="margin-top:8px">${seg('fun-mode', s.mode, [['off', 'Off'], ['halka', 'Halka'], ['teekha', 'Teekha']], 'Commentary level')}</div><p class="note">Halka keeps it friendly. Teekha adds sharper roasts. This setting is for your device only, unless the host sets the spice for the whole room.</p></section>
    <section class="blk"><h3 style="font-size:20px">Commentator</h3><div style="margin-top:8px">${seg('fun-who', s.who, [['bablu', '🎙️ Bablu Bhaiya'], ['chacha', '🏏 Chacha'], ['mix', 'Both']], 'Commentator')}</div><p class="note">Bablu Bhaiya talks Bhojpuri. Chacha calls it like a cricket match. Both take turns.</p></section>
    <section class="blk"><h3 style="font-size:20px">Voice</h3><div class="row" style="margin-top:8px">${seg('fun-voice', s.voice ? '1' : '0', [['0', 'Off'], ['1', 'On']], 'Voice')}<button class="btn alt small" data-a="fun-test" ${s.mode === 'off' ? 'disabled' : ''}>Hear a sample</button></div>
      <p class="note">${clips ? 'Plays a recorded voice for each line, and the music gets quieter while it speaks. Lines without a recording show as text.' : 'Voice recordings have not been added to this server yet, so commentary shows as text.'}${Commentary.unlocked ? '' : ' Tap anywhere on the page to turn sound on.'}</p></section>
    <section class="blk"><h3 style="font-size:20px">Sound effects</h3><div style="margin-top:8px">${seg('fun-sfx', s.sfx ? '1' : '0', [['0', 'Off'], ['1', 'On']], 'Sound effects')}</div><p class="note">Hee-haw for every Donkey, a drumroll for the final two, and splats for throws. Plays when game audio is on.</p></section>`;
  },
  test() { this.busyUntil = 0; this.say('cut', Math.floor(Math.random() * 997), { u: shortName(App.uid) || 'Aap', to: 'Pappu', n: 3, total: 9, suit: 'Badam' }, { pri: 3, paint: true }); },
  click(a, b) {
    switch (a) {
      case 'fun-comm': App.openSheet('comm'); return true;
      case 'fun-hall': App.openSheet('hall'); this.loadHall(); return true;
      case 'fun-hall-reload': this.loadHall(); return true;
      case 'fun-mode': this.set.mode = b.dataset.k; this.save(); if (this.set.mode === 'off') { this.cur = null; } App.renderSheet(); this.paint(); return true;
      case 'fun-who': this.set.who = b.dataset.k; this.save(); App.renderSheet(); return true;
      case 'fun-voice': this.set.voice = b.dataset.k === '1'; this.save(); if (this.set.voice) this.test(); else this.setTalk(false); App.renderSheet(); this.paint(); return true;
      case 'fun-sfx': this.set.sfx = b.dataset.k === '1'; this.save(); if (this.set.sfx) this.sfx('heehaw'); App.renderSheet(); return true;
      case 'fun-test': this.test(); return true;
      case 'fun-throw': this.throwAt(b.dataset.u, b.dataset.e); return true;
    }
    return false;
  }
};
/* ---------- 2.5: shuffle power, magic cards, bets, trolling, stats, challenges, themes ---------- */
const SHUF_INFO = {
  cut: { n: 'Sirf Cut', d: 'One cut, no mixing. Dealt all at once, so whole suit piles land on one player.', heat: 3 },
  shanti: { n: 'Shanti Cut', d: 'One cut, dealt one at a time. Suit piles spread out, so hands come out flat and cuts start late.', heat: 0 },
  over_lite: { n: 'Ghar Wala (light)', d: 'Overhand 3–4 times, the usual home shuffle, dealt in fours. Some clumps survive.', heat: 2 },
  over_full: { n: 'Ghar Wala (full)', d: 'Overhand 10–12 times, dealt in threes. Slightly uneven.', heat: 1 },
  riffle1: { n: 'Riffle ×1', d: 'Bridged once, dealt in threes. A few short runs remain.', heat: 1 },
  riffle3: { n: 'Riffle ×3', d: 'Bridged three times, dealt one at a time. Nearly fair.', heat: 0 },
  riffle7: { n: 'Riffle ×7', d: 'Casino style. Practically random.', heat: 0 },
  wash: { n: 'Patta Ragdo', d: 'Cards swirled face-down on the table. Fully mixed.', heat: 0 },
  machine: { n: 'Machine Shuffle', d: 'Perfect computer shuffle. The fairest deal.', heat: 0 },
  ulta: { n: 'Ulta Pulta', d: 'Pile flipped and cut in the middle, dealt in fives. Trick piles stay together.', heat: 2 },
  marzi: { n: 'Gadhe Ki Marzi', d: 'A random shuffle with a random deal style, kept secret until the cards are dealt.', heat: 1 }
};
const POWER_INFO = { peek: { i: '👁️', n: 'Peek', d: 'See one random card in an opponent’s hand.' }, shield: { i: '🛡️', n: 'Shield', d: 'The next cut aimed at you this hand goes to the discard pile instead.' },
  swap: { i: '🔄', n: 'Swap', d: 'On your turn, trade one random card blind with the next player.' }, reverse: { i: '↩️', n: 'Reverse', d: 'The next trick goes anticlockwise.' } };
Object.assign(EV_ICON, { shuffle: '🔀', deckcut: '✋', bottom: '👀', earn: '✨', power: '🪄', shielded: '🛡️', bet: '🎲' });
const DEAL_NAME = { 1: 'Ek-Ek Karke', 3: 'Thok Ke 3', 4: 'Thok Ke 4', 5: 'Thok Ke 5', all: 'Poora Ek Saath' };
const V7 = {
  fun() { return (App.pub && App.pub.lobby && App.pub.lobby.fun) || {}; },
  nick(u) { const n = App.pub && App.pub.lobby && App.pub.lobby.nick; return (n && n[u]) || shortName(u); },
  sendPower(k, to) { App.send('USE_POWER', to ? { k, to } : { k }); },
  /* ----- shuffle and deck cut screens ----- */
  deckHTML(n, cut) { const k = Math.min(18, Math.max(6, Math.round(n / 3))); let h = ''; for (let i = 0; i < k; i++) h += `<span class="dk ${cut != null && i === Math.round(cut / 52 * k) ? 'gap' : ''}" style="--i:${i}"></span>`; return `<div class="deckpile" aria-hidden="true">${h}</div>`; },
  centerHTML(m) {
    const s = m.shuf, me = App.uid, T = Engine.T;
    if (m.phase === 'SHUFFLE') {
      if (s.by !== me) return `<h2>Shuffling</h2>${this.deckHTML(52)}<p class="status"><b>${esc(nameOf(s.by))}</b> ${m.lastResult ? 'is the Donkey, so they pick the shuffle' : 'deals first and picks the shuffle'}.</p>${s.fresh ? '<p class="note" style="color:var(--feltMuted)">A brand-new deck, still sorted by suit.</p>' : '<p class="note" style="color:var(--feltMuted)">Last hand’s trick piles are still stacked by suit.</p>'}${timerHTML(m.deadline, T.shuffle)}`;
      const sel = App.shufPick || '', sec = !!App.shufSecret;
      return `<h2>${m.lastResult ? 'Your shuffle, Donkey' : 'Your shuffle'}</h2><p style="margin:0">${s.fresh ? 'Brand-new deck: every suit is still in order.' : 'The deck is last hand’s piles, stacked by suit.'} Pick how you mix it.</p>
      <div class="shufgrid" role="radiogroup" aria-label="Shuffle mode">${Engine.SHUF.map(k => { const I = SHUF_INFO[k], dis = k === m.lastShuf; return `<button class="shufopt ${sel === k ? 'on' : ''}" role="radio" aria-checked="${sel === k}" data-a="v7-shuf" data-k="${k}" ${dis ? 'disabled' : ''}><b>${I.n}</b><span class="heat" aria-label="Chaos ${I.heat} of 3">${'🌶️'.repeat(I.heat) || '⚖️'}</span><small>${dis ? 'Used last hand' : I.d}</small><em class="dealtag">${k === 'marzi' ? 'Deal: random' : 'Deal: ' + DEAL_NAME[Engine.DEAL_OF[k]]}</em></button>`; }).join('')}</div>
      <label class="chk"><input type="checkbox" data-change="v7-secret" ${sec || sel === 'marzi' ? 'checked' : ''} ${sel === 'marzi' ? 'disabled' : ''}> Keep it secret until the cards are dealt</label>
      <button class="btn gold" data-a="v7-shuf-go" ${sel && !App.pending ? '' : 'disabled'}>${sel ? 'Shuffle: ' + SHUF_INFO[sel].n : 'Pick a shuffle'}</button>${timerHTML(m.deadline, T.shuffle)}`;
    }
    const used = s.secret ? '🤫 Shuffled in secret.' : s.actual ? `🔀 ${esc(nameOf(s.by))} used <b>${SHUF_INFO[s.actual].n}</b>.` : '';
    if (s.cutter !== me) return `<h2>Gaddi Kaat</h2>${this.deckHTML(52)}<p class="status">${used}<br><b>${esc(nameOf(s.cutter))}</b>, sitting left of the dealer, cuts the deck.</p>${timerHTML(m.deadline, T.deckCut)}`;
    const at = App.cutAt || 26;
    return `<h2>Gaddi Kaat</h2><p style="margin:0">${used} You sit on the dealer’s left, so you cut.</p>${this.deckHTML(52, at)}
    <label class="cutlbl" for="cutat">Cut after card <b id="cutn">${at}</b> of 52</label><input id="cutat" class="cutrange" type="range" min="4" max="48" value="${at}" data-input="v7-cut">
    <label class="chk"><input type="checkbox" data-change="v7-peek" ${App.cutPeek ? 'checked' : ''}> Show everyone the bottom card after the cut</label>
    <div class="row" style="justify-content:center"><button class="btn gold" data-a="v7-cut" data-k="cut" ${App.pending ? 'disabled' : ''}>Kaat here</button><button class="btn alt" data-a="v7-cut" data-k="double" ${App.pending ? 'disabled' : ''}>Double Kaat</button><button class="btn alt" data-a="v7-cut" data-k="knock" ${App.pending ? 'disabled' : ''}>Thak-Thak (no cut)</button></div>${timerHTML(m.deadline, T.deckCut)}`;
  },
  shufLine(m) { const s = m.shuf; if (!s || !s.picked) return ''; const b = s.bottom ? ` Bottom card: <b>${short(s.bottom)}</b>.` : '';
    return `<p class="note shufline">${s.secret && !s.actual ? '🤫 Secret shuffle and deal, revealed after the deal.' : '🔀 ' + SHUF_INFO[s.actual].n + ', dealt ' + DEAL_NAME[s.deal] + '.'}${s.cut ? (s.cut.kind === 'knock' ? ' ✋ No cut.' : s.cut.kind === 'double' ? ' ✋ Double Kaat.' : ' ✋ Cut at ' + s.cut.at + '.') : ''}${b}</p>`; },
  planDealHTML(m, ru, left, prog) {
    const s = m.shuf, d = s.deal, n = !d ? null : d === 'all' ? left : Math.min(d, left), T = Engine.T, me = App.uid;
    return `<h2>You’re dealing</h2>${this.shufLine(m)}<p style="margin:0">${s.secret ? 'Secret deal plan: tap Deal and the cards go out the right way.' : `<b>${DEAL_NAME[d]}</b>: ${d === 'all' ? 'each player gets their whole share in one go' : d === 1 ? 'one card to each player in turn' : d + ' cards to each player in turn'}.`}</p>
      <p style="margin:6px 0 0">Next: ${n ? n + ' to ' : 'cards to '}${ru === me ? 'you' : '<b>' + esc(nameOf(ru)) + '</b>'}.</p>
      <div class="row" style="justify-content:center"><button class="btn gold" data-a="v7-plan" ${App.pending ? 'disabled' : ''}>${n ? 'Deal ' + n : 'Deal next batch'}</button><button class="btn alt" data-a="v7-plan-rest" ${App.pending ? 'disabled' : ''}>Deal the rest</button></div>
      ${prog}${timerHTML(m.deadline, T.batch)}<div class="tlabel">If time runs out, the rest is dealt the same way.</div>`;
  },
  dealStyles(left) { return `<div class="row dealstyles" style="justify-content:center">${[['1', 'Ek-Ek Karke'], ['3', 'Thok Ke 3'], ['5', 'Thok Ke 5'], ['all', 'Poora Ek Saath']].map(([k, l]) => `<button class="btn alt small" data-a="v7-deal" data-k="${k}" ${App.pending ? 'disabled' : ''}>${l}${k === 'all' ? ' (' + left + ')' : ''}</button>`).join('')}</div>`; },
  handExtras(m) {
    const s = m.shuf, r = m.lastResult; let h = '';
    if (s && s.actual) { const sh = (s.shape || []).slice().sort((a, b) => b.n - a.n), top = sh[0];
      h += `<div class="shufsum"><div>🔀 <b>${SHUF_INFO[s.actual].n}</b>${s.mode === 'marzi' ? ' (Gadhe Ki Marzi)' : ''}, dealt <b>${DEAL_NAME[s.deal] || ''}</b>, by ${esc(V7.nick(s.by))}${s.cut ? ', ' + (s.cut.kind === 'knock' ? 'no cut' : s.cut.kind === 'double' ? 'Double Kaat' : 'cut at ' + s.cut.at) : ''}.</div>
      ${top ? `<div>Longest suit dealt: <b>${esc(nameOf(top.u))}</b> got ${top.n} ${suitName(top.s)}.${sh.filter(x => x.voids).length ? ' Dealt a void: ' + sh.filter(x => x.voids).map(x => esc(shortName(x.u))).join(', ') + '.' : ''}</div>` : ''}</div>`; }
    const bets = r && r.bets ? Object.entries(r.bets) : [];
    if (bets.length) h += `<div class="shufsum">🎲 ${bets.map(([b, p]) => `${esc(shortName(b))} bet on ${esc(shortName(p))} ${p === r.uid ? '✅' : '❌'}`).join(' · ')}</div>`;
    return h;
  },
  comeback(m) { const a = m.award; if (!a) return ''; const cb = m.seats.filter(u => u !== a.uid && m.losses[u] === m.target - 1);
    return cb.length ? `<p class="badgeline">🔥 Comeback badge: ${cb.map(u => '<b>' + esc(nameOf(u)) + '</b>').join(', ')} survived at ${m.target - 1} losses.</p>` : ''; },
  /* ----- your area: magic cards, peek, bets ----- */
  meHTML(m) {
    if (!m.opts || !m.seats || !m.names[App.uid]) return ''; const me = App.uid, inHand = ['TURN', 'TRICK_END', 'CUT_REVEAL'].includes(m.phase); let h = '';
    const pk = App.extra && App.extra.peek; if (pk) h += `<div class="peekinfo">👁️ You peeked: <b>${esc(shortName(pk.to))}</b> holds ${cardStatic(pk.c, 'mini')}</div>`;
    const pw = (m.powers || {})[me] || [];
    if (m.opts.powers && pw.length && App.hand.length) h += `<div class="powers" role="group" aria-label="Your magic cards">${pw.map(k => { const P = POWER_INFO[k], ok = inHand && !App.pending && (k !== 'swap' || (m.phase === 'TURN' && m.actor === me)) && !(k === 'shield' && (m.shield || []).includes(me)) && !(k === 'reverse' && m.reverseNext);
      return `<button class="pw" data-a="v7-power" data-k="${k}" ${ok ? '' : 'disabled'} title="${P.d}"><span aria-hidden="true">${P.i}</span>${P.n}</button>`; }).join('')}</div>`;
    if (m.opts.bets && inHand && !App.hand.length && m.counts) { const act = m.seats.filter(u => m.counts[u] > 0); const mine = (m.bets || {})[me];
      if (act.length >= 2) h += `<div class="betbar">${mine ? `🎲 You bet on <b>${esc(nameOf(mine))}</b>. Fingers crossed.` : `🎲 Bet on the Donkey: ${act.map(u => `<button class="btn alt small" data-a="v7-bet" data-u="${esc(u)}">${avatar(u)} ${esc(shortName(u))}</button>`).join('')}`}</div>`; }
    return h;
  },
  /* ----- seats: punishments, shields, magic counts ----- */
  punished(m, u) { const r = m.lastResult; return !!(r && r.uid === u && m.handNo === r.handNo + 1); },
  seatCls(m, u) { return this.punished(m, u) ? 'punished' : ''; },
  orn(m, u) { let h = ''; if (this.punished(m, u)) h += m.lastResult.handNo % 2 ? '<span class="orn ears" title="Donkey ears for one hand" aria-label="Wearing donkey ears">🫏</span>' : '<span class="orn garland" title="Chappal garland for one hand" aria-label="Wearing a chappal garland">🩴🩴🩴🩴</span>';
    const sh = (m.shield || []).includes(u), pw = ((m.powers || {})[u] || []).length; if (sh || pw) h += `<span class="mag" aria-label="${sh ? 'Shield up. ' : ''}${pw} magic card${pw === 1 ? '' : 's'}">${sh ? '🛡️' : ''}${pw ? '✨' + pw : ''}</span>`; return h; },
  muted() { const m = App.pub && App.pub.match; return !!(this.fun().mute && m && m.names && this.punished(m, App.uid)); },
  /* ----- story lines ----- */
  evText(e) {
    switch (e.k) {
      case 'shuffle': return `${who(e.u)} shuffled${e.mode ? ' with ' + SHUF_INFO[e.mode].n : ' in secret'}.`;
      case 'deckcut': return `${who(e.u)} ${e.kind === 'knock' ? 'knocked: no cut' : e.kind === 'double' ? 'did a Double Kaat' : 'cut the deck at ' + e.at}.`;
      case 'bottom': return `${who(e.u)} showed the bottom card: ${short(e.c)}.`;
      case 'earn': return `${who(e.u)} went out first and earned ${POWER_INFO[e.p].i} ${POWER_INFO[e.p].n}.`;
      case 'power': return `${who(e.u)} used ${POWER_INFO[e.p].i} ${POWER_INFO[e.p].n}${e.to ? ' on ' + who(e.to) : ''}.`;
      case 'shielded': return `${who(e.u)}’s shield blocked ${who(e.to)}’s cut. The cards went to the discard pile.`;
      case 'bet': return `${who(e.u)} bet that ${who(e.to)} will be the Donkey.`;
    }
    return '';
  },
  /* ----- lobby ----- */
  lobbyHTML(L, H) {
    const F = L.fun || {}, tog = (k, l, d) => `<div class="funrow"><div class="grow"><b>${l}</b><div class="note">${d}</div></div>${H ? `<span class="seg"><button data-a="v7-fun" data-k="${k}" data-v="0" aria-pressed="${!F[k]}">Off</button><button data-a="v7-fun" data-k="${k}" data-v="1" aria-pressed="${!!F[k]}">On</button></span>` : `<span class="tagp ${F[k] ? 'go' : ''}">${F[k] ? 'On' : 'Off'}</span>`}</div>`;
    const sp = [['device', 'Each phone'], ['off', 'Off'], ['halka', 'Halka'], ['teekha', 'Teekha']];
    const nick = L.nick || {}, jokes = L.jokes || [];
    return `<section class="blk"><h2>Fun rules</h2>
      ${tog('shuffle', 'Donkey’s Shuffle Power', 'The Donkey picks the shuffle, the player on their left cuts the deck.')}
      ${tog('powers', 'Magic cards', 'First one out each hand earns Peek, Shield, Swap or Reverse.')}
      ${tog('blitz', 'Blitz', '10 seconds per move instead of 90.')}
      ${tog('bets', 'Bet on the Donkey', 'Players who are out guess who loses the hand.')}
      ${tog('mute', 'Mute the Donkey', 'The Donkey can’t chat during the next hand.')}
      <div class="funrow"><div class="grow"><b>Commentary spice for the room</b><div class="note">Each phone lets everyone choose for themselves.</div></div></div>
      ${H ? `<span class="seg wrapseg">${sp.map(([k, l]) => `<button data-a="v7-spice" data-k="${k}" aria-pressed="${(F.spice || 'device') === k}">${l}</button>`).join('')}</span>` : `<p class="note">${(sp.find(x => x[0] === (F.spice || 'device')) || sp[0])[1]}</p>`}</section>
    <details class="set" data-set="Nicknames" ${App.openSets.has('Nicknames') ? 'open' : ''}><summary>Nicknames and inside jokes</summary>
      <p class="note">Nicknames show in commentary. Anyone can nickname anyone.</p>
      ${(L.members || []).map(x => `<div class="row nickrow">${avatar(x.uid)}<span class="nm">${esc(x.name)}</span><input id="nick-${esc(x.uid)}" class="t grow" maxlength="20" placeholder="Nickname" value="${esc(nick[x.uid] || '')}" aria-label="Nickname for ${esc(x.name)}"><button class="btn alt small" data-a="v7-nick" data-u="${esc(x.uid)}">Save</button></div>`).join('')}
      <h3 style="font-size:20px;margin-top:14px">Inside jokes</h3><p class="note">The commentator slips these in. Use {u} for the player in the moment.</p>
      <ul class="jokes">${jokes.map((j, i) => `<li><span class="grow">${esc(j.x)}</span>${H ? `<button class="btn alt small" data-a="v7-joke-del" data-i="${i}" aria-label="Delete joke">✕</button>` : ''}</li>`).join('') || '<li class="note">No jokes yet.</li>'}</ul>
      <div class="row"><input id="jokein" class="t grow" maxlength="120" placeholder="{u} ki chai phir thandi ho gayi" aria-label="New inside joke"><button class="btn small" data-a="v7-joke">Add</button></div></details>`;
  },
  /* ----- scores: stats and rivalries ----- */
  statsHTML(m) {
    const S = m.stats; if (!S || !m.seats) return '';
    const rows = m.seats.map(u => ({ u, cuts: S.cuts[u] || 0, cards: S.cards[u] || 0, big: S.big[u] || 0, best: S.best[u] || 0, first: S.first[u] || 0, bet: (m.betPts || {})[u] || 0 }));
    const riv = Object.entries(S.rival).map(([k, n]) => { const [a, b] = k.split('>'); return { a, b, n, back: S.rival[b + '>' + a] || 0 }; }).filter(x => x.a < x.b || !S.rival[x.b + '>' + x.a]).sort((x, y) => (y.n + y.back) - (x.n + x.back)).slice(0, 3);
    return `<h3 style="font-size:20px;margin-top:14px">Stats this match</h3><div class="tblwrap"><table class="hallt"><thead><tr><th>Player</th><th>Cuts</th><th>Cards dumped</th><th>Biggest</th><th>Safe streak</th><th>First out</th>${m.opts && m.opts.bets ? '<th>Bets won</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(shortName(r.u))}</td><td class="num">${r.cuts}</td><td class="num">${r.cards}</td><td class="num">${r.big}</td><td class="num">${r.best}</td><td class="num">${r.first}</td>${m.opts && m.opts.bets ? `<td class="num">${r.bet}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      ${riv.length ? `<h3 style="font-size:20px;margin-top:14px">Rivalries</h3>${riv.map(x => `<div class="ev">${avatar(x.a)}<b>${esc(shortName(x.a))}</b> cut <b>${esc(shortName(x.b))}</b> ${x.n}× · ${esc(shortName(x.b))} hit back ${x.back}×</div>`).join('')}` : ''}`;
  },
  click(a, b) {
    const m = App.pub && App.pub.match;
    switch (a) {
      case 'v7-shuf': App.shufPick = b.dataset.k; App.render(); return true;
      case 'v7-shuf-go': if (App.shufPick) { App.send('SHUFFLE_PICK', { mode: App.shufPick, secret: !!App.shufSecret || App.shufPick === 'marzi' }); App.shufPick = null; App.shufSecret = false; } return true;
      case 'v7-cut': App.send('DECK_CUT', { kind: b.dataset.k, at: App.cutAt || 26, peek: !!App.cutPeek }); App.cutAt = 26; App.cutPeek = false; return true;
      case 'v7-plan': App.send('DEAL_BATCH', { plan: true }); return true;
      case 'v7-plan-rest': App.send('DEAL_BATCH', { rest: true }); return true;
      case 'v7-deal': { const r = m.dealTo, left = m.quotas[r] - m.dealt[r], k = b.dataset.k; App.send('DEAL_BATCH', { count: k === 'all' ? left : Math.min(+k, left) }); return true; }
      case 'v7-power': { const k = b.dataset.k; if (k === 'peek') { App.openSheet('v7-peek'); return true; } V7.sendPower(k); return true; }
      case 'v7-peek-at': App.closeSheet(); V7.sendPower('peek', b.dataset.u); return true;
      case 'v7-bet': App.send('BET', { pick: b.dataset.u }); return true;
      case 'v7-fun': App.send('SET_FUN', { k: b.dataset.k, v: b.dataset.v === '1' }); return true;
      case 'v7-spice': App.send('SET_FUN', { k: 'spice', v: b.dataset.k }); return true;
      case 'v7-nick': { const i = document.getElementById('nick-' + b.dataset.u); App.send('SET_NICK', { u: b.dataset.u, x: i ? i.value : '' }); App.toast('Nickname saved.'); return true; }
      case 'v7-joke': { const i = $('#jokein'); if (i && i.value.trim()) { App.send('ADD_JOKE', { x: i.value }); i.value = ''; } return true; }
      case 'v7-joke-del': App.send('DEL_JOKE', { i: +b.dataset.i }); return true;
      case 'v7-progress': App.openProfile(); return true;
      case 'v7-theme': Prog.setTheme(b.dataset.k, null); return true;
      case 'v7-back': Prog.setTheme(null, b.dataset.k); return true;
    }
    return false;
  },
  peekSheet() { const m = App.pub.match; const ts = m.seats.filter(u => u !== App.uid && m.counts[u] > 0);
    return `<h2>👁️ Peek</h2><p>Pick whose hand to peek into. Only you see the card.</p><div class="row">${ts.map(u => `<button class="btn alt" data-a="v7-peek-at" data-u="${esc(u)}">${avatar(u)} ${esc(nameOf(u))}</button>`).join('')}</div>`; }
};
/* ----- progress: XP, daily challenge, table colour and card back. The server decides and stores them (under the Google account when signed in). ----- */
const Prog = {
  s: null,   // the server's view of my progress: { xp, level, look, challenge: { id, t, done, streak } }
  load() { return Net.call('profile').then(r => { if (!r.error) { this.s = r; App.profile = r; this.apply(); if (App.view === 'home') App.render(); if (App.sheet === 'profile') App.renderSheet(); } return r; }); },
  level() { return this.s ? this.s.level : 1; },
  setTheme(t, b) { Net.call('set-look', { theme: t, back: b }).then(r => { if (r.ok) { if (this.s) this.s.look = r.look; this.apply(); } else App.toast('That one is still locked. Keep playing to level up.'); if (App.sheet === 'profile') App.renderSheet(); }); },
  apply() { const look = (this.s && this.s.look) || LS.get('dotd-look') || {}, t = THEMES.find(x => x.id === look.theme) || THEMES[0], b = BACKS.find(x => x.id === look.back) || BACKS[0], r = document.documentElement.style;
    if (t.id === 'teal') { r.removeProperty('--felt'); r.removeProperty('--felt2'); } else { r.setProperty('--felt', t.f); r.setProperty('--felt2', t.f2); } r.setProperty('--back', b.b); LS.set('dotd-look', { theme: t.id, back: b.id }); },
  challengeHTML() { const c = this.s && this.s.challenge; if (!c) return ''; return `<div class="chal ${c.done ? 'done' : ''}"><span aria-hidden="true">${c.done ? '✅' : '🎯'}</span><div class="grow"><div class="note">Today’s challenge${c.streak > 1 ? ` · ${c.streak}-day streak` : ''}</div><b>${esc(c.t)}</b></div></div>`; },
  lookHTML() { const lv = this.level(), look = (this.s && this.s.look) || {};
    return `<h3 style="font-size:20px;margin-top:14px">Table colour</h3><div class="swatches">${THEMES.map(t => `<button class="sw ${look.theme === t.id ? 'on' : ''}" data-a="v7-theme" data-k="${t.id}" ${t.lvl > lv ? 'disabled' : ''} aria-pressed="${look.theme === t.id}"><span class="chip2" style="background:radial-gradient(${t.f},${t.f2})"></span>${t.n}<small>${t.lvl > lv ? '🔒 Level ' + t.lvl : ''}</small></button>`).join('')}</div>
    <h3 style="font-size:20px;margin-top:14px">Card back</h3><div class="swatches">${BACKS.map(t => `<button class="sw ${look.back === t.id ? 'on' : ''}" data-a="v7-back" data-k="${t.id}" ${t.lvl > lv ? 'disabled' : ''} aria-pressed="${look.back === t.id}"><span class="chip2 cb" style="background:${t.b}"></span>${t.n}<small>${t.lvl > lv ? '🔒 Level ' + t.lvl : ''}</small></button>`).join('')}</div>`; }
};
Prog.apply();

App.boot();

