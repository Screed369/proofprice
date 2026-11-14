// Builds the ChatGPT plugin ZIP from docs/chatgpt-directory/plugin/ with no dependency.
// Usage: node scripts/build-chatgpt-plugin.mjs <output.zip>
// It also puts public/icon-512.png into the ZIP as assets/logo.png (the path plugin.json names), after checking it is square.
// Nothing is uploaded. The ZIP is never committed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "docs/chatgpt-directory/plugin");
// notes for people, not part of the package
const SKIP = new Set(["test-cases.md"]);
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/build-chatgpt-plugin.mjs <output.zip>");
  process.exit(1);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function walk(dir, base = "") {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full, rel));
    else if (!SKIP.has(rel)) files.push({ name: rel, data: readFileSync(full) });
  }
  return files;
}

const files = walk(srcDir);
const icon = readFileSync(path.join(root, "public/icon-512.png"));
const w = icon.readUInt32BE(16);
const h = icon.readUInt32BE(20);
if (w !== h || w < 48) throw new Error(`public/icon-512.png must be square and at least 48 px (it is ${w}x${h})`);
files.push({ name: "assets/logo.png", data: icon });

const parts = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name);
  const packed = deflateRawSync(f.data);
  const crc = crc32(f.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10); // fixed time and date: the same input gives the same ZIP
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(f.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt16LE(0, 12);
  c.writeUInt16LE(0x21, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(f.data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += local.length + name.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...parts, centralBuf, end]));
console.log(`Wrote ${out}: ${files.map((f) => f.name).join(", ")}`);
