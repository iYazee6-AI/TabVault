// Generates icons/icon16.png, icon48.png, icon128.png: a teal rounded square
// with three white "tab" bars. Run: node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIcon(size) {
  const radius = size * 0.2;
  const inRoundedSquare = (x, y) => {
    const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
    const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  // Three tab shapes: a short "handle" bar on the left third, a longer body bar.
  const rows = [0.28, 0.5, 0.72].map((f) => Math.round(size * f));
  const thick = Math.max(1, Math.round(size * 0.1));
  const left = Math.round(size * 0.2), handleEnd = Math.round(size * 0.42), bodyStart = Math.round(size * 0.48), right = Math.round(size * 0.8);
  return encodePng(size, (x, y) => {
    if (!inRoundedSquare(x, y)) return [0, 0, 0, 0];
    const onRow = rows.some((top) => y >= top - thick / 2 && y < top + thick / 2);
    const onBar = onRow && ((x >= left && x < handleEnd) || (x >= bodyStart && x < right));
    return onBar ? [255, 255, 255, 255] : [15, 118, 110, 255]; // #0f766e
  });
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makeIcon(size));
  console.log(`wrote icons/icon${size}.png`);
}
