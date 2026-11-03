/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const BOT_NAMES = ['BotKunal', 'BotNinad', 'BotBajrangbali', 'BotMitesh', 'BotPritesh', 'BotAlldrin', 'BotAllen'];
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['pro', 'Pro']];
const DEFAULT_LEVELS = [
  ['Nanha Gadha', 'Pickup Pappu', 'Kachra Kid', 'Lallu Lottery'],
  ['Captain Kachra', 'Patta Pehelwan', 'Fattu Fakir', 'Tingu Tycoon'],
  ['Professor Pickup', 'Bhaukaal Babu', 'Dhakkan Don', 'Jhol Jhaal Jeeja'],
  ['Lord Lafda', 'Bawandar Bhaiya', 'Gadha Shiromani', 'Sir Haar Singh'],
  ['Maharaja Gadha-e-Azam', 'Emperor of Hee-Haw', 'Supreme Pickup Sultan']];
const MUSIC_LOCK = 30000;
const TEASES = ['Patte sambhal, gadhe ki aawaz aa rahi hai 🫏', 'Itne patte? Dukaan khol li kya? 📦', 'Cut ka darr saaf dikh raha hai 😂', 'Aaj toh title pakka! 👑🫏', 'Chal chal, jaldi khel ⏱️', 'Mast chaal thi... dusre ke liye 😆'];
const QUIPS = {
  cut: ['Le bhai, sambhal ke! 😄', 'Mere taraf se prasad 🙏', 'Gift hai, rakh lo', 'Pickup time! 📦', 'Yeh lo, aur lo!'],
  pickup: ['Arre yaar, yeh kya hua 😩', 'Theek hai, dekh lunga', 'Itne saare patte? Kyun?'],
  selfDonkey: ['Arre yaar, phir se main? 🫏', 'Agli baar dekh lena', 'Gadha nahi, strategist hoon main'],
  tease: ['Badhai ho, naya title! 🎉', 'Hee-haw! 🫏', 'Kya khel gaye boss 😂', 'Title mubarak ho!']
};
const REASONS = { NOT_YOUR_TURN: "It isn’t your turn.", MUST_FOLLOW_SUIT: 'You still have the led suit, so you must follow it.', MUST_LEAD_ACE: 'The first trick opens with the Ace of Spades.',
  MUST_CUT: "You have none of the led suit. Choose cards of one other suit to cut.", MIXED_CUT_SUITS: 'A cut must use cards of one suit only.', EMPTY_CUT: 'Select at least one card to cut.',
  CARD_NOT_OWNED: "That card isn’t in your hand.", INVALID_BATCH: "That batch is larger than this player’s remaining cards.", WRONG_PHASE: 'That action no longer applies.', STALE_STATE: 'The table changed. Try again.',
  NOT_HOST: 'Only the host can do that.', ROOM_FULL: 'Every seat is taken.', NOT_READY: 'Everyone needs to choose their music and tap Ready before starting.', CANNOT_CUT_WHEN_LEADING: 'You lead this trick, so play any single card.',
  MUSIC_LOCKED: 'Each song plays for at least 30 seconds before anyone can change it.', LOSER_NO_MUSIC: 'You have the most losses, so the music is out of your hands until you make a comeback.',
  WATCHERS_NO_MUSIC: 'Only seated players can change the music.', EMPTY_NAME: 'Type a name first.' };

/* ---------- hand encryption: ECDH P-256 + AES-GCM ---------- */
const Crypt = {
  ok: !!(window.crypto && crypto.subtle),
  cache: new Map(),
  b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); },
  unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
  async gen() {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey), priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return { pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, priv };
  },
  async key(priv, pub) {
    const id = priv.d + '|' + pub.x + pub.y; if (this.cache.has(id)) return this.cache.get(id);
    const p = (async () => {
      const pk = await crypto.subtle.importKey('jwk', { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      const uk = await crypto.subtle.importKey('jwk', { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      return crypto.subtle.deriveKey({ name: 'ECDH', public: uk }, pk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })();
    this.cache.set(id, p); return p;
  },
  async enc(k, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))); return { iv: this.b64(iv), ct: this.b64(ct) }; },
  async dec(k, e) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(e.iv) }, k, this.unb64(e.ct)); return JSON.parse(new TextDecoder().decode(pt)); }
};

/* ---------- serialized writes to one document ---------- */
function makeWriter(ref, onErr) {
  let busy = false, next = null;
  return async function write(data) {
    next = data; if (busy) return; busy = true;
    while (next) { const d = next; next = null;
      try { await ref.set(d); } catch (e) { if (e && e.code === 'unavailable') { await sleep(300 + Math.random() * 500); if (!next) next = d; } else { onErr && onErr(e); } } }
    busy = false;
  };
}

/* ---------- Host: runs the authoritative game on the host’s device ---------- */
class Host {
  constructor(o) {
    this.code = o.code; this.uid = o.uid; this.local = o.local; this.out = o.out; this.net = o.net || null;
    this.lobby = { seatsWanted: o.local ? (o.seats || 4) : 4, mode: 'single', titlesOn: true, titles: DEFAULT_LEVELS.map(l => l.slice()), target: 5, targets: [], hints: true, botSpeed: 'real', watchers: {}, botLevel: o.botLevel || 'medium', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', members: {}, kicked: {} };
    this.lobby.members[o.uid] = { name: o.name, bot: false, ready: false, audio: false, joinedAt: Date.now() };
    this.music = { kind: 'synth', track: 'chai', startedAt: Date.now() - MUSIC_LOCK, by: null }; this.proposals = {}; this.botTimer = null;
    this.st = null; this.processed = {}; this.acks = {}; this.seq = 0; this.timers = []; this.keys = null; this.memberCache = {};
    this.saveT = null; this.onQuip = o.onQuip || null; this.quipKey = '';
  }
  snapshot() { return { lobby: this.lobby, music: this.music, proposals: this.proposals, st: this.st, processed: this.processed, acks: this.acks, seq: this.seq, keys: this.keys }; }
  restore(s) { if (s.lobby && !(Array.isArray(s.lobby.titles) && s.lobby.titles.length === 5 && s.lobby.titles.every(Array.isArray))) s.lobby.titles = DEFAULT_LEVELS.map(l => l.slice()); if (s.lobby && !s.lobby.target) s.lobby.target = 5; if (s.lobby) { s.lobby.watchers = s.lobby.watchers || {}; s.lobby.botSpeed = s.lobby.botSpeed || 'real'; } if (s.music && !s.music.kind) s.music.kind = 'synth'; if (s.lobby && !s.lobby.targets) Object.assign(s.lobby, { targets: [], hints: true });  Object.assign(this, { lobby: s.lobby, music: s.music, proposals: s.proposals || {}, st: s.st, processed: s.processed || {}, acks: s.acks || {}, seq: s.seq || 0, keys: s.keys || null }); }
  botCount() { return Object.values(this.lobby.members).filter(m => m.bot).length; }
  roster() { return Object.entries(this.lobby.members).sort((a, b) => a[1].joinedAt - b[1].joinedAt).map(([uid, m]) => ({ uid, ...m })); }
  memberJoined(uid, d) {
    this.memberCache[uid] = d;
    const L = this.lobby, m = L.members[uid];
    if (d.watch && !m) { if (d.left) { if (L.watchers[uid]) { delete L.watchers[uid]; return true; } return false; }
      const had = !!L.watchers[uid]; L.watchers[uid] = { name: String(d.name || 'Guest').slice(0, 24), joinedAt: d.joinedAt || Date.now() }; return !had; }
    if (!d.watch && L.watchers[uid] && !d.left) delete L.watchers[uid];
    if (m) { if (d.pub) m.pub = d.pub; if (d.name && !this.st) m.name = d.name; if (d.left && !this.st && uid !== this.uid) { delete L.members[uid]; return true; } return !!d.pub; }
    if (d.left || this.st && !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return false;
    if (L.kicked[uid] && !(d.joinedAt > L.kicked[uid])) return false;
    if (Object.keys(L.members).length >= L.seatsWanted) return false;
    L.members[uid] = { name: String(d.name || 'Player').slice(0, 24), bot: false, ready: false, audio: false, joinedAt: d.joinedAt || Date.now(), pub: d.pub || null };
    return true;
  }
  rescanMembers() { Object.entries(this.memberCache).forEach(([u, d]) => { if (!this.lobby.members[u]) this.memberJoined(u, d); }); }
  handle(uid, a) {
    const L = this.lobby, now = Date.now(), isHost = uid === this.uid, inLobby = !this.st;
    const m = L.members[uid];
    switch (a.type) {
      case 'SET_LOBBY': if (!m || !inLobby) return 'WRONG_PHASE';
        if ('audio' in a.payload) m.audio = !!a.payload.audio;
        if ('ready' in a.payload) m.ready = !!a.payload.ready && m.audio; break;
      case 'PROPOSE_TRACK': case 'SELECT_TRACK': case 'SET_MUSIC': {
        const why = this.musicBlock(uid, now); if (why) return why;
        const p = a.payload || {};
        if (p.song) { if (!/^[0-9a-f]{32}$|^local-/.test(String(p.song.id))) return 'WRONG_PHASE';
          this.music = { kind: 'song', song: { id: String(p.song.id), title: String(p.song.title || 'Song').slice(0, 60) }, startedAt: now, by: uid }; }
        else { if (!TRACKS.find(t => t.id === p.track)) return 'WRONG_PHASE'; this.music = { kind: 'synth', track: p.track, startedAt: now, by: uid }; }
        break; }
      case 'ADD_BOT': if (!isHost || !inLobby) return 'NOT_HOST'; if (Object.keys(L.members).length >= L.seatsWanted) return 'ROOM_FULL';
        { const used = new Set(Object.values(L.members).map(x => x.name)); const free = BOT_NAMES.filter(n => !used.has(n)); const name = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot';
          const level = LEVELS.some(l => l[0] === (a.payload && a.payload.level)) ? a.payload.level : (L.botLevel || 'medium');
          L.members['bot-' + Math.random().toString(36).slice(2, 8)] = { name, bot: true, level, ready: true, audio: true, joinedAt: now }; } break;
      case 'SET_BOT_LEVEL': if (!isHost || !inLobby) return 'NOT_HOST'; { const t = L.members[a.payload.uid]; if (!t || !t.bot || !LEVELS.some(l => l[0] === a.payload.level)) return 'WRONG_PHASE'; t.level = a.payload.level; } break;
      case 'SET_CONSPIRACY': if (!isHost || !inLobby) return 'NOT_HOST';
        if (Array.isArray(a.payload.targets)) L.targets = a.payload.targets.filter(u => L.members[u]).slice(0, 4);
        if ('hints' in a.payload) L.hints = !!a.payload.hints; break;
      case 'SET_TARGET': if (!isHost || !inLobby) return 'NOT_HOST'; L.target = [2, 3, 5].includes(a.payload.n) ? a.payload.n : 5; break;
      case 'SET_BOT_SPEED': if (!isHost) return 'NOT_HOST'; L.botSpeed = a.payload.speed === 'quick' ? 'quick' : 'real'; break;
      case 'SET_TITLES': if (!isHost || !inLobby) return 'NOT_HOST';
        if ('on' in a.payload) L.titlesOn = !!a.payload.on;
        if (Array.isArray(a.payload.levels) && a.payload.levels.length === 5) L.titles = a.payload.levels.map((v, i) => { const l = String(v || '').split(',').map(t => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12); return l.length ? l : DEFAULT_LEVELS[i].slice(); });
        break;
      case 'REMOVE': if (!isHost || !inLobby) return 'NOT_HOST'; { const t = L.members[a.payload.uid]; if (!t || a.payload.uid === this.uid) return 'WRONG_PHASE';
          if (!t.bot && t.ready) return 'WRONG_PHASE'; delete L.members[a.payload.uid]; if (!t.bot) L.kicked[a.payload.uid] = now; } break;
      case 'SET_SEATS': if (!isHost || !inLobby) return 'NOT_HOST'; { const n = a.payload.n === 5 ? 5 : 4;
          while (Object.keys(L.members).length > n) { const b = this.roster().reverse().find(x => x.bot); if (!b) return 'ROOM_FULL'; delete L.members[b.uid]; }
          L.seatsWanted = n; } break;
      case 'SET_MODE': if (!isHost || !inLobby) return 'NOT_HOST'; L.mode = a.payload.mode === 'split' ? 'split' : 'single'; break;
      case 'START': { if (!isHost || !inLobby) return 'NOT_HOST'; const r = this.roster();
          if (r.length !== L.seatsWanted || !r.every(p => p.bot || (p.ready && p.audio))) return 'NOT_READY';
          this.st = Engine.createMatch({ players: r.map(p => ({ uid: p.uid, name: p.name, bot: p.bot, level: p.level })), mode: L.mode, tz: L.tz, now, matchId: 'M' + now.toString(36).toUpperCase(), titles: L.titlesOn ? L.titles : null, target: L.target || 5, targets: (L.targets || []).filter(u => L.members[u]), hints: L.hints !== false }); break; }
      case 'REMATCH': if (!isHost || !this.st || !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        { const prev = this.st; const players = prev.lobby.map(u => ({ uid: u, name: prev.names[u], bot: prev.bots[u], level: prev.levels && prev.levels[u] }));
          this.st = Engine.createMatch({ players, mode: prev.mode, tz: prev.tz, now, matchId: 'M' + now.toString(36).toUpperCase(), titles: L.titlesOn ? L.titles : null, target: L.target || 5, targets: (L.targets || []).filter(u => prev.names[u]), hints: L.hints !== false }); } break;
      case 'BACK_TO_LOBBY': if (!isHost || !this.st || !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        this.st = null; Object.values(L.members).forEach(x => { if (!x.bot) x.ready = false; }); this.rescanMembers(); break;
      case 'END_MATCH': if (!isHost || !this.st || ['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        this.st.phase = 'INCOMPLETE'; this.st.deadline = null; this.st.incompleteReason = 'The host ended the match early.'; this.st.v++; break;
      default:
        if (!this.st) return 'WRONG_PHASE';
        { const r = Engine.apply(this.st, uid, a, now); if (r) return r; }
    }
    return null;
  }
  /* who may change the room song right now */
  musicBlock(uid, now) {
    const seated = this.st ? !!this.st.names[uid] : !!this.lobby.members[uid];
    if (!seated) return 'WATCHERS_NO_MUSIC';
    if (now - (this.music.startedAt || 0) < MUSIC_LOCK) return 'MUSIC_LOCKED';
    if (this.st && this.st.losses) { const max = Math.max(...Object.values(this.st.losses)); if (max > 0 && this.st.losses[uid] === max) return 'LOSER_NO_MUSIC'; }
    return null;
  }
  act(uid, a) { const r = this.handle(uid, a); this.changed(); return r; }
  remoteAction(uid, d) {
    if (!d || !d.actionId || this.processed[uid] === d.actionId) return;
    this.processed[uid] = d.actionId;
    const r = this.handle(uid, { type: d.type, payload: d.payload || {} });
    this.acks[uid] = { actionId: d.actionId, ok: !r, reason: r || null };
    this.changed();
  }
  changed() { this.schedule(); this.quips(); this.publish(); this.save(); }
  schedule() {
    this.timers.forEach(clearTimeout); this.timers = [];
    const st = this.st; if (!st) return;
    const now = Date.now();
    const dls = [st.deadline, st.phase === 'DEALING' ? st.dealTotal : null].filter(x => x != null);
    if (dls.length) this.timers.push(setTimeout(() => { if (Engine.tick(this.st, Date.now())) this.changed(); else this.schedule(); }, Math.max(0, Math.min(...dls) - now) + 30));
    let botKey = null;
    if (st.seats) for (const u of st.seats) if (st.bots[u] && Engine.botAction(st, u)) { botKey = st.v + ':' + u; break; }
    if (this.botTimer && this.botTimer.key !== botKey) { clearTimeout(this.botTimer.id); this.botTimer = null; }
    if (botKey && !this.botTimer) {
      const u = botKey.split(':').slice(1).join(':'), dealing = st.phase === 'DEALING';
      const quick = this.lobby.botSpeed === 'quick';
      const ms = dealing ? 500 + Math.random() * 700 : quick ? 1000 + Math.random() * 2000 : 5000 + Math.random() * 10000;
      this.botTimer = { key: botKey, id: setTimeout(() => { this.botTimer = null; const a = Engine.botAction(this.st, u); if (a && Engine.apply(this.st, u, a, Date.now()) === null) this.changed(); else this.schedule(); }, ms), at: Date.now() + ms, u };
    }
    // bots crown others when a title has options and no human picked within 6 seconds
    const r = st.lastResult;
    if (st.phase === 'HAND_RESULT' && r && r.titleOptions && !r.crownedBy) { const b = st.seats.find(u => st.bots[u] && u !== r.uid);
      if (b) this.timers.push(setTimeout(() => { const o = r.titleOptions; if (Engine.apply(this.st, b, { type: 'CROWN', payload: { name: o[Math.floor(Math.random() * o.length)] } }, Date.now()) === null) this.changed(); }, 6000)); }
  }
  quips() {
    const st = this.st; if (!st || !st.seats || !this.onQuip) return;
    const bots = st.seats.filter(u => st.bots[u]); if (!bots.length) return;
    const say = (u, list, pr) => { if (u && Math.random() < (pr || 0.5)) this.onQuip(u, list[Math.floor(Math.random() * list.length)]); };
    let key = '';
    if (st.phase === 'CUT_REVEAL') { key = 'c' + st.handNo + '-' + st.transfer.endsAt; if (key !== this.quipKey) { const g = st.seats[st.transfer.giver], r = st.seats[st.transfer.recipient];
        if (st.bots[g]) say(g, QUIPS.cut, 0.25); else if (st.bots[r]) say(r, QUIPS.pickup, 0.3); } }
    if (st.phase === 'HAND_RESULT' || st.phase === 'MATCH_RESULT') { key = 'h' + st.handNo; if (key !== this.quipKey) { const d = st.lastResult.uid;
        if (st.bots[d]) say(d, QUIPS.selfDonkey); else say(bots[Math.floor(Math.random() * bots.length)], QUIPS.tease); } }
    if (key) this.quipKey = key;
  }
  async publish() {
    this.seq++;
    const st = this.st, members = this.roster().map(p => ({ uid: p.uid, name: p.name, bot: p.bot, level: p.level || null, ready: p.ready, audio: p.audio }));
    const doc = { code: this.code, hostUid: this.uid, seq: this.seq, writtenAt: Date.now(),
      lobby: { seatsWanted: this.lobby.seatsWanted, mode: this.lobby.mode, tz: this.lobby.tz, titlesOn: this.lobby.titlesOn !== false, titles: this.lobby.titles || DEFAULT_LEVELS, target: this.lobby.target || 5, botLevel: this.lobby.botLevel, botSpeed: this.lobby.botSpeed || 'real', watchers: Object.entries(this.lobby.watchers || {}).map(([uid, w]) => ({ uid, name: w.name })), musicLock: MUSIC_LOCK, botThinking: this.botTimer ? { u: this.botTimer.u, at: this.botTimer.at } : null, targets: this.lobby.targets || [], hints: this.lobby.hints !== false, members, kicked: Object.keys(this.lobby.kicked) },
      music: this.music, proposals: this.proposals, match: st ? Engine.publicView(st) : null, acks: this.acks, hands: {}, hostPub: this.keys ? this.keys.pub : null };
    this.out(doc, st ? Engine.privateHand(st, this.uid) : [], st ? Engine.conspiracyHint(st, this.uid) : null);
    if (this.local || !this.net) return;
    const plain = {};
    if (st && st.hands) for (const u of st.seats) if (u !== this.uid && !st.bots[u]) plain[u] = { cards: Engine.privateHand(st, u), hint: Engine.conspiracyHint(st, u), pub: this.lobby.members[u] && this.lobby.members[u].pub };
    const v = st ? st.v : 0;
    this.chain = (this.chain || Promise.resolve()).then(async () => {
      for (const [u, h] of Object.entries(plain)) {
        if (Crypt.ok && h.pub && this.keys) { try { doc.hands[u] = await Crypt.enc(await Crypt.key(this.keys.priv, h.pub), { v, cards: h.cards, hint: h.hint }); continue; } catch (e) {} }
        doc.hands[u] = { plain: h.cards, hint: h.hint };
      }
      this.net.writePub(doc);
    });
  }
  save() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => { const s = this.snapshot(); if (this.local) return; LS.set('dotd-host-' + this.code, s); this.net && this.net.writePrivate(s); }, 800);
  }
}
