'use strict';
/* Draws the app icons (PNG, no dependencies): a felt-green tile with a playing card and a marigold donkey-ear mark.
   Run: node scripts/make-icons.js   -> public/icon-192.png, icon-512.png, apple-touch-icon.png */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const out = path.join(__dirname, '..', 'public');
const FELT = [15, 85, 99], GOLD = [242, 165, 22], CARD = [251, 246, 234], INK = [28, 26, 23], RED = [193, 39, 45];
function crc32(buf) { if (zlib.crc32) return zlib.crc32(buf); let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); }
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const [r, g, b] = pixel(x / size, y / size); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inRR = (x, y, x0, y0, x1, y1, r) => { if (x < x0 || x > x1 || y < y0 || y > y1) return false; const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
const inC = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inEar = (x, y, bx, tilt) => { const dx = x - bx, dy = 0.5 - y; return dy > 0 && dy < 0.26 && Math.abs(dx - tilt * dy) < 0.055 * (1 - dy / 0.34); };
function icon(u, v) {
  if (inRR(u, v, 0.30, 0.50, 0.70, 0.88, 0.05)) { // card
    if (inRR(u, v, 0.33, 0.53, 0.67, 0.85, 0.03)) return inC(u, v, 0.5, 0.69, 0.1) ? RED : CARD;
    return INK;
  }
  if (inEar(u, v, 0.40, -0.35) || inEar(u, v, 0.60, 0.35)) return GOLD;                 // ears
  if (inRR(u, v, 0.34, 0.40, 0.66, 0.56, 0.07)) return GOLD;                           // head
  return FELT;
}
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) fs.writeFileSync(path.join(out, name), png(size, icon));
console.log('icons written to', out);
