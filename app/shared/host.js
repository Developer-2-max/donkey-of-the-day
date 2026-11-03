/* Host: the authoritative room logic. Runs on the server for online rooms and in the browser for practice tables.
   It never touches the network itself: the caller passes `net` (online) or reads `out` (practice). */
const BOT_NAMES = ['BotKunal', 'BotNinad', 'BotBajrangbali', 'BotMitesh', 'BotPritesh', 'BotAlldrin', 'BotAllen'];
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['pro', 'Pro']];
const DEFAULT_LEVELS = [
  ['Nanha Gadha', 'Pickup Pappu', 'Kachra Kid', 'Lallu Lottery'],
  ['Captain Kachra', 'Patta Pehelwan', 'Fattu Fakir', 'Tingu Tycoon'],
  ['Professor Pickup', 'Bhaukaal Babu', 'Dhakkan Don', 'Jhol Jhaal Jeeja'],
  ['Lord Lafda', 'Bawandar Bhaiya', 'Gadha Shiromani', 'Sir Haar Singh'],
  ['Maharaja Gadha-e-Azam', 'Emperor of Hee-Haw', 'Supreme Pickup Sultan']];
const QUIPS = {
  cut: ['Le bhai, sambhal ke! 😄', 'Mere taraf se prasad 🙏', 'Gift hai, rakh lo', 'Pickup time! 📦', 'Yeh lo, aur lo!'],
  pickup: ['Arre yaar, yeh kya hua 😩', 'Theek hai, dekh lunga', 'Itne saare patte? Kyun?'],
  selfDonkey: ['Arre yaar, phir se main? 🫏', 'Agli baar dekh lena', 'Gadha nahi, strategist hoon main'],
  tease: ['Badhai ho, naya title! 🎉', 'Hee-haw! 🫏', 'Kya khel gaye boss 😂', 'Title mubarak ho!']
};
const FUN_DEFAULTS = { shuffle: true, powers: false, blitz: false, bets: true, mute: false, spice: 'device' };
const AWAY_TURN_MS = 15000;      // when the player whose turn it is has lost connection, the table waits this long

class Host {
  constructor(o) {
    this.code = o.code; this.uid = o.uid; this.local = o.local; this.out = o.out; this.net = o.net || null;
    this.isOnline = o.isOnline || (() => true);
    this.lobby = { seatsWanted: o.local ? (o.seats || 4) : 4, mode: 'single', titlesOn: true, titles: DEFAULT_LEVELS.map(l => l.slice()), target: 5, targets: [], hints: true, botSpeed: 'real', watchers: {},
      fun: Object.assign({}, FUN_DEFAULTS), nick: {}, jokes: [], botLevel: o.botLevel || 'medium', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', members: {}, kicked: {}, public: !!o.public };
    this.lobby.members[o.uid] = { name: o.name, bot: false, joinedAt: Date.now() };
    this.music = { kind: 'catalog', track: DEFAULT_TRACK, startedAt: Date.now(), by: null };
    this.botTimer = null; this.st = null; this.seq = 0; this.timers = []; this.memberCache = {};
    this.saveT = null; this.onQuip = o.onQuip || null; this.onMatchEnd = o.onMatchEnd || null; this.onProgress = o.onProgress || null; this.quipKey = '';
    this.reported = null; this.prog = { mk: null, last: 0, seenH: {}, sd: {}, done: false };
  }
  snapshot() { return { lobby: this.lobby, music: this.music, st: this.st, seq: this.seq, reported: this.reported }; }
  restore(s) {
    const L = s.lobby || {};
    if (!(Array.isArray(L.titles) && L.titles.length === 5 && L.titles.every(Array.isArray))) L.titles = DEFAULT_LEVELS.map(l => l.slice());
    L.target = L.target || 5; L.watchers = L.watchers || {}; L.botSpeed = L.botSpeed || 'real'; L.targets = L.targets || []; L.kicked = L.kicked || {};
    if (L.hints === undefined) L.hints = true;
    L.public = !!L.public; L.fun = Object.assign({}, FUN_DEFAULTS, L.fun || {}); L.nick = L.nick || {}; L.jokes = L.jokes || [];
    if (L.fun.blitz === undefined) L.fun.blitz = !!L.blitz; delete L.blitz; delete L.commentary;
    Object.values(L.members || {}).forEach(m => { delete m.ready; delete m.audio; delete m.pub; });
    const mu = s.music || {};
    if (!(mu.kind === 'song' || (mu.kind === 'catalog' && catalogTrack(mu.track)))) s.music = { kind: 'catalog', track: DEFAULT_TRACK, startedAt: mu.startedAt || Date.now(), by: mu.by || null };
    Object.assign(this, { lobby: Object.assign(this.lobby, L), music: s.music, st: s.st, seq: s.seq || 0 });
    this.reported = s.reported || null;
    if (this.st) { if (!this.st.opts) this.st.opts = { shuffle: false, powers: false, blitz: false, bets: false }; if (['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) this.reported = this.st.matchId; }
  }
  roster() { return Object.entries(this.lobby.members).sort((a, b) => a[1].joinedAt - b[1].joinedAt).map(([uid, m]) => ({ uid, ...m })); }
  memberJoined(uid, d) {
    this.memberCache[uid] = d;
    const L = this.lobby, m = L.members[uid];
    if (d.watch && !m) { if (d.left) { if (L.watchers[uid]) { delete L.watchers[uid]; return true; } return false; }
      const had = !!L.watchers[uid]; L.watchers[uid] = { name: String(d.name || 'Guest').slice(0, 24), joinedAt: d.joinedAt || Date.now() }; return !had; }
    if (!d.watch && L.watchers[uid] && !d.left) delete L.watchers[uid];
    if (m) { if (d.name && !this.st) m.name = d.name; if (d.left && !this.st && uid !== this.uid) { delete L.members[uid]; return true; } return false; }
    if (d.left || this.st && !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return false;
    if (L.kicked[uid] && !(d.joinedAt > L.kicked[uid])) return false;
    if (Object.keys(L.members).length >= L.seatsWanted) return false;
    L.members[uid] = { name: String(d.name || 'Player').slice(0, 24), bot: false, joinedAt: d.joinedAt || Date.now() };
    return true;
  }
  rescanMembers() { Object.entries(this.memberCache).forEach(([u, d]) => { if (!this.lobby.members[u]) this.memberJoined(u, d); }); }
  newMatch(players, now, mode, tz) {
    const L = this.lobby;
    return Engine.createMatch({ players, mode, tz, now, matchId: 'M' + now.toString(36).toUpperCase(), titles: L.titlesOn ? L.titles : null, target: L.target || 5,
      targets: (L.targets || []).filter(u => players.some(p => p.uid === u)), hints: L.hints !== false, fun: L.fun });
  }
  /* the Donkey of the last hand cannot chat during the next hand when "Mute the Donkey" is on */
  isMuted(uid) { const st = this.st, r = st && st.lastResult; return !!(this.lobby.fun.mute && r && r.uid === uid && st.handNo === r.handNo + 1); }
  handle(uid, a) {
    const L = this.lobby, now = Date.now(), isHost = uid === this.uid, inLobby = !this.st;
    const m = L.members[uid], p = (a && a.payload) || {}, inMatch = !!(this.st && this.st.names[uid]);
    switch (a.type) {
      case 'SELECT_TRACK': case 'SET_MUSIC': {
        const why = this.musicBlock(uid); if (why) return why;
        if (p.song) { if (L.public) return 'UPLOADS_OFF'; if (!/^[0-9a-f]{32}$|^local-/.test(String(p.song.id))) return 'WRONG_PHASE';
          this.music = { kind: 'song', song: { id: String(p.song.id), title: String(p.song.title || 'Song').slice(0, 60) }, startedAt: now, by: uid }; }
        else { if (!catalogTrack(p.track)) return 'WRONG_PHASE'; this.music = { kind: 'catalog', track: p.track, startedAt: now, by: uid }; }
        break; }
      case 'ADD_BOT': if (!isHost || !inLobby) return 'NOT_HOST'; if (Object.keys(L.members).length >= L.seatsWanted) return 'ROOM_FULL';
        this.addBot(p.level, now); break;
      case 'FILL_BOTS': if (!isHost || !inLobby) return 'NOT_HOST';
        while (Object.keys(L.members).length < L.seatsWanted) this.addBot(p.level, now); break;
      case 'SET_BOT_LEVEL': if (!isHost || !inLobby) return 'NOT_HOST'; { const t = L.members[p.uid]; if (!t || !t.bot || !LEVELS.some(l => l[0] === p.level)) return 'WRONG_PHASE'; t.level = p.level; } break;
      case 'SET_CONSPIRACY': if (!isHost || !inLobby) return 'NOT_HOST';
        if (Array.isArray(p.targets)) L.targets = p.targets.filter(u => L.members[u]).slice(0, 4);
        if ('hints' in p) L.hints = !!p.hints; break;
      case 'SET_TARGET': if (!isHost || !inLobby) return 'NOT_HOST'; L.target = [2, 3, 5].includes(p.n) ? p.n : 5; break;
      case 'SET_FUN': { if (!isHost || !inLobby) return 'NOT_HOST'; const F = L.fun;
        if (['shuffle', 'powers', 'blitz', 'bets', 'mute'].includes(p.k)) F[p.k] = !!p.v; else if (p.k === 'spice' && ['device', 'off', 'halka', 'teekha'].includes(p.v)) F.spice = p.v; else return 'WRONG_PHASE'; break; }
      case 'SET_NICK': { const known = L.members[p.u] || (this.st && this.st.names[p.u]); if (!m && !inMatch) return 'NOT_IN_MATCH'; if (!known) return 'WRONG_PHASE';
        const x = String(p.x || '').replace(/\s+/g, ' ').trim().slice(0, 20); if (x) L.nick[p.u] = x; else delete L.nick[p.u]; break; }
      case 'ADD_JOKE': { if (!m && !inMatch) return 'NOT_IN_MATCH'; const x = String(p.x || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!x) return 'EMPTY_NAME';
        L.jokes.push({ by: uid, x }); if (L.jokes.length > 30) L.jokes.shift(); break; }
      case 'DEL_JOKE': { if (!isHost) return 'NOT_HOST'; const i = p.i; if (!(i >= 0 && i < L.jokes.length)) return 'WRONG_PHASE'; L.jokes.splice(i, 1); break; }
      case 'SET_BOT_SPEED': if (!isHost) return 'NOT_HOST'; L.botSpeed = p.speed === 'quick' ? 'quick' : 'real'; break;
      case 'SET_TITLES': if (!isHost || !inLobby) return 'NOT_HOST';
        if ('on' in p) L.titlesOn = !!p.on;
        if (Array.isArray(p.levels) && p.levels.length === 5) L.titles = p.levels.map((v, i) => { const l = String(v || '').split(',').map(t => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12); return l.length ? l : DEFAULT_LEVELS[i].slice(); });
        break;
      case 'REMOVE': if (!isHost || !inLobby) return 'NOT_HOST'; { const t = L.members[p.uid]; if (!t || p.uid === this.uid) return 'WRONG_PHASE'; delete L.members[p.uid]; if (!t.bot) L.kicked[p.uid] = now; } break;
      case 'SET_SEATS': if (!isHost || !inLobby) return 'NOT_HOST'; { const n = p.n === 5 ? 5 : 4;
          while (Object.keys(L.members).length > n) { const b = this.roster().reverse().find(x => x.bot); if (!b) return 'ROOM_FULL'; delete L.members[b.uid]; }
          L.seatsWanted = n; } break;
      case 'SET_MODE': if (!isHost || !inLobby) return 'NOT_HOST'; L.mode = p.mode === 'split' ? 'split' : 'single'; break;
      case 'START': { if (!isHost || !inLobby) return 'NOT_HOST'; const r = this.roster();
          if (r.length !== L.seatsWanted) return 'SEATS_NOT_FULL';   // the only condition: every seat is filled (humans plus bots)
          this.st = this.newMatch(r.map(x => ({ uid: x.uid, name: x.name, bot: x.bot, level: x.level })), now, L.mode, L.tz); break; }
      case 'REMATCH': if (!isHost || !this.st || !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        { const prev = this.st; this.st = this.newMatch(prev.lobby.map(u => ({ uid: u, name: prev.names[u], bot: prev.bots[u], level: prev.levels && prev.levels[u] })), now, prev.mode, prev.tz); } break;
      case 'BACK_TO_LOBBY': if (!isHost || !this.st || !['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        this.st = null; this.rescanMembers(); break;
      case 'END_MATCH': if (!isHost || !this.st || ['MATCH_RESULT', 'INCOMPLETE'].includes(this.st.phase)) return 'NOT_HOST';
        this.st.phase = 'INCOMPLETE'; this.st.deadline = null; this.st.incompleteReason = 'The host ended the match early.'; this.st.v++; break;
      default:
        if (!this.st) return 'WRONG_PHASE';
        { const r = Engine.apply(this.st, uid, a, now); if (r) return r; }
    }
    return null;
  }
  addBot(level, now) {
    const L = this.lobby, used = new Set(Object.values(L.members).map(x => x.name)), free = BOT_NAMES.filter(n => !used.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot';
    const lv = LEVELS.some(l => l[0] === level) ? level : (L.botLevel || 'medium');
    L.members['bot-' + Math.random().toString(36).slice(2, 8)] = { name, bot: true, level: lv, joinedAt: now };
  }
  /* who may change the room song right now: any seated player, except whoever has the most losses (the Donkey punishment) */
  musicBlock(uid) {
    const seated = this.st ? !!this.st.names[uid] : !!this.lobby.members[uid];
    if (!seated) return 'WATCHERS_NO_MUSIC';
    if (this.st && this.st.losses) { const max = Math.max(...Object.values(this.st.losses)); if (max > 0 && this.st.losses[uid] === max) return 'LOSER_NO_MUSIC'; }
    return null;
  }
  act(uid, a) { const r = this.handle(uid, a); this.changed(); return r; }
  changed() { this.schedule(); this.quips(); this.progressTick(); this.publish(); this.save(); this.matchEnd(); }
  /* a player's connection came or went: if it is their turn, do not make the table wait the full turn */
  presenceChanged() { this.changed(); }
  schedule() {
    this.timers.forEach(clearTimeout); this.timers = [];
    const st = this.st; if (!st) return;
    const now = Date.now();
    if (st.phase === 'TURN' && st.actor && !st.bots[st.actor] && !this.isOnline(st.actor) && st.deadline && st.deadline - now > AWAY_TURN_MS) { st.deadline = now + AWAY_TURN_MS; st.v++; }
    const dls = [st.deadline, st.phase === 'DEALING' ? st.dealTotal : null].filter(x => x != null);
    if (dls.length) this.timers.push(setTimeout(() => { if (Engine.tick(this.st, Date.now())) this.changed(); else this.schedule(); }, Math.max(0, Math.min(...dls) - now) + 30));
    let botKey = null;
    if (st.seats) for (const u of st.seats) if (st.bots[u] && Engine.botAction(st, u)) { botKey = st.v + ':' + u; break; }
    if (this.botTimer && this.botTimer.key !== botKey) { clearTimeout(this.botTimer.id); this.botTimer = null; }
    if (botKey && !this.botTimer) {
      const u = botKey.split(':').slice(1).join(':'), dealing = ['DEALING', 'SHUFFLE', 'DECK_CUT'].includes(st.phase);
      const quick = this.lobby.botSpeed === 'quick';
      let ms = dealing ? (st.phase === 'DEALING' ? 150 + Math.random() * 250 : 1500 + Math.random() * 700) :   // a bot dealing one card at a time must not keep the table waiting a minute
       quick ? 1000 + Math.random() * 2000 : 5000 + Math.random() * 10000;
      if (st.turnMs && st.turnMs < 20000 && !dealing) ms = Math.min(ms, 1500 + Math.random() * 3500);   // Blitz: bots must move inside the 10 s turn
      this.botTimer = { key: botKey, id: setTimeout(() => { this.botTimer = null; const a = Engine.botAction(this.st, u); if (a && Engine.apply(this.st, u, a, Date.now()) === null) this.changed(); else this.schedule(); }, ms), at: Date.now() + ms, u };
    }
    // bots crown others when a title has options and no human picked within 6 seconds
    const r = st.lastResult;
    if (st.phase === 'HAND_RESULT' && r && r.titleOptions && !r.crownedBy) { const b = st.seats.find(u => st.bots[u] && u !== r.uid);
      if (b) this.timers.push(setTimeout(() => { const o = r.titleOptions; if (Engine.apply(this.st, b, { type: 'CROWN', payload: { name: o[Math.floor(Math.random() * o.length)] } }, Date.now()) === null) this.changed(); }, 6000)); }
  }
  matchEnd() {
    const st = this.st; if (!st || !this.onMatchEnd || this.reported === st.matchId) return;
    if (st.phase === 'MATCH_RESULT' && st.award) { this.reported = st.matchId; try { this.onMatchEnd(st); } catch (e) { console.warn('onMatchEnd', e); } }
  }
  /* XP and daily challenges, awarded to every human at the table from what happens in the match (Lab rules, now decided on the server) */
  progressTick() {
    const st = this.st, P = this.prog; if (!st || !st.matchId || !st.seats || !this.onProgress) return;
    const evs = st.events || [], maxId = Math.max(0, ...evs.map(e => e.id || 0));
    if (P.mk !== st.matchId) { Object.assign(P, { mk: st.matchId, last: maxId, seenH: {}, sd: {}, done: !!st.award }); return; }   // a new (or resumed) match: never replay old events
    const humans = st.seats.filter(u => !st.bots[u]), act = st.finished ? st.seats.filter((u, i) => !st.finished[i]) : [];
    if (st.phase === 'TURN' && st.seats.length >= 3 && act.length === 2) act.forEach(u => { P.sd[u] = st.handNo; });   // the final two
    const xp = (u, n) => this.onProgress(u, { xp: n }), done = (u, id) => this.onProgress(u, { challenge: id });
    for (const e of evs) {
      if (!e.id || e.id <= P.last) continue; P.last = e.id;
      for (const me of humans) {
        const mineCuts = evs.filter(x => x.h === e.h && x.k === 'cut' && x.u === me).length;
        if (e.k === 'cut' && e.u === me) { if (e.total >= 5) done(me, 'big5'); if (mineCuts >= 3) done(me, 'threecuts'); }
        if (e.k === 'out' && e.u === me) { if (!mineCuts) done(me, 'nocut'); if (!evs.some(x => x.h === e.h && x.k === 'out' && x.id < e.id)) { done(me, 'first'); xp(me, XP.firstOut); } }
        if (e.k === 'power' && e.u === me) done(me, 'magic');
        if (e.k === 'donkey' && !P.seenH[me + ':' + e.h]) { P.seenH[me + ':' + e.h] = 1; xp(me, e.u === me ? XP.donkeySelf : XP.donkeyOther);
          if (e.u !== me && P.sd[me] === e.h) done(me, 'survive');
          const r = st.lastResult; if (r && r.bets && r.bets[me] && r.bets[me] === e.u) done(me, 'bet'); }
      }
    }
    if (st.phase === 'MATCH_RESULT' && st.award && !P.done) { P.done = true; for (const me of humans) { xp(me, XP.match); if ((st.losses[me] || 0) <= 1) done(me, 'lowloss'); } }
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
  publish() {
    this.seq++;
    const st = this.st, members = this.roster().map(p => ({ uid: p.uid, name: p.name, bot: p.bot, level: p.level || null }));
    const doc = { code: this.code, hostUid: this.uid, seq: this.seq, writtenAt: Date.now(),
      lobby: { seatsWanted: this.lobby.seatsWanted, mode: this.lobby.mode, tz: this.lobby.tz, titlesOn: this.lobby.titlesOn !== false, titles: this.lobby.titles || DEFAULT_LEVELS, target: this.lobby.target || 5, botLevel: this.lobby.botLevel, botSpeed: this.lobby.botSpeed || 'real',
        watchers: Object.entries(this.lobby.watchers || {}).map(([uid, w]) => ({ uid, name: w.name })), botThinking: this.botTimer ? { u: this.botTimer.u, at: this.botTimer.at } : null,
        targets: this.lobby.targets || [], hints: this.lobby.hints !== false, fun: this.lobby.fun, nick: this.lobby.nick || {}, jokes: this.lobby.jokes || [], members, kicked: Object.keys(this.lobby.kicked),
        public: !!this.lobby.public },
      music: this.music, match: st ? Engine.publicView(st) : null, hands: {} };
    this.out(doc, st ? Engine.privateHand(st, this.uid) : [], st ? Engine.conspiracyHint(st, this.uid) : null, st && st.hands ? Engine.privateExtra(st, this.uid) : null);
    if (this.local || !this.net) return;
    // each player is sent only their own cards, hint and private info (such as a Peek result); the server fans this out per socket
    if (st && st.hands) for (const u of st.seats) if (u !== this.uid && !st.bots[u]) doc.hands[u] = { plain: Engine.privateHand(st, u), hint: Engine.conspiracyHint(st, u), x: Engine.privateExtra(st, u) };
    this.net.writePub(doc);
  }
  save() {
    if (this.local || !this.net) return;
    this.net.writePrivate(this.snapshot());   // the server debounces the disk write, so every move is saved within a moment
  }
}
