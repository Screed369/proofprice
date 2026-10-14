// A streaming reader for ONE worksheet of an .xlsx workbook, for files whose sheet XML is far too big to inflate in one piece.
// The DOL National Database of Childcare Prices workbook is a 92 MB download whose single worksheet is 566 MB of XML once
// unzipped (almost all of it styled empty cells), so categories/rent/xlsx.ts (which inflates the whole sheet into a string) cannot read it.
// Here the zip directory is read, the small parts (workbook.xml, shared strings) are inflated normally, and the worksheet is inflated
// in a stream: complete <row> elements are cut out as they arrive and handed to a callback one at a time. Used from harvest() only.

import { createInflateRaw, inflateRawSync } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { SourceError } from "../../lib/http";
import { Cell, columnIndex, parseSharedStrings, xmlText } from "../../categories/rent/xlsx";

export interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  start: number; // offset of the compressed data
}

/** The zip central directory: where each part starts. Nothing is inflated. No zip64, no encryption. */
export function zipDirectory(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("Bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (csize === 0xffffffff || lho === 0xffffffff) throw new SourceError("Zip64 files are not supported");
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Bad zip entry");
    out.set(name, { name, method, csize, start: lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28) });
  }
  return out;
}

/** A small part, inflated whole. */
export function readSmallEntry(buf: Buffer, e: ZipEntry): Buffer {
  const data = buf.subarray(e.start, e.start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new SourceError(`Unsupported zip method ${e.method}`);
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : undefined;
}

/** Path inside the zip of the worksheet called `name` (or the first sheet when no name is given), and the shared strings. */
export function openWorkbook(buf: Buffer, sheetName?: string): { dir: Map<string, ZipEntry>; sheetPath: string; sheetTitle: string; shared: string[] } {
  const dir = zipDirectory(buf);
  const small = (p: string) => {
    const e = dir.get(p);
    return e ? readSmallEntry(buf, e).toString("utf8") : undefined;
  };
  const workbook = small("xl/workbook.xml");
  if (!workbook) throw new SourceError("Not an Excel workbook (xl/workbook.xml missing)");
  const rels = small("xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*?\/?>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const sheets: { name: string; path: string }[] = [];
  let index = 0;
  for (const m of workbook.matchAll(/<sheet\s[^>]*?\/?>/g)) {
    index++;
    const rid = attr(m[0], "r:id") ?? attr(m[0], "id");
    sheets.push({ name: attr(m[0], "name") ?? `Sheet${index}`, path: (rid && relMap.get(rid)) || `xl/worksheets/sheet${index}.xml` });
  }
  const chosen = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!chosen || !dir.has(chosen.path)) throw new SourceError(`The workbook has no sheet ${sheetName ? `called "${sheetName}"` : "to read"}; it may have changed and this source needs updating.`);
  const sharedXml = small("xl/sharedStrings.xml");
  return { dir, sheetPath: chosen.path, sheetTitle: chosen.name, shared: sharedXml ? parseSharedStrings(sharedXml) : [] };
}

/** The cells of one <row> element's inner XML. Empty styled cells come back as null and trailing nulls are cut. */
export function parseRowCells(body: string, shared: string[]): Cell[] {
  const cells: Cell[] = [];
  const cellRe = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm: RegExpExecArray | null;
  let col = 0;
  while ((cm = cellRe.exec(body))) {
    const tag = cm[1] ?? "";
    const inner = cm[2];
    const ref = attr(tag, "r");
    if (ref) {
      const letters = /^[A-Za-z]+/.exec(ref);
      if (letters) col = columnIndex(letters[0]);
    }
    if (inner === undefined || inner === "") {
      col++;
      continue; // empty cell (a style only)
    }
    const type = attr(tag, "t");
    let value: Cell = null;
    if (type === "inlineStr") {
      value = "";
      for (const t of inner.matchAll(/<t(?:\s[^>]*?)?>([\s\S]*?)<\/t>/g)) value += xmlText(t[1]);
    } else {
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
      if (v) {
        const raw = xmlText(v[1]);
        if (type === "s") value = shared[Number(raw)] ?? null;
        else if (type === "str" || type === "d") value = raw;
        else if (type === "b") value = raw === "1";
        else if (type === "e") value = null;
        else {
          const n = Number(raw);
          value = raw.trim() !== "" && Number.isFinite(n) ? n : raw;
        }
      }
    }
    if (value !== null) {
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    col++;
  }
  return cells;
}

/**
 * Stream a worksheet: `onRow(cells, rowNumber)` is called for every row that holds at least one value (empty rows are skipped), in file order.
 * Return false from onRow to stop early. Resolves with the number of rows seen that held values.
 */
export async function streamSheet(
  buf: Buffer,
  entry: ZipEntry,
  shared: string[],
  onRow: (cells: Cell[], rowNumber: number) => boolean | void,
  chunkBytes = 1 << 20,
): Promise<number> {
  const raw = buf.subarray(entry.start, entry.start + entry.csize);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let seen = 0;
  let stopped = false;
  let rowNo = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;

  const handle = (xml: string): void => {
    rowRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (!stopped && (m = rowRe.exec(xml))) {
      const r = attr(m[1], "r");
      rowNo = r ? Number(r) : rowNo + 1;
      if (m[2] === undefined || m[2] === "") continue;
      const cells = parseRowCells(m[2], shared);
      if (!cells.length) continue;
      seen++;
      if (onRow(cells, rowNo) === false) stopped = true;
    }
  };
  const feed = (text: string, final: boolean): void => {
    pending += text;
    let cut = pending.length;
    if (!final) {
      // Rows never nest, so everything before the start of the last <row is complete (works for empty self-closing rows too).
      const i = pending.lastIndexOf("<row");
      if (i <= 0) return; // only one, possibly unfinished, row so far: wait for more
      cut = i;
    }
    const complete = pending.slice(0, cut);
    pending = pending.slice(cut);
    handle(complete);
  };

  if (entry.method === 0) {
    feed(raw.toString("utf8"), true);
    return seen;
  }
  if (entry.method !== 8) throw new SourceError(`Unsupported zip method ${entry.method}`);
  const inflater = createInflateRaw();
  const done = new Promise<void>((resolve, reject) => {
    inflater.on("data", (chunk: Buffer) => {
      if (stopped) return;
      feed(decoder.write(chunk), false);
      if (stopped) inflater.destroy();
    });
    inflater.on("end", () => {
      if (!stopped) feed(decoder.end(), true);
      resolve();
    });
    inflater.on("close", () => resolve());
    inflater.on("error", (e) => (stopped ? resolve() : reject(e)));
  });
  // Feed the compressed bytes in pieces so memory stays flat and early stops are quick.
  for (let off = 0; off < raw.length && !stopped; off += chunkBytes) {
    const piece = raw.subarray(off, Math.min(raw.length, off + chunkBytes));
    if (!inflater.write(piece)) await new Promise<void>((r) => inflater.once("drain", () => r()));
    else await new Promise<void>((r) => setImmediate(r));
  }
  if (!stopped) inflater.end();
  await done;
  return seen;
}
