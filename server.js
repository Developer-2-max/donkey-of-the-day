/* Donkey of the Day — self-hosted game server.
   The server is the referee: it shuffles, deals, checks every move and keeps each hand private. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm'), http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_ROOMS = +process.env.MAX_ROOMS || 500;
const MAX_SONGS = 30, MAX_SONG_BYTES = 20e6, IDLE_MS = 6 * 3600e3;
fs.mkdirSync(path.join(DATA, 'rooms'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'songs'), { recursive: true });

/* ---- load the same rules engine and room logic the browser uses ---- */
const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, crypto: crypto.webcrypto, btoa, atob, TextEncoder, TextDecoder };
sandbox.window = sandbox; vm.createContext(sandbox);
const src = ['engine.js', 'music.js', 'host.js'].map(f => fs.readFileSync(path.join(__dirname, 'shared', f), 'utf8')).join('\n;\n');
vm.runInContext(src + '\n;this.Host = Host; this.TRACKS = TRACKS; this.QUIPS = QUIPS;', sandbox, { filename: 'shared.js' });
const { Host, Engine } = sandbox;

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

/* ---- rooms ---- */
const rooms = new Map(); // code -> { host, chat:[], songs:{}, sockets:Set, creatorHand, creatorHint, lastActive }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => { for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!rooms.has(c)) return c; } };
const roomFile = code => path.join(DATA, 'rooms', code + '.json');

function makeRoom(code, creatorUid, creatorName, snap) {
  const room = { code, chat: [], songs: {}, sockets: new Set(), creatorHand: [], creatorHint: null, lastActive: Date.now(), saveT: null };
  const net = {
    writePub: doc => broadcast(room, doc),
    writePrivate: s => { room.snap = s; persist(room); }
  };
  room.host = new Host({ code, uid: creatorUid, name: creatorName, local: false, net,
    out: (doc, hand, hint) => { room.creatorHand = hand; room.creatorHint = hint; },
    onQuip: (u, x) => pushChat(room, { u, t: Date.now(), x }) });
  if (snap) { room.host.restore(snap.host); room.chat = snap.chat || []; room.songs = snap.songs || {};
    const st = room.host.st; if (st && st.deadline && st.deadline < Date.now() && ['TURN', 'PAUSED', 'HAND_RESULT'].includes(st.phase)) st.deadline = Date.now() + Engine.T.turn; }
  rooms.set(code, room); return room;
}
function persist(room) {
  clearTimeout(room.saveT);
  room.saveT = setTimeout(() => {
    const data = { code: room.code, creator: room.host.uid, creatorName: (room.host.lobby.members[room.host.uid] || {}).name, host: room.host.snapshot(), chat: room.chat.slice(-80), songs: room.songs, at: Date.now() };
    fs.writeFile(roomFile(room.code), JSON.stringify(data), () => {});
  }, 1000);
}
function broadcast(room, doc) {
  room.lastActive = Date.now();
  const pub = Object.assign({}, doc, { hands: {} });
  for (const s of room.sockets) {
    const uid = s.data.uid;
    let hand = [], hint = null;
    if (uid === room.host.uid) { hand = room.creatorHand; hint = room.creatorHint; }
    else if (doc.hands && doc.hands[uid]) { hand = doc.hands[uid].plain || []; hint = doc.hands[uid].hint || null; }
    s.emit('state', { doc: pub, hand, hint });
  }
}
function presence(room) { io.to('r:' + room.code).emit('presence', [...new Set([...room.sockets].map(s => s.data.uid))]); }
function pushChat(room, m) { room.chat.push(m); if (room.chat.length > 120) room.chat.splice(0, room.chat.length - 120); io.to('r:' + room.code).emit('chat', room.chat.slice(-80)); persist(room); }

// restore rooms after a restart
for (const f of fs.readdirSync(path.join(DATA, 'rooms'))) {
  try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'rooms', f), 'utf8')); if (Date.now() - d.at < IDLE_MS) { const r = makeRoom(d.code, d.creator, d.creatorName || 'Host', d); r.host.schedule(); } else fs.unlinkSync(path.join(DATA, 'rooms', f)); } catch (e) { console.warn('skip room file', f, e.message); }
}
// tidy idle rooms every 10 minutes
setInterval(() => { for (const [code, r] of rooms) if (!r.sockets.size && Date.now() - r.lastActive > IDLE_MS) { r.host.timers.forEach(clearTimeout); rooms.delete(code); fs.unlink(roomFile(code), () => {}); } }, 600e3);

/* ---- HTTP: the page, songs and uploads ---- */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' }); next(); });
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
const AUDIO = /^(audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|ogg|webm|flac)|video\/(mp4|webm))$/;
app.post('/api/song', express.raw({ type: () => true, limit: MAX_SONG_BYTES }), (req, res) => {
  const { room: code, uid, secret, title } = req.query; const room = rooms.get(String(code || ''));
  if (!room || !checkIdentity(uid, secret)) return res.status(403).json({ error: 'DENIED' });
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
  const uid = socket.data.uid; let room = null, lastMsg = 0, burst = 0;
  const limited = () => { const now = Date.now(); burst = now - lastMsg < 400 ? burst + 1 : 0; lastMsg = now; return burst > 8; };
  const enter = r => { if (room && room !== r) exit(); room = r; r.sockets.add(socket); socket.join('r:' + r.code); r.lastActive = Date.now();
    socket.emit('chat', r.chat.slice(-80)); socket.emit('songs', r.songs); presence(r); r.host.publish(); };
  const exit = () => { if (!room) return; room.sockets.delete(socket); socket.leave('r:' + room.code); presence(room); room = null; };
  const name = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Player';

  socket.on('create', (d, ack) => {
    if (typeof ack !== 'function' || limited()) return;
    if (rooms.size >= MAX_ROOMS) return ack({ error: 'TOO_MANY_ROOMS' });
    const r = makeRoom(newCode(), uid, name(d && d.name)); enter(r); r.host.changed(); ack({ code: r.code });
  });
  socket.on('join', (d, ack) => {
    if (typeof ack !== 'function' || limited()) return;
    const r = rooms.get(String((d && d.code) || '').toUpperCase()); if (!r) return ack({ error: 'NO_ROOM' });
    if (uid !== r.host.uid) { if (r.host.memberJoined(uid, { name: name(d.name), joinedAt: Date.now(), watch: !!d.watch, left: false })) r.host.changed(); }
    enter(r); ack({ ok: true });
  });
  socket.on('leave', (d, ack) => {
    if (room && uid !== room.host.uid && !room.host.st) { if (room.host.memberJoined(uid, { left: true, watch: !!room.host.lobby.watchers[uid] })) room.host.changed(); }
    exit(); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('act', (d, ack) => {
    if (typeof ack !== 'function') return; if (!room) return ack({ error: 'NO_ROOM' }); if (limited()) return ack({ reason: 'STALE_STATE' });
    const type = String((d && d.type) || ''), payload = (d && typeof d.payload === 'object' && d.payload) || {};
    const reason = room.host.act(uid, { type, payload }); ack({ ok: !reason, reason: reason || null });
  });
  socket.on('chat', (text, ack) => {
    if (!room || limited()) return typeof ack === 'function' && ack({ error: 'LIMIT' });
    const x = String(text || '').trim().slice(0, 240); if (x) pushChat(room, { u: uid, t: Date.now(), x });
    if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('react', e => { if (room && !limited() && ['👏', '😂', '🫏', '😬', '🔥'].includes(e)) io.to('r:' + room.code).emit('react', { by: uid, e }); });
  socket.on('disconnect', exit);
});

server.listen(PORT, () => console.log(`Donkey of the Day server on http://localhost:${PORT}`));
