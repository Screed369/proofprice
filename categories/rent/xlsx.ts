// A small, dependency-free reader for .xlsx workbooks (a zip of XML parts), used by the rent sources whose publishers
// only offer Excel files (NSW rental bonds, ONS private rents). Used from harvest() only, never per request.
// Reads: the zip central directory, xl/workbook.xml (sheet names), its relationships, xl/sharedStrings.xml and each
// worksheet's cells (shared strings, inline strings, numbers, booleans). Dates stay as Excel serial numbers: use
// excelDate() on a column you know is a date. No formulas are evaluated (cached values are read).

import { inflateRawSync } from "node:zlib";
import { SourceError } from "../../lib/http";

/** Every file in a zip held in memory, by path. Supports stored and deflated entries (no zip64, no encryption). */
export function unzipAll(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
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
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new SourceError(`Unsupported zip method ${method}`);
  }
  return out;
}

export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  /** Rows of cells, column A first. Empty cells are null; trailing empty cells are cut. */
  rows: Cell[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Concatenated text of every <t> element inside an XML fragment (rich-text runs are joined). */
function textOf(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] !== undefined ? xmlText(m[1]) : "";
  return out;
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] !== undefined ? textOf(m[1]) : "");
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : undefined;
}

/** Parse one worksheet's XML into rows of cells. */
export function parseSheetXml(xml: string, shared: string[], maxRows = Infinity): Cell[][] {
  const rows: Cell[][] = [];
  const rowRe = /<row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  let nextRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const rowTag = rm[1] ?? "";
    const rAttr = attr(rowTag, "r");
    const rowNo = rAttr ? Number(rAttr) - 1 : nextRow;
    while (rows.length < rowNo) rows.push([]);
    nextRow = rowNo + 1;
    const cells: Cell[] = [];
    const body = rm[2] ?? "";
    const cellRe = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let col = 0;
    while ((cm = cellRe.exec(body))) {
      const tag = cm[1] ?? "";
      const ref = attr(tag, "r");
      if (ref) {
        const letters = /^[A-Za-z]+/.exec(ref);
        if (letters) col = columnIndex(letters[0]);
      }
      const type = attr(tag, "t");
      const inner = cm[2] ?? "";
      let value: Cell = null;
      if (type === "inlineStr") value = textOf(inner);
      else {
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
      while (cells.length < col) cells.push(null);
      cells[col] = value;
      col++;
    }
    while (cells.length && cells[cells.length - 1] === null) cells.pop();
    rows.push(cells);
    if (rows.length >= maxRows) break;
  }
  return rows;
}

function relTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Read every worksheet of an .xlsx file. `maxRows` stops each sheet early (useful to peek at headers). */
export function readXlsx(buf: Buffer, opts: { maxRows?: number } = {}): Sheet[] {
  const files = unzipAll(buf);
  const get = (name: string) => files.get(name)?.toString("utf8");
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new SourceError("Not an Excel workbook (xl/workbook.xml missing)");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*?\/?>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) relMap.set(id, relTarget("xl/workbook.xml", target));
  }
  const sharedXml = get("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheets: Sheet[] = [];
  let index = 0;
  for (const m of workbook.matchAll(/<sheet\s[^>]*?\/?>/g)) {
    index++;
    const name = attr(m[0], "name") ?? `Sheet${index}`;
    const rid = attr(m[0], "r:id") ?? attr(m[0], "id");
    const path = (rid && relMap.get(rid)) || `xl/worksheets/sheet${index}.xml`;
    const xml = get(path);
    if (xml === undefined) continue;
    sheets.push({ name, rows: parseSheetXml(xml, shared, opts.maxRows ?? Infinity) });
  }
  return sheets;
}

/** Excel serial date (days since 1899-12-30) to YYYY-MM-DD; null if it is not a plausible date serial. */
export function excelDate(serial: unknown): string | null {
  if (typeof serial !== "number" || !Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}
