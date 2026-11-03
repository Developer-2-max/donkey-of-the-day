'use strict';
/* Loads the browser-style shared files into a sandbox so the server uses exactly the same rules, catalog and progress tables the pages do. */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
function loadShared(extraExports = '') {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, crypto: crypto.webcrypto, btoa, atob, TextEncoder, TextDecoder, Intl };
  sandbox.window = sandbox; vm.createContext(sandbox);
  const dir = path.join(__dirname, '..', 'shared');
  const src = ['engine.js', 'catalog.js', 'music.js', 'commentary.js', 'progress.js', 'host.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src + '\n;this.Host = Host; this.CATALOG = CATALOG; this.THROWS = THROWS; this.BOT_HIT = BOT_HIT; this.COMM_LINES = COMM_LINES; this.CHALLENGES = CHALLENGES; this.THEMES = THEMES; this.BACKS = BACKS; this.XP = XP; this.levelOfXp = levelOfXp; this.dayKeyAt = dayKeyAt; this.challengeOfDay = challengeOfDay; this.TRACKS = TRACKS;' + extraExports, sandbox, { filename: 'shared.js' });
  return sandbox;
}
module.exports = { loadShared };
