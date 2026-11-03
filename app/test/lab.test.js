'use strict';
/* The Lab 2.6 simulation suite, ported. These are the Lab's own scripts (see sim/); this file runs them and checks their results. */
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('child_process'), path = require('path');
const run = f => execFileSync(process.execPath, [path.join(__dirname, '..', 'sim', f)], { encoding: 'utf8', timeout: 120000 });

test('Lab: 60 full bot matches with every fun rule on finish with no card lost or duplicated', () => {
  const out = run('sim-60-matches.js'), m = /matches (\d+) fails (\d+) (\{.*\})/.exec(out);
  assert.ok(m, out); assert.equal(+m[1], 60); assert.equal(+m[2], 0);
  const ev = JSON.parse(m[3]); for (const k of ['shuffle', 'deckcut', 'cut', 'out', 'donkey', 'bet', 'power', 'earn']) assert.ok(ev[k] > 0, 'event ' + k + ' happened');
  assert.ok(!/CONS FAIL|stuck/.test(out), out);
});
test('Lab: Peek, Shield, Swap and Reverse stress test keeps the deck whole', () => {
  const out = run('magic-cards.js'), lines = out.trim().split('\n'), last = lines[lines.length - 1], ok = JSON.parse(last.slice(0, last.indexOf('} {') + 1));
  for (const k of ['peek', 'shield', 'swap', 'reverse']) assert.ok(ok[k] > 0, k + ' was used');
  assert.ok(!/FAIL/.test(out), 'no conservation failure');
  assert.ok(lines.filter(l => /^stuck/.test(l)).length <= 20, 'a handful of scripted-human matches time out, exactly as in the Lab suite');
});
test('Lab: every shuffle mode produces its documented hand shapes', () => {
  const out = run('shuffle-deal-shapes.js'); const row = k => { const m = new RegExp('^' + k + '\\s+deal (\\S+)\\s+longest ([\\d.]+)\\s+voids ([\\d.]+)', 'm').exec(out); assert.ok(m, k + ' missing'); return { deal: m[1], longest: +m[2], voids: +m[3] }; };
  const rows = Object.fromEntries(['cut', 'shanti', 'ulta', 'over_lite', 'over_full', 'riffle1', 'riffle3', 'riffle7', 'wash', 'machine'].map(k => [k, row(k)]));
  assert.ok(rows.cut.longest > rows.machine.longest + 1, 'a plain cut leaves long suits'); assert.ok(rows.ulta.longest > rows.riffle3.longest, 'ulta pulta keeps trick piles together');
  assert.ok(rows.machine.longest < 5.5 && rows.riffle7.longest < 5.5, 'machine and riffle x7 are close to random'); assert.equal(rows.shanti.voids, 0, 'shanti cut never deals a void');
});
