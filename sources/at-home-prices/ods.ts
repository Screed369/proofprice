// A small reader for OpenDocument spreadsheets (.ods): the file is a zip, the cells are in content.xml.
// Pure functions, no dependencies. Statistik Austria publishes its real-estate average prices as .ods files only.

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

/** Every file in a zip held in memory (central directory). Throws Error if it is not a zip. */
export function listZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      headerOffset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The bytes of one file in a zip. */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const lho = entry.headerOffset;
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("bad zip entry");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${entry.method}`);
}

export interface OdsSheet {
  name: string;
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
}

function cellText(inner: string): string {
  const paras = [...inner.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((m) =>
    decodeXml(
      m[1]
        .replace(/<text:s\b[^>]*\/>/g, (tag) => " ".repeat(Number(/text:c="(\d+)"/.exec(tag)?.[1]) || 1))
        .replace(/<text:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, ""),
    ),
  );
  return paras.join("\n").trim();
}

// A run of identical cells is stored once with a repeat count. Empty cells in the middle of a row are real gaps (a figure
// the publisher left out), so their count must be kept to keep the columns aligned; trailing empties are dropped below.
const MAX_REPEAT_FILLED = 50;
const MAX_CELL_REPEAT_EMPTY = 64;
const MAX_ROW_REPEAT_EMPTY = 1;

/** Parse the content.xml of a spreadsheet into sheets of rows of strings. Numbers use the cell's exact office:value. */
export function parseOds(content: string, opts: { maxRowsPerSheet?: number } = {}): OdsSheet[] {
  const maxRows = opts.maxRowsPerSheet ?? 20000;
  const sheets: OdsSheet[] = [];
  const tableRe = /<table:table(?=[\s>])([^>]*)>([\s\S]*?)<\/table:table>/g;
  for (const t of content.matchAll(tableRe)) {
    const name = attr(t[1], "table:name") ?? `Sheet${sheets.length + 1}`;
    const rows: string[][] = [];
    const rowRe = /<table:table-row(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
    for (const r of t[2].matchAll(rowRe)) {
      const cells: string[] = [];
      const cellRe = /<table:(?:covered-)?table-cell(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
      for (const c of (r[2] ?? "").matchAll(cellRe)) {
        const type = attr(c[1], "office:value-type");
        let value: string;
        if (type === "float" || type === "percentage" || type === "currency") value = attr(c[1], "office:value") ?? cellText(c[2] ?? "");
        else if (type === "string") value = attr(c[1], "office:string-value") ?? cellText(c[2] ?? "");
        else value = cellText(c[2] ?? "");
        const repeat = Math.max(1, Number(attr(c[1], "table:number-columns-repeated")) || 1);
        const times = Math.min(repeat, value === "" ? MAX_CELL_REPEAT_EMPTY : MAX_REPEAT_FILLED);
        for (let i = 0; i < times; i++) cells.push(value);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      const rowRepeat = Math.max(1, Number(attr(r[1], "table:number-rows-repeated")) || 1);
      const times = Math.min(rowRepeat, cells.length ? MAX_REPEAT_FILLED : MAX_ROW_REPEAT_EMPTY);
      for (let i = 0; i < times && rows.length < maxRows; i++) rows.push(cells);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    sheets.push({ name, rows });
  }
  return sheets;
}

/** All sheets of an .ods file held in memory. */
export function readOds(buf: Buffer, opts: { maxRowsPerSheet?: number } = {}): OdsSheet[] {
  const entry = listZip(buf).find((e) => e.name === "content.xml");
  if (!entry) throw new Error("no content.xml in the spreadsheet");
  return parseOds(readZipEntry(buf, entry).toString("utf8"), opts);
}
