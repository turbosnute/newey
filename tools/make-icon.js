/**
 * Generates icon128.png — a small rounded-square gradient tile with a white
 * "N" — using only Node's built-in zlib (no image libraries, no network).
 *
 *   node tools/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const RADIUS = 28;

// rounded-rect signed distance (negative inside)
function sdRoundRect(x, y) {
  const qx = Math.abs(x - SIZE / 2) - (SIZE / 2 - RADIUS);
  const qy = Math.abs(y - SIZE / 2) - (SIZE / 2 - RADIUS);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - RADIUS;
}

// distance from point to line segment
function distSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

// "N" strokes: left vertical, diagonal, right vertical (capsules)
const STROKES = [
  [44, 98, 44, 30],
  [44, 98, 84, 30],
  [84, 98, 84, 30],
];
const STROKE_HW = 7.5;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const lerp = (a, b, t) => a + (b - a) * t;

// palette: midnight navy -> deep teal (diagonal), per the Read the Seas? — brand gradient
const TOP = [27, 42, 74];
const BOT = [12, 107, 88];
const GLYPH = [244, 246, 250];

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter byte 0 + RGBA
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5, py = y + 0.5;

    const dRect = sdRoundRect(px, py);
    if (dRect >= 1) continue; // fully outside
    const tileAlpha = clamp01(0.5 - dRect);

    const t = (x + y) / ((SIZE - 1) * 2);
    let r = Math.round(lerp(TOP[0], BOT[0], t));
    let g = Math.round(lerp(TOP[1], BOT[1], t));
    let b = Math.round(lerp(TOP[2], BOT[2], t));

    let glyph = 0;
    for (const [ax, ay, bx, by] of STROKES) {
      glyph = Math.max(glyph, clamp01(STROKE_HW - distSegment(px, py, ax, ay, bx, by) + 0.5));
    }
    r = Math.round(lerp(r, GLYPH[0], glyph));
    g = Math.round(lerp(g, GLYPH[1], glyph));
    b = Math.round(lerp(b, GLYPH[2], glyph));

    const i = 1 + x * 4;
    row[i] = r; row[i + 1] = g; row[i + 2] = b; row[i + 3] = Math.round(tileAlpha * 255);
  }
  rows.push(row);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
// 10..12: compression, filter, interlace — all zero

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'icon128.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
