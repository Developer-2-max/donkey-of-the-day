'use strict';
/* Test helpers: start the real server on a free port with a throwaway data folder, and connect scripted players. */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), crypto = require('crypto');
const { io } = require('socket.io-client');

const rnd = n => crypto.randomBytes(n).toString('hex');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer(env = {}, reuse = {}) {
  const port = reuse.port || await freePort(), dir = reuse.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'dotd-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir }, env), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  const url = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url + '/healthz'); if (r.ok) break; } catch (e) {} await sleep(100); }
  return { port, dir, url, child, log: () => log, stop: () => new Promise(r => { child.once('exit', r); child.kill('SIGINT'); setTimeout(() => { child.kill(); r(); }, 3000); }) };
}

function identity() { return { uid: 'u-' + rnd(8), secret: rnd(24) }; }

function player(url, id = identity()) {
  const socket = io(url, { auth: id, transports: ['websocket'], reconnection: false });
  const p = { id, socket, state: null, hand: [], chat: [], songs: {}, states: 0 };
  socket.on('state', m => { p.state = m.doc; p.hand = m.hand; p.hint = m.hint; p.states++; });
  socket.on('chat', l => p.chat = l); socket.on('songs', s => p.songs = s);
  p.ready = new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  p.call = (ev, data, ms = 5000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); socket.emit(ev, data, r => { clearTimeout(t); res(r); }); });
  p.act = (type, payload = {}) => p.call('act', { type, payload });
  p.until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(p)) return true; await sleep(25); } return false; };
  p.close = () => socket.close();
  return p;
}
module.exports = { startServer, player, identity, sleep, rnd };
