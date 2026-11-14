// A small, dependency-free reader for legacy Excel .xls workbooks (BIFF8 stored in an OLE2 "compound file"), because the
// U.S. Energy Information Administration still publishes its weekly pump-price history and its Natural Gas Monthly tables as .xls
// (the newer .xlsx files are read by categories/rent/xlsx.ts). Used from harvest() only, never per request.
//
// Reads: the compound-file header, FAT/DIFAT, directory and mini stream, then the "Workbook" stream's records: BOUNDSHEET (sheet names
// and positions), SST + CONTINUE (shared strings), LABELSST, LABEL, NUMBER, RK, MULRK, and the cached result of FORMULA (+ STRING).
// Dates stay as Excel serial numbers: use excelDate() from categories/rent/xlsx.ts on a column you know is a date. No formulas are
// evaluated, no styles are read, only worksheets are returned (not charts or macro sheets).

import { SourceError } from "../../lib/http";
import type { Cell, Sheet } from "../../categories/rent/xlsx";

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_REGULAR_SECTOR = 0xfffffffa;
const END_OF_CHAIN = 0xfffffffe;

/** The bytes of one stream (default: the workbook) inside an OLE2 compound file held in memory. */
export function readCompoundStream(buf: Buffer, names: string[] = ["Workbook", "Book"]): Buffer {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(OLE_SIGNATURE)) throw new SourceError("Not an .xls workbook (no OLE2 compound-file header)");
  const sectorSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const fatCount = buf.readUInt32LE(44);
  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const difStart = buf.readUInt32LE(68);
  const difCount = buf.readUInt32LE(72);
  const sectorOffset = (s: number) => (s + 1) * sectorSize;
  const sector = (s: number): Buffer => buf.subarray(sectorOffset(s), Math.min(buf.length, sectorOffset(s) + sectorSize));

  // The sectors that hold the file allocation table: 109 in the header, the rest in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + 4 * i);
    if (s <= MAX_REGULAR_SECTOR) fatSectors.push(s);
  }
  let dif = difStart;
  for (let n = 0; n < difCount && dif <= MAX_REGULAR_SECTOR; n++) {
    const d = sector(dif);
    for (let i = 0; i < sectorSize / 4 - 1 && (i + 1) * 4 <= d.length; i++) {
      const s = d.readUInt32LE(4 * i);
      if (s <= MAX_REGULAR_SECTOR) fatSectors.push(s);
    }
    dif = d.length >= sectorSize ? d.readUInt32LE(sectorSize - 4) : END_OF_CHAIN;
  }
  const fat: number[] = [];
  for (const s of fatSectors.slice(0, Math.max(fatCount, fatSectors.length))) {
    const d = sector(s);
    for (let i = 0; i + 4 <= d.length; i += 4) fat.push(d.readUInt32LE(i));
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    let s = start;
    while (s <= MAX_REGULAR_SECTOR && out.length <= table.length) {
      out.push(s);
      s = table[s] ?? END_OF_CHAIN;
    }
    return out;
  };
  const readChain = (start: number): Buffer => Buffer.concat(chain(start, fat).map(sector));

  // Directory: 128-byte entries (name, type, start sector, size).
  const dir = readChain(dirStart);
  interface Entry { name: string; type: number; start: number; size: number }
  const entries: Entry[] = [];
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const nameLen = dir.readUInt16LE(p + 64);
    if (nameLen < 2 || nameLen > 64) continue;
    entries.push({ name: dir.toString("utf16le", p, p + nameLen - 2), type: dir[p + 66], start: dir.readUInt32LE(p + 116), size: dir.readUInt32LE(p + 120) });
  }
  const stream = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!stream) throw new SourceError("The .xls file has no Workbook stream; it may be a different file format.");
  if (stream.size >= miniCutoff) return readChain(stream.start).subarray(0, stream.size);

  // Small streams live in the mini stream, which the root entry points at.
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new SourceError("The .xls file has no root entry.");
  const miniStream = readChain(root.start).subarray(0, root.size);
  const miniFatBytes = readChain(miniFatStart);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));
  const parts = chain(stream.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize));
  return Buffer.concat(parts).subarray(0, stream.size);
}

// ---------- BIFF8 records ----------

const REC = {
  BOF: 0x0809, EOF: 0x000a, BOUNDSHEET: 0x0085, SST: 0x00fc, CONTINUE: 0x003c, LABELSST: 0x00fd, LABEL: 0x0204, STRING: 0x0207,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, FORMULA: 0x0006,
};

/** Reads text that may run on into CONTINUE records, where each continuation starts with a flag byte (bit 0: 16-bit characters). */
class SegmentReader {
  private seg = 0;
  private pos = 0;
  constructor(private segs: Buffer[]) {}
  get done(): boolean {
    while (this.seg < this.segs.length && this.pos >= this.segs[this.seg].length) {
      this.seg++;
      this.pos = 0;
    }
    return this.seg >= this.segs.length;
  }
  u8(): number {
    if (this.done) throw new SourceError("The .xls shared-string table ends unexpectedly");
    return this.segs[this.seg][this.pos++];
  }
  u16(): number {
    const a = this.u8();
    return a | (this.u8() << 8);
  }
  u32(): number {
    const a = this.u16();
    return (a | (this.u16() << 16)) >>> 0;
  }
  /** Skip n bytes of formatting runs or phonetic data (no flag byte is inserted inside those). */
  skip(n: number): void {
    while (n > 0 && !this.done) {
      const take = Math.min(n, this.segs[this.seg].length - this.pos);
      this.pos += take;
      n -= take;
    }
  }
  chars(count: number, wide: boolean): string {
    let out = "";
    let left = count;
    while (left > 0) {
      if (this.pos >= this.segs[this.seg].length) {
        this.seg++;
        this.pos = 0;
        if (this.seg >= this.segs.length) break;
        wide = (this.segs[this.seg][this.pos++] & 1) === 1; // continuation: a new flag byte comes first
        continue;
      }
      const cur = this.segs[this.seg];
      const unit = wide ? 2 : 1;
      const take = Math.min(left, Math.floor((cur.length - this.pos) / unit));
      if (take <= 0) break;
      out += wide ? cur.toString("utf16le", this.pos, this.pos + take * 2) : cur.toString("latin1", this.pos, this.pos + take);
      this.pos += take * unit;
      left -= take;
    }
    return out;
  }
  /** One XLUnicodeRichExtendedString (cch, flags, optional run and phonetic counts, characters, runs, phonetic data). */
  string(): string {
    const cch = this.u16();
    const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const text = this.chars(cch, (flags & 0x01) === 1);
    this.skip(runs * 4 + ext);
    return text;
  }
}

function parseSst(segs: Buffer[]): string[] {
  const r = new SegmentReader(segs);
  r.u32(); // total references
  const unique = r.u32();
  const out: string[] = [];
  for (let i = 0; i < unique && !r.done; i++) out.push(r.string());
  return out;
}

/** An RK number: a 30-bit integer or the top 30 bits of a double, optionally divided by 100. */
export function decodeRk(rk: number): number {
  let v: number;
  if (rk & 2) v = (rk | 0) >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

interface Record_ { type: number; off: number; len: number }

function listRecords(wb: Buffer, from = 0): Record_[] {
  const out: Record_[] = [];
  let p = from;
  while (p + 4 <= wb.length) {
    const type = wb.readUInt16LE(p);
    const len = wb.readUInt16LE(p + 2);
    if (p + 4 + len > wb.length) break;
    out.push({ type, off: p + 4, len });
    p += 4 + len;
  }
  return out;
}

const MAX_ROWS = 65536;
const MAX_COLS = 256;

/** Read every worksheet of an .xls file (BIFF8). `maxRows` stops each sheet early (useful to peek at headers). */
export function readXls(buf: Buffer, opts: { maxRows?: number } = {}): Sheet[] {
  const wb = readCompoundStream(buf);
  const maxRows = Math.min(opts.maxRows ?? Infinity, MAX_ROWS);
  const all = listRecords(wb);
  const first = all[0];
  if (!first || first.type !== REC.BOF) throw new SourceError("The .xls workbook does not start with a BOF record");
  if (wb.readUInt16LE(first.off) !== 0x0600) throw new SourceError("Only Excel 97-2003 (BIFF8) workbooks are supported");

  // Globals: sheet list and shared strings, up to the first EOF.
  const sheetsInfo: { name: string; pos: number; type: number }[] = [];
  let shared: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (r.type === REC.EOF) break;
    if (r.type === REC.BOUNDSHEET) {
      const pos = wb.readUInt32LE(r.off);
      const type = wb[r.off + 5];
      const cch = wb[r.off + 6];
      const wide = (wb[r.off + 7] & 1) === 1;
      const name = wide ? wb.toString("utf16le", r.off + 8, r.off + 8 + cch * 2) : wb.toString("latin1", r.off + 8, r.off + 8 + cch);
      sheetsInfo.push({ name, pos, type });
    } else if (r.type === REC.SST) {
      const segs = [wb.subarray(r.off, r.off + r.len)];
      while (i + 1 < all.length && all[i + 1].type === REC.CONTINUE) {
        i++;
        segs.push(wb.subarray(all[i].off, all[i].off + all[i].len));
      }
      shared = parseSst(segs);
    }
  }

  const sheets: Sheet[] = [];
  for (const info of sheetsInfo) {
    if (info.type !== 0) continue; // 0 = worksheet; 2 = chart, 6 = macro sheet
    const rows: Cell[][] = [];
    const put = (row: number, col: number, value: Cell) => {
      if (row >= maxRows || col >= MAX_COLS) return;
      while (rows.length <= row) rows.push([]);
      const cells = rows[row];
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    };
    let depth = 0;
    let pendingFormula: { row: number; col: number } | null = null;
    for (const r of listRecords(wb, info.pos)) {
      const d = r.off;
      if (r.type === REC.BOF) {
        depth++;
        continue;
      }
      if (r.type === REC.EOF) {
        depth--;
        if (depth <= 0) break;
        continue;
      }
      if (depth !== 1) continue; // embedded objects (charts) have their own BOF/EOF
      switch (r.type) {
        case REC.LABELSST:
          put(wb.readUInt16LE(d), wb.readUInt16LE(d + 2), shared[wb.readUInt32LE(d + 6)] ?? null);
          break;
        case REC.NUMBER:
          put(wb.readUInt16LE(d), wb.readUInt16LE(d + 2), wb.readDoubleLE(d + 6));
          break;
        case REC.RK:
          put(wb.readUInt16LE(d), wb.readUInt16LE(d + 2), decodeRk(wb.readUInt32LE(d + 6)));
          break;
        case REC.MULRK: {
          const row = wb.readUInt16LE(d);
          const firstCol = wb.readUInt16LE(d + 2);
          const lastCol = wb.readUInt16LE(d + r.len - 2);
          for (let c = firstCol, p = d + 4; c <= lastCol && p + 6 <= d + r.len - 2; c++, p += 6) put(row, c, decodeRk(wb.readUInt32LE(p + 2)));
          break;
        }
        case REC.LABEL: {
          const cch = wb.readUInt16LE(d + 6);
          const wide = (wb[d + 8] & 1) === 1;
          const text = wide ? wb.toString("utf16le", d + 9, d + 9 + cch * 2) : wb.toString("latin1", d + 9, d + 9 + cch);
          put(wb.readUInt16LE(d), wb.readUInt16LE(d + 2), text);
          break;
        }
        case REC.FORMULA: {
          const row = wb.readUInt16LE(d);
          const col = wb.readUInt16LE(d + 2);
          if (wb.readUInt16LE(d + 12) === 0xffff) {
            // not a number: 0 = text (in the STRING record that follows), 1 = boolean, 2 = error, 3 = empty
            const kind = wb[d + 6];
            if (kind === 0) pendingFormula = { row, col };
            else if (kind === 1) put(row, col, wb[d + 8] !== 0);
          } else put(row, col, wb.readDoubleLE(d + 6));
          break;
        }
        case REC.STRING:
          if (pendingFormula) {
            const cch = wb.readUInt16LE(d);
            const wide = (wb[d + 2] & 1) === 1;
            put(pendingFormula.row, pendingFormula.col, wide ? wb.toString("utf16le", d + 3, d + 3 + cch * 2) : wb.toString("latin1", d + 3, d + 3 + cch));
            pendingFormula = null;
          }
          break;
        default:
          break;
      }
    }
    for (const row of rows) while (row.length && row[row.length - 1] === null) row.pop();
    sheets.push({ name: info.name, rows });
  }
  return sheets;
}
