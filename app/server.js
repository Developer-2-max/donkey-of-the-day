/* Donkey of the Day — self-hosted game server.
   The server is the referee: it shuffles, deals, checks every move, runs the bots and timers, and keeps each hand private. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { makeFilter } = require('./lib/moderation');
const { Profiles } = require('./lib/profiles');
const { Hall } = require('./lib/hall');
const { loadShared } = require('./lib/rules');
const { entriesFor } = require('./lib/history');
const { Buckets } = require('./lib/ratelimit');
const { Accounts } = require('./lib/accounts');
const { verifyIdToken } = require('./lib/google');
const { Passwords } = require('./lib/passwords');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(DATA, 'audio');          // drop MP3s here: music/<id>.mp3 and commentary/<id>.mp3
const MAX_ROOMS = +process.env.MAX_ROOMS || 500;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';                   // Google sign-in is switched on by setting this
const PUBLIC_ROOMS = process.env.PUBLIC_ROOMS !== '0';                         // set PUBLIC_ROOMS=0 for invite-only
const MAX_SONGS = 30, MAX_SONG_BYTES = 20e6;
const IDLE_CLOSE_MS = (+process.env.IDLE_CLOSE_MIN || 30) * 60e3;              // no connected players for this long: save and close the room
const ROOM_TTL_MS = (+process.env.ROOM_TTL_HOURS || 72) * 3600e3;              // saved rooms older than this are deleted
for (const d of [path.join(DATA, 'rooms'), path.join(DATA, 'songs'), path.join(AUDIO_DIR, 'music'), path.join(AUDIO_DIR, 'commentary')]) fs.mkdirSync(d, { recursive: true });

/* ---- load the same rules engine and room logic the browser uses ---- */
const S = loadShared();
const { Host, Engine, THROWS, BOT_HIT } = S;

/* ---- identities: a browser keeps a random id + secret; the server binds them on first use ---- */
const idFile = path.join(DATA, 'identities.json');
const identities = fs.existsSync(idFile) ? JSON.parse(fs.readFileSync(idFile, 'utf8')) : {};
let idSaveT = null; const saveIds = () => { clearTimeout(idSaveT); idSaveT = setTimeout(() => fs.writeFile(idFile, JSON.stringify(identities), () => {}), 1000); };
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function checkIdentity(uid, secret) {
  if (!/^u-[0-9a-f]{16}$/.test(uid || '') || !/^[0-9a-f]{48}$/.test(secret || '')) return false;
  const h = hash(secret); if (!identities[uid]) { identities[uid] = h; saveIds(); return true; }
  return crypto.timingSafeEqual(Buffer.from(identities[uid]), Buffer.from(h));
}
const profiles = new Profiles(path.join(DATA, 'profiles.json'), S, +process.env.GAME_TZ_OFFSET_MIN || 330);   // the daily challenge rolls over at midnight IST unless told otherwise
const hall = new Hall(path.join(DATA, 'hall.json'));
const accounts = new Accounts(path.join(DATA, 'accounts.json'));
const passwords = new Passwords(path.join(DATA, 'users.json'));
const nonces = new Map();   // uid -> { nonce, at }: a one-time value the Google token must carry, so a stolen token can't be replayed from another browser
const filter = makeFilter();
const limits = new Buckets();
const reportsFile = path.join(DATA, 'reports.jsonl');

/* ---- rooms ---- */
const rooms = new Map(); // code -> { host, chat:[], songs:{}, sockets:Set, creatorHand, creatorHint, lastActive, public }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => { for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!rooms.has(c) && !fs.existsSync(roomFile(c))) return c; } };
const roomFile = code => path.join(DATA, 'rooms', code + '.json');
const online = (room, uid) => { for (const s of room.sockets) if (s.data.uid === uid) return true; return false; };
let chatSeq = 0;

function makeRoom(code, creatorUid, creatorName, snap, isPublic) {
  const room = { code, chat: [], songs: {}, sockets: new Set(), creatorHand: [], creatorHint: null, lastActive: Date.now(), saveT: null, public: !!isPublic };
  const net = {
    writePub: doc => broadcast(room, doc),
    writePrivate: () => persist(room)
  };
  room.host = new Host({ code, uid: creatorUid, name: creatorName, local: false, net, public: !!isPublic,
    isOnline: uid => online(room, uid),
    out: (doc, hand, hint, extra) => { room.creatorHand = hand; room.creatorHint = hint; room.creatorExtra = extra; },
    onQuip: (u, x) => pushChat(room, { u, x }),
    onMatchEnd: st => recordMatch(room, st),
    onProgress: (uid, ev) => progress(room, uid, ev) });
  if (snap) { room.host.restore(snap.host); room.public = !!room.host.lobby.public; room.chat = snap.chat || []; room.songs = snap.songs || {};
    const st = room.host.st; if (st && st.deadline && st.deadline < Date.now() && ['TURN', 'PAUSED', 'HAND_RESULT'].includes(st.phase)) st.deadline = Date.now() + (st.turnMs || Engine.T.turn); }
  rooms.set(code, room); return room;
}
const roomData = room => ({ code: room.code, creator: room.host.uid, creatorName: (room.host.lobby.members[room.host.uid] || {}).name, host: room.host.snapshot(), chat: room.chat.slice(-80), songs: room.songs, at: Date.now() });
function persist(room) {
  clearTimeout(room.saveT);
  room.saveT = setTimeout(() => fs.writeFile(roomFile(room.code), JSON.stringify(roomData(room)), () => {}), 400);
}
function persistNow(room) { clearTimeout(room.saveT); try { fs.writeFileSync(roomFile(room.code), JSON.stringify(roomData(room))); } catch (e) { console.warn('persist', room.code, e.message); } }
function loadRoom(code) {
  if (rooms.has(code)) return rooms.get(code);
  let d; try { d = JSON.parse(fs.readFileSync(roomFile(code), 'utf8')); } catch (e) { return null; }
  if (Date.now() - d.at > ROOM_TTL_MS) { fs.unlink(roomFile(code), () => {}); return null; }
  try { const r = makeRoom(d.code, d.creator, d.creatorName || 'Host', d); r.host.schedule(); return r; } catch (e) { console.warn('could not load room', code, e.message); return null; }
}
function closeRoom(room) { room.host.timers.forEach(clearTimeout); if (room.host.botTimer) clearTimeout(room.host.botTimer.id); persistNow(room); rooms.delete(room.code); }
function broadcast(room, doc) {
  room.lastActive = Date.now();
  const pub = Object.assign({}, doc, { hands: {} });
  for (const s of room.sockets) {
    const uid = s.data.uid;
    let hand = [], hint = null, extra = null;
    if (uid === room.host.uid) { hand = room.creatorHand; hint = room.creatorHint; extra = room.creatorExtra || null; }
    else if (doc.hands && doc.hands[uid]) { hand = doc.hands[uid].plain || []; hint = doc.hands[uid].hint || null; extra = doc.hands[uid].x || null; }
    s.emit('state', { doc: pub, hand, hint, extra });
  }
}
function presence(room) { io.to('r:' + room.code).emit('presence', [...new Set([...room.sockets].map(s => s.data.uid))]); }
function pushChat(room, m) { m.id = ++chatSeq; m.t = Date.now(); room.chat.push(m); if (room.chat.length > 120) room.chat.splice(0, room.chat.length - 120); io.to('r:' + room.code).emit('chat', room.chat.slice(-80)); persist(room); }
/* XP and daily challenges: credited to the player's profile (their Google account if signed in) and announced to their own screens */
function progress(room, uid, ev) {
  const key = accounts.keyFor(uid); let msg = null;
  if (ev.xp) { const up = profiles.addXp(key, ev.xp); if (up) msg = 'Level ' + up.level + '!' + (up.unlocked.length ? ' Unlocked: ' + up.unlocked.join(', ') + '.' : ''); }
  if (ev.challenge) { const r = profiles.completeChallenge(key, ev.challenge); if (r) msg = 'Challenge complete: ' + r.challenge.t + '. +' + r.xp + ' XP' + (r.levelUp ? '. Level ' + r.levelUp.level + '!' : ''); }
  for (const s of room.sockets) if (s.data.uid === uid) s.emit('progress', { toast: msg });
}
function recordMatch(room, st) {
  hall.add(st, room.code, u => st.names[u] || 'Player');
  entriesFor(st, room.code).forEach(({ uid, entry }) => profiles.addHistory(accounts.keyFor(uid), entry));   // match history, per account (or per browser for guests)
  const humans = st.seats.filter(u => !st.bots[u]);
  profiles.recordMatch(humans.map(u => ({ uid: accounts.keyFor(u), name: st.names[u], handsSafe: Math.max(0, st.handNo - (st.losses[u] || 0)), donkey: st.award && st.award.uid === u })),
    { room: room.code, title: st.award && st.titleOf ? st.titleOf[st.award.uid] || null : null, date: st.award ? st.award.date : null, losses: st.award ? st.losses[st.award.uid] : 0, at: Date.now() });
}

// restore rooms after a restart, drop expired ones
for (const f of fs.readdirSync(path.join(DATA, 'rooms'))) {
  const code = f.replace(/\.json$/, ''); if (!/^[A-Z]{5}$/.test(code)) continue;
  try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'rooms', f), 'utf8')); if (Date.now() - d.at < ROOM_TTL_MS) { const r = makeRoom(d.code, d.creator, d.creatorName || 'Host', d); r.host.schedule(); } else fs.unlinkSync(path.join(DATA, 'rooms', f)); } catch (e) { console.warn('skip room file', f, e.message); }
}
// every minute: save and close rooms with nobody connected for IDLE_CLOSE_MS; hourly: purge expired room files
setInterval(() => { for (const [, r] of [...rooms]) if (!r.sockets.size && Date.now() - r.lastActive > IDLE_CLOSE_MS) closeRoom(r); }, +process.env.SWEEP_MS || 60e3).unref();
setInterval(() => { for (const f of fs.readdirSync(path.join(DATA, 'rooms'))) { const p = path.join(DATA, 'rooms', f); try { if (Date.now() - fs.statSync(p).mtimeMs > ROOM_TTL_MS && !rooms.has(f.replace(/\.json$/, ''))) fs.unlinkSync(p); } catch (e) {} } limits.sweep(); }, 3600e3).unref();

/* ---- sessions: which rooms a player can come back to ---- */
const seatedIn = (lobby, st) => st ? Object.keys(st.names || {}) : Object.keys((lobby && lobby.members) || {});
let diskRooms = { at: 0, rows: [] };
function savedRoomRows() {   // rooms that are saved on disk but not loaded in memory (cached for 10 s: this reads files)
  if (Date.now() - diskRooms.at < 10e3) return diskRooms.rows;
  const rows = []; let files = []; try { files = fs.readdirSync(path.join(DATA, 'rooms')); } catch (e) {}
  for (const f of files) { const code = f.replace(/\.json$/, ''); if (!/^[A-Z]{5}$/.test(code)) continue; if (rooms.has(code)) continue;
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'rooms', f), 'utf8')); if (Date.now() - d.at > ROOM_TTL_MS) continue; rows.push({ code, lobby: d.host && d.host.lobby, st: d.host && d.host.st, at: d.at, creator: d.creator, online: 0 }); } catch (e) {} }
  diskRooms = { at: Date.now(), rows }; return rows;
}
function myRooms(uids) {
  const set = new Set(uids), out = [];
  const take = (code, lobby, st, at, creator, online) => {
    const seated = seatedIn(lobby, st), mine = seated.find(u => set.has(u)); if (!mine) return;
    const nm = u => (st && st.names && st.names[u]) || (lobby.members[u] && lobby.members[u].name) || 'Player';
    out.push({ code, phase: !st ? 'lobby' : st.phase === 'MATCH_RESULT' ? 'finished' : st.phase === 'INCOMPLETE' ? 'ended' : 'playing', at, me: nm(mine), others: seated.filter(u => u !== mine).map(nm).slice(0, 4), hand: st ? st.handNo : 0, isHost: set.has(creator), public: !!(lobby && lobby.public), online });
  };
  for (const r of rooms.values()) take(r.code, r.host.lobby, r.host.st, r.lastActive, r.host.uid, new Set([...r.sockets].map(s => s.data.uid)).size);
  for (const x of savedRoomRows()) take(x.code, x.lobby || { members: {} }, x.st, x.at, x.creator, 0);
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
/* a signed-in player opens a room code from a new device: if their seat belongs to another of their devices (and that one is not connected), the seat moves here */
function claimSeat(room, uid) {
  if (!accounts.who(uid)) return false;
  const seated = new Set(seatedIn(room.host.lobby, room.host.st)); if (seated.has(uid)) return false;
  const old = accounts.uidsOf(uid).find(u => u !== uid && seated.has(u) && !online(room, u)); if (!old) return false;
  room.host.swapUid(old, uid); room.chat.forEach(c => { if (c.u === old) c.u = uid; });
  for (const s of Object.values(room.songs)) if (s.by === old) s.by = uid;
  return true;
}

/* ---- HTTP: the page, shared code, audio, songs and uploads ---- */
const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
const CSP = "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// event-loop lag is the honest 'is the server keeping up' number: it stays near 0 ms when there is headroom
let lagMs = 0, lagMax = 0, lastTick = Date.now();
setInterval(() => { const now = Date.now(); lagMs = Math.max(0, now - lastTick - 100); lagMax = Math.max(lagMax * 0.98, lagMs); lastTick = now; }, 100).unref();
app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null, publicRooms: PUBLIC_ROOMS }));
app.get('/api/hall', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json({ rows: hall.list().slice(0, 300) }); });
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, sockets: io.engine.clientsCount, uptime: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576), cpuSec: +(process.cpuUsage().user / 1e6 + process.cpuUsage().system / 1e6).toFixed(2), loopLagMs: lagMs, loopLagMaxMs: Math.round(lagMax) }));

// which recorded files exist: the browser plays a clip or track only when its file is there, and falls back to text / synth otherwise
let manifestCache = { at: 0, body: null };
function audioManifest() {
  if (Date.now() - manifestCache.at < 5000 && manifestCache.body) return manifestCache.body;
  const ls = sub => { try { return fs.readdirSync(path.join(AUDIO_DIR, sub)).filter(f => /\.(mp3|m4a|ogg|wav)$/i.test(f)).reduce((o, f) => (o[f.replace(/\.[^.]+$/, '')] = f, o), {}); } catch (e) { return {}; } };
  const music = ls('music');
  // Music may be stored with human-readable filenames. titles.json links those filenames to catalog IDs.
  try {
    let titleFile = path.join(AUDIO_DIR, 'titles.json');
    if (!fs.existsSync(titleFile)) titleFile = path.join(__dirname, 'data', 'audio', 'titles.json');
    const titles = JSON.parse(fs.readFileSync(titleFile, 'utf8').replace(/^\uFEFF/, ''));
    const byTitle = Object.entries(titles).reduce((o, [id, title]) => { o[String(title).trim().toLowerCase()] = id; return o; }, {});
    for (const [stem, file] of Object.entries(music)) {
      const id = byTitle[stem.trim().toLowerCase()];
      if (id) { music[id] = file; delete music[stem]; }
    }
  } catch (e) {}
  manifestCache = { at: Date.now(), body: { music, commentary: ls('commentary') } }; return manifestCache.body;
}
app.get('/audio/manifest.json', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json(audioManifest()); });
app.use('/audio', express.static(AUDIO_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));   // range requests work, so phones can seek to the shared position
// code and pages revalidate on every load (cheap 304s), so an update shows up as soon as the server restarts; icons can be cached
const fresh = { index: false, etag: true, setHeaders: (res, p) => res.set('Cache-Control', /\.(html|js|css|webmanifest)$/.test(p) ? 'no-cache' : 'public, max-age=86400') };
// the website: / is the landing page, /rules the guide, /account the player's games and devices, /play the game. Old invite links (/?room=ABCDE) still land in the right room.
app.get('/', (req, res, next) => { const room = String(req.query.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); if (room) return res.redirect(302, '/play?room=' + room); next(); });
app.use('/shared', express.static(path.join(__dirname, 'shared'), fresh));
app.use(express.static(path.join(__dirname, 'public'), Object.assign({}, fresh, { index: 'index.html', extensions: ['html'] })));

const AUDIO = /^(audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|ogg|webm|flac)|video\/(mp4|webm))$/;
app.post('/api/song', express.raw({ type: () => true, limit: MAX_SONG_BYTES }), (req, res) => {
  const { room: code, uid, secret, title } = req.query; const room = rooms.get(String(code || ''));
  if (!room || !checkIdentity(uid, secret)) return res.status(403).json({ error: 'DENIED' });
  if (room.public) return res.status(403).json({ error: 'UPLOADS_OFF' });                // no uploads in public rooms: avoids copyright takedowns
  if (!limits.take(uid, 'upload')) return res.status(429).json({ error: 'SLOW_DOWN' });
  const seated = room.host.st ? !!room.host.st.names[uid] : !!room.host.lobby.members[uid];
  if (!seated) return res.status(403).json({ error: 'DENIED' });
  const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  if (!AUDIO.test(type) || !Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'TYPE' });
  if (Object.keys(room.songs).length >= MAX_SONGS) return res.status(400).json({ error: 'FULL' });
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFile(path.join(DATA, 'songs', id), req.body, err => {
    if (err) return res.status(500).json({ error: 'UPLOAD' });
    fs.writeFile(path.join(DATA, 'songs', id + '.type'), type, () => {});
    room.songs[id] = { title: String(title || 'Song').slice(0, 60), by: uid, at: Date.now(), clip: false };
    io.to('r:' + room.code).emit('songs', room.songs); persist(room); res.json({ id });
  });
});
app.get('/songs/:id', (req, res) => {
  const id = req.params.id; if (!/^[0-9a-f]{32}$/.test(id)) return res.sendStatus(404);
  const file = path.join(DATA, 'songs', id); if (!fs.existsSync(file)) return res.sendStatus(404);
  let type = 'audio/mpeg'; try { type = fs.readFileSync(file + '.type', 'utf8'); } catch (e) {}
  res.set('Cache-Control', 'private, max-age=86400'); res.type(type); res.sendFile(file);
});

/* ---- realtime ---- */
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64e3, pingInterval: 20000, pingTimeout: 25000 });
io.use((socket, next) => { const { uid, secret } = socket.handshake.auth || {}; if (!checkIdentity(uid, secret)) return next(new Error('BAD_IDENTITY')); socket.data.uid = uid; next(); });

io.on('connection', socket => {
  const uid = socket.data.uid; let room = null; accounts.touch(uid, socket.handshake.headers['user-agent']);
  const limited = kind => !limits.take(uid, kind);
  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { console.error('handler error', e); const ack = a[a.length - 1]; if (typeof ack === 'function') ack({ error: 'SERVER' }); } };
  const enter = r => { if (room && room !== r) exit(); room = r; r.sockets.add(socket); socket.join('r:' + r.code); r.lastActive = Date.now();
    socket.emit('chat', r.chat.slice(-80)); socket.emit('songs', r.songs); presence(r); r.host.publish(); if (r.host.st) r.host.schedule(); };
  const exit = () => { if (!room) return; const r = room; r.sockets.delete(socket); socket.leave('r:' + r.code); presence(r); room = null;
    r.lastActive = Date.now(); if (r.host.st && !online(r, uid)) { try { r.host.presenceChanged(); } catch (e) { console.error(e); } } };

  socket.on('create', safe((d, ack) => {
    if (typeof ack !== 'function' || limited('join')) return;
    if (rooms.size >= MAX_ROOMS) return ack({ error: 'TOO_MANY_ROOMS' });
    const isPublic = PUBLIC_ROOMS && !!(d && d.public);
    const nm = String((d && d.name) || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Player';
    const r = makeRoom(newCode(), uid, isPublic ? filter.clean(nm) : nm, null, isPublic); enter(r); r.host.changed(); profiles.touch(accounts.keyFor(uid), nm); ack({ code: r.code, public: isPublic });
  }));
  socket.on('join', safe((d, ack) => {
    if (typeof ack !== 'function' || limited('join')) return;
    const code = String((d && d.code) || '').toUpperCase(); const r = rooms.get(code) || loadRoom(code); if (!r) return ack({ error: 'NO_ROOM' });
    const nm = String((d && d.name) || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Player', shown = r.public ? filter.clean(nm) : nm;
    const claimed = !d.watch && claimSeat(r, uid); if (claimed) r.host.changed();
    if (uid !== r.host.uid) { if (r.host.memberJoined(uid, { name: shown, joinedAt: Date.now(), watch: !!d.watch, left: false })) r.host.changed(); }
    enter(r); profiles.touch(accounts.keyFor(uid), nm); ack({ ok: true, public: r.public, claimed: !!claimed });
  }));
  socket.on('leave', safe((d, ack) => {
    if (room && uid !== room.host.uid && !room.host.st) { if (room.host.memberJoined(uid, { left: true, watch: !!room.host.lobby.watchers[uid] })) room.host.changed(); }
    exit(); if (typeof ack === 'function') ack({ ok: true });
  }));
  socket.on('act', safe((d, ack) => {
    if (typeof ack !== 'function') return; if (!room) return ack({ error: 'NO_ROOM' }); if (limited('act')) return ack({ reason: 'STALE_STATE' });
    const type = String((d && d.type) || ''), payload = (d && typeof d.payload === 'object' && d.payload) || {};
    if (room.public && typeof payload.x === 'string') payload.x = filter.clean(payload.x);   // nicknames and inside jokes are filtered in public rooms too
    const reason = room.host.act(uid, { type, payload }); ack({ ok: !reason, reason: reason || null });
  }));
  socket.on('chat', safe((text, ack) => {
    if (!room || limited('chat')) return typeof ack === 'function' && ack({ error: 'LIMIT' });
    if (room.host.isMuted(uid)) return typeof ack === 'function' && ack({ error: 'MUTED' });   // "Mute the Donkey"
    let x = String(text || '').trim().slice(0, 240); if (x) { if (room.public) x = filter.clean(x); pushChat(room, { u: uid, x }); }
    if (typeof ack === 'function') ack({ ok: true });
  }));
  socket.on('report', safe((d, ack) => {
    if (!room || limited('report')) return typeof ack === 'function' && ack({ error: 'LIMIT' });
    const m = room.chat.find(c => c.id === (d && d.id)); if (!m || m.u === uid) return typeof ack === 'function' && ack({ error: 'NOT_FOUND' });
    const rec = { at: new Date().toISOString(), room: room.code, public: room.public, reporter: uid, reported: m.u, msg: m.x, msgAt: m.t, reason: String((d && d.reason) || '').slice(0, 120) };
    fs.appendFile(reportsFile, JSON.stringify(rec) + '\n', () => {}); if (typeof ack === 'function') ack({ ok: true });
  }));
  socket.on('react', safe(d => {
    if (!room) return; if (typeof d === 'string') d = { e: d }; if (!d || typeof d !== 'object') return;
    if (d.k === 'throw') {   // a thrown tomato, chappal, egg, rose or hee-haw at a seated player
      const T = THROWS.find(x => x.e === d.e), st = room.host.st;
      if (!T || !st || !st.names[d.to] || d.to === uid || limited('throw')) return;
      const r = room; io.to('r:' + r.code).emit('react', { by: uid, k: 'throw', e: d.e, to: d.to });
      if (st.bots[d.to] && Math.random() < 0.6) { const xs = BOT_HIT[T.n]; setTimeout(() => { if (rooms.get(r.code) === r) pushChat(r, { u: d.to, x: xs[Math.floor(Math.random() * xs.length)] }); }, 1300); }   // the bot answers back
      return;
    }
    if (!limited('react') && ['👏', '😂', '🫏', '😬', '🔥'].includes(d.e)) io.to('r:' + room.code).emit('react', { by: uid, e: d.e });
  }));
  socket.on('hall', safe((d, ack) => { if (typeof ack === 'function') ack({ rows: hall.list().slice(0, 300) }); }));
  socket.on('set-look', safe((d, ack) => { if (typeof ack !== 'function' || limited('act')) return; const key = accounts.keyFor(uid); ack({ ok: profiles.setLook(key, d && d.theme, d && d.back), look: profiles.view(key).look }); }));
  socket.on('profile', safe((d, ack) => { if (typeof ack === 'function') ack(Object.assign(profiles.view(accounts.keyFor(uid)), { account: accounts.who(uid), loginAvailable: !!GOOGLE_CLIENT_ID, passwordLogin: true })); }));
  socket.on('login-nonce', safe((d, ack) => { if (typeof ack !== 'function' || !GOOGLE_CLIENT_ID || limited('login')) return;
    const nonce = crypto.randomBytes(16).toString('hex'); nonces.set(uid, { nonce, at: Date.now() }); ack({ nonce }); }));
  socket.on('login', safe(async (d, ack) => {
    if (typeof ack !== 'function') return; if (!GOOGLE_CLIENT_ID) return ack({ error: 'LOGIN_OFF' }); if (limited('login')) return ack({ error: 'LIMIT' });
    const n = nonces.get(uid); nonces.delete(uid);   // single use
    try {
      if (!n || Date.now() - n.at > 5 * 60e3) throw Object.assign(new Error('BAD_NONCE'), { code: 'BAD_NONCE' });
      const g = await verifyIdToken(d && d.credential, { clientId: GOOGLE_CLIENT_ID, nonce: n.nonce });
      const prev = accounts.keyFor(uid), r = accounts.signIn(uid, g.sub, g.name, socket.handshake.headers['user-agent']);
      profiles.merge(prev, r.to); profiles.touch(r.to, g.name);          // progress made before signing in joins the account
      ack({ ok: true, name: r.account.name });
    } catch (e) { ack({ error: e.code || 'BAD_TOKEN' }); }
  }));
  /* basic login form: username + password. Registering also signs in. Each browser (uid) becomes a session of that account. */
  const passwordSession = async (kind, d, ack) => {
    if (typeof ack !== 'function') return; if (limited('login')) return ack({ error: 'LIMIT' });
    try {
      const g = await passwords[kind](d && d.username, d && d.password);
      const prev = accounts.keyFor(uid), r = accounts.signIn(uid, g.sub, g.name, socket.handshake.headers['user-agent']);
      if (prev === uid) profiles.merge(prev, r.to);   // a guest's progress joins the account; someone already signed in is just switched, never merged into another account
      profiles.touch(r.to, g.name); ack({ ok: true, name: r.account.name });
    } catch (e) { ack({ error: e.code || 'BAD_CREDENTIALS' }); }
  };
  socket.on('register', safe((d, ack) => passwordSession('register', d, ack)));
  socket.on('password-login', safe((d, ack) => passwordSession('verify', d, ack)));
  socket.on('logout', safe((d, ack) => { accounts.signOut(uid); if (typeof ack === 'function') ack({ ok: true }); }));
  /* sessions: match history, rooms to resume, signed-in devices */
  socket.on('history', safe((d, ack) => { if (typeof ack === 'function') ack({ rows: profiles.history(accounts.keyFor(uid)), signedIn: !!accounts.who(uid) }); }));
  socket.on('my-rooms', safe((d, ack) => { if (typeof ack === 'function' && !limited('join')) ack({ rows: myRooms(accounts.uidsOf(uid)), signedIn: !!accounts.who(uid) }); }));
  socket.on('devices', safe((d, ack) => { if (typeof ack === 'function') ack({ rows: accounts.devices(uid) }); }));
  const kick = uids => { for (const s of io.sockets.sockets.values()) if (uids.includes(s.data.uid)) s.emit('signed-out'); };
  socket.on('logout-device', safe((d, ack) => { if (typeof ack !== 'function' || limited('login')) return; const gone = accounts.signOutDevice(uid, String((d && d.id) || '')); if (gone) kick([gone]); ack({ ok: !!gone, rows: accounts.devices(uid) }); }));
  socket.on('logout-all', safe((d, ack) => { if (typeof ack !== 'function' || limited('login')) return; const gone = accounts.signOutAll(uid); kick(gone); ack({ ok: true, signedOut: gone.length }); }));
  socket.on('export-data', safe((d, ack) => { if (typeof ack !== 'function' || limited('join')) return;
    ack({ exportedAt: new Date().toISOString(), profile: profiles.get(accounts.keyFor(uid)) || null,
      account: accounts.who(uid), chat: [...rooms.values()].flatMap(r => r.chat.filter(c => c.u === uid).map(c => ({ room: r.code, at: c.t, text: c.x }))),
      songs: [...rooms.values()].flatMap(r => Object.entries(r.songs).filter(([, s]) => s.by === uid).map(([id, s]) => ({ room: r.code, id, title: s.title }))) }); }));
  socket.on('delete-data', safe((d, ack) => { if (typeof ack !== 'function' || limited('join')) return;
    hall.anonymize(uid);   // the Hall of Shame is public, so the player's name leaves past entries
    const sub = accounts.live(uid); accounts.erase(uid).forEach(k => profiles.remove(k)); if (sub && sub.startsWith('p:')) passwords.remove(sub);   // the account's progress, and this browser's own
    for (const r of rooms.values()) { let changed = false;
      r.chat.forEach(c => { if (c.u === uid) { c.u = 'deleted'; c.x = '[message deleted]'; changed = true; } });
      for (const [id, s] of Object.entries(r.songs)) if (s.by === uid) { delete r.songs[id]; fs.unlink(path.join(DATA, 'songs', id), () => {}); fs.unlink(path.join(DATA, 'songs', id + '.type'), () => {}); changed = true; }
      if (changed) { persist(r); io.to('r:' + r.code).emit('songs', r.songs); io.to('r:' + r.code).emit('chat', r.chat.slice(-80)); } }
    delete identities[uid]; saveIds(); ack({ ok: true }); socket.disconnect(true); }));
  socket.on('disconnect', safe(exit));
});

// one room's bug must never take the other rooms down
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));
function shutdown() { for (const r of rooms.values()) persistNow(r); profiles.flush(); accounts.flush(); passwords.flush(); hall.flush(); try { fs.writeFileSync(idFile, JSON.stringify(identities)); } catch (e) {} process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

if (require.main === module) server.listen(PORT, () => console.log(`Donkey of the Day server on http://localhost:${PORT}`));
module.exports = { server, io, rooms, DATA, AUDIO_DIR };
