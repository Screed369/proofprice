// Fixtures for be-vreg-energy. REAL rows copied on 2026-10-24 from the Flemish regulator's V-test open-data workbook
// (sheet "Vast (excl. btw) (2026)", month sep, Woning / Afname / Vast), read through the GitHub probe; and the real link lines of the data page.
// makeXlsx() only wraps rows into a minimal .xlsx (zip, stored entries, inline strings) so the real reader code is tested end to end.

export const PAGE_HTML = `
    <a class="download" href="https://assets.vlaamsenutsregulator.be/2026-10/202610-v-test-data-exclbtw%20v2_0.xlsx?VersionId=ufWqr3DPEaKhTD0JCL1DMWDmRaM7q1PZ" >V-test data</a>
    <a class="download" href="https://assets.vlaamsenutsregulator.be/2026-10/202610-Energieprijscurves%20v2%20%281%29.xlsx?VersionId=mOn59_bxTmmKx5SmbcSh5aYnp541afMJ" >Energieprijscurves</a>
`;

export const HEADER = ["Jaar", "Maand", "Segment", "Energietype", "Contracttype", "Handelsnaam", "Productnaam", "Vast/variabel/dynamisch", "Prijsonderdeel", "Prijs"];
const DAY = "Enkelvoudige meter dagtarief (c€/kWh)";
const FEE = "Vaste vergoeding (€)";

type Row = (string | number)[];
const row = (energy: string, supplier: string, product: string, component: string, price: number, month = "sep"): Row =>
  [2026, month, "Woning", energy, "Afname", supplier, product, "Vast", component, price];

/** Real electricity single-meter day tariffs, September 2026 (14 products). */
export const ELEC_SEP: Row[] = [
  row("Elektriciteit", "Bolt", "Bolt Vast", DAY, 18.498000000000001),
  row("Elektriciteit", "Bolt", "Plenty Vast", DAY, 18.498000000000001),
  row("Elektriciteit", "Elegant", "Zeker & Vast", DAY, 15.92),
  row("Elektriciteit", "Eneco Belgium", "Eneco Zon & Wind Vast", DAY, 19.286999999999999),
  row("Elektriciteit", "Energie.be", "Elektriciteit vast online", DAY, 18.23),
  row("Elektriciteit", "EnergyVision", "Goedkope Stroom 3 jaar vast ", DAY, 12.8),
  row("Elektriciteit", "ENGIE (handelsnaam van Electrabel) ", "Easy ", DAY, 17.637),
  row("Elektriciteit", "ENGIE (handelsnaam van Electrabel) ", "Empower", DAY, 16.829000000000001),
  row("Elektriciteit", "Luminus", "BasicFix Online", DAY, 17.594259999999998),
  row("Elektriciteit", "Luminus", "Comfy", DAY, 20.796530000000001),
  row("Elektriciteit", "Luminus", "Comfy+", DAY, 22.506530000000001),
  row("Elektriciteit", "Luminus", "MaxxFix", DAY, 19.122330000000002),
  row("Elektriciteit", "Mega (handelsnaam van Power Online)", "COSY GREEN FIXED", DAY, 19.638999999999999),
  row("Elektriciteit", "Mega (handelsnaam van Power Online)", "OFFPEAK GREEN FIXED", DAY, 18.518999999999998),
];

/** Real gas rows, September 2026: only 4 products appear in the sample read, which is fewer than 5, so the source must refuse a range. */
export const GAS_SEP: Row[] = [
  row("Gas", "Bolt", "Bolt Vast", DAY, 7.5640000000000001),
  row("Gas", "Bolt", "Bolt Vast", FEE, 101.77358),
  row("Gas", "Bolt", "Plenty Vast", DAY, 7.5640000000000001),
  row("Gas", "Bolt", "Plenty Vast", FEE, 45.169809999999998),
  row("Gas", "Elegant", "Zeker & Vast", DAY, 7.5723900000000004),
  row("Gas", "Elegant", "Zeker & Vast", FEE, 113.20755),
  row("Gas", "Eneco Belgium", "Eneco Aardgas Vast", DAY, 8.609),
  row("Gas", "Eneco Belgium", "Eneco Aardgas Vast", FEE, 61.320999999999998),
];

// ---- minimal .xlsx writer for tests ----
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const colName = (i: number) => String.fromCharCode(65 + i);
function sheetXml(rows: Row[]): string {
  const body = rows
    .map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => (typeof v === "number" ? `<c r="${colName(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join("") + "</row>")
    .join("");
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
export function makeXlsx(sheets: { name: string; rows: Row[] }[]): Buffer {
  const files: Record<string, string> = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows)));
  return zip(files);
}
