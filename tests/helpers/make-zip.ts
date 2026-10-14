// Test helper: a minimal zip writer (stored or deflated entries) for building small .xlsx workbooks in tests.
import { deflateRawSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function makeZip(files: Record<string, string>, deflate = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colLetter = (i: number) => String.fromCharCode(65 + i);

/**
 * A one-or-more-sheet .xlsx from rows of strings and numbers, written the way Excel does: strings are shared strings,
 * numbers are plain cells. sheets: { "Sheet name": [[cell, ...], ...] }.
 */
export function makeXlsx(sheets: Record<string, (string | number | null)[][]>, deflate = true): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sst = (s: string) => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };
  const names = Object.keys(sheets);
  const files: Record<string, string> = { "[Content_Types].xml": "<Types/>" };
  names.forEach((name, n) => {
    const rows = sheets[name]
      .map((cells, r) => {
        const cs = cells
          .map((v, c) => {
            if (v === null || v === undefined) return "";
            const ref = `${colLetter(c)}${r + 1}`;
            return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sst(v)}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cs}</row>`;
      })
      .join("");
    files[`xl/worksheets/sheet${n + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  files["xl/workbook.xml"] =
    `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    names.map((name, n) => `<sheet name="${esc(name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join("") +
    `</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] =
    `<Relationships>` + names.map((_, n) => `<Relationship Id="rId${n + 1}" Type="x" Target="worksheets/sheet${n + 1}.xml"/>`).join("") + `</Relationships>`;
  files["xl/sharedStrings.xml"] = `<sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
  return makeZip(files, deflate);
}
