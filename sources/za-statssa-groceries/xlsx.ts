// A tiny, dependency-free reader for .xlsx workbooks (a zip of XML files), enough to read the plain data tables that the
// Office for National Statistics publishes. Node's zlib does the inflating. Pure functions, unit-tested in source.test.ts.
// Not a general spreadsheet library: no formulas, styles or dates (a date is just the number the cell holds).

import { inflateRawSync } from "node:zlib";

/** Every file of a zip archive, by name. Supports stored and deflated entries (all that an .xlsx uses). Throws on anything else. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory record: scan back from the end (it may be followed by a comment of up to 65 535 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-archive record)");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip (bad directory entry)");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Corrupt zip (bad file header)");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported zip compression method ${method}`);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** All text of the <t> elements inside a fragment, joined (rich-text strings are split over several runs). */
function textOf(fragment: string): string {
  let out = "";
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

export function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) out.push(m[1] === undefined ? "" : textOf(m[1]));
  return out;
}

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type Cell = string | number | null;

/** Rows of one worksheet as arrays of cells indexed by column (gaps are null). Text and shared strings become strings, numbers stay numbers. */
export function readSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = /\br="(\d+)"/.exec(rm[1]);
    const cells: Cell[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1]);
      if (!ref) continue;
      const type = /\bt="([a-zA-Z]+)"/.exec(cm[1])?.[1];
      const inner = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: Cell = null;
      if (type === "s") value = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str" || type === "e") value = v !== undefined ? decodeXml(v) : null;
      else if (type === "b") value = v === undefined ? null : v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined && v !== "") {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      cells[columnIndex(ref[1])] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    const at = rowNo ? Number(rowNo[1]) - 1 : rows.length;
    while (rows.length < at) rows.push([]);
    rows[at] = cells;
  }
  return rows;
}

export interface Sheet {
  name: string;
  rows: Cell[][];
}

/** Every worksheet of an .xlsx workbook, in workbook order, with its name. */
export function readWorkbook(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook (no xl/workbook.xml)");
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && tg) target.set(id, tg.startsWith("/") ? tg.slice(1) : `xl/${tg}`);
  }
  const shared = readSharedStrings(text("xl/sharedStrings.xml") ?? "");
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? text(path) : undefined;
    if (name !== undefined && xml) sheets.push({ name: decodeXml(name), rows: readSheet(xml, shared) });
  }
  return sheets;
}
