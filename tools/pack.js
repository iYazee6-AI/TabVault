// Builds dist/tabvault-<version>.zip containing exactly the runtime files
// needed to load the extension (no docs/tests/tooling). Zero dependencies:
// implements a minimal ZIP writer (stored/no-compression method) by hand.
// Run: node tools/pack.js
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const dosYear = date.getFullYear() - 1980;
  const dateVal = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: dateVal & 0xffff };
}

const rootDir = path.join(__dirname, "..");

function walk(relDir) {
  const abs = path.join(rootDir, relDir);
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const relPath = path.join(relDir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) {
      out.push(...walk(relPath));
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}

function collectEntries() {
  const topLevelFiles = ["manifest.json", "background.js"];
  const entries = [...topLevelFiles];
  entries.push(...walk("app"));
  entries.push(...walk("lib"));
  entries.push(...walk("icons"));
  return entries;
}

function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const relName of entries) {
    const filePath = path.join(rootDir, ...relName.split("/"));
    const data = fs.readFileSync(filePath);
    const nameBuf = Buffer.from(relName, "utf8");
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(now.time, 10); // mod time
    local.writeUInt16LE(now.date, 12); // mod date
    local.writeUInt32LE(crc, 14); // crc-32
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra length

    localChunks.push(local, nameBuf, data);

    // Central directory header
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(now.time, 12); // mod time
    central.writeUInt16LE(now.date, 14); // mod date
    central.writeUInt32LE(crc, 16); // crc-32
    central.writeUInt32LE(size, 20); // compressed size
    central.writeUInt32LE(size, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset

    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
    console.log(relName);
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const centralSize = centralBuf.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralSize, 12); // central dir size
  end.writeUInt32LE(centralStart, 16); // central dir offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralBuf, end]);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
  const version = manifest.version;
  const entries = collectEntries();
  const zipBuf = buildZip(entries);

  const distDir = path.join(rootDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const outPath = path.join(distDir, `tabvault-${version}.zip`);
  fs.writeFileSync(outPath, zipBuf);

  console.log(`\nWrote ${outPath} (${zipBuf.length} bytes)`);
}

main();
