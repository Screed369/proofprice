// Fixtures for the Statbel "Vastgoed" file (https://statbel.fgov.be/sites/default/files/files/opendata/immo/vastgoed_2010_9999.zip).
// Checked live on 2026-10-14 (file dated 2026-09-11, 46,279,115 characters, 286,120 rows, years 2010 to 2026, Latin-1, CRLF).
//
// REAL: the header line, the four property-type labels (Dutch and French), the national rows for 2025 and 2026 and the rows for
// the municipality of Antwerpen in 2026 and for its 2025 year: the numbers below were read from the file on that day.
// SYNTHETIC: the rows marked SYNTHETIC (regions, a tiny municipality) carry invented numbers; they exist only to test the logic.

export const CHECKED = "2026-10-14";

export const HEADER = "CD_YEAR|CD_TYPE_NL|CD_TYPE_FR|CD_REFNIS|CD_REFNIS_NL|CD_REFNIS_FR|CD_PERIOD|CD_CLASS_SURFACE|MS_TOTAL_TRANSACTIONS|MS_P_25|MS_P_50_median|MS_P_75|CD_niveau_refnis";

export const TYPES = {
  closed: ["Huizen met 2 of 3 gevels (gesloten + halfopen bebouwing)", "Maisons avec 2 ou 3 façades (type fermé + type demi-fermé)"],
  open: ["Huizen met 4 of meer gevels (open bebouwing)", "Maisons avec 4 ou plus de façades (type ouvert)"],
  all: ["Alle huizen met 2, 3, 4 of meer gevels (excl. appartementen)", "Toutes les maisons avec 2, 3, 4 ou plus de façades (excl. appartements)"],
  apt: ["Appartementen", "Appartements"],
} as const;
export type TypeId = keyof typeof TYPES;

/** transactions, 25th percentile, median, 75th percentile; null = the cell is blank in the file */
export type Fig = [n: number | null, p25: number | null, p50: number | null, p75: number | null];

export function line(year: number, type: TypeId, refnis: string, nl: string, fr: string, period: string, f: Fig, level: number): string {
  const [tn, tf] = TYPES[type];
  return [year, tn, tf, refnis, nl, fr, period, "totaal / total", ...f.map((x) => (x === null ? "" : String(x))), level].join("|");
}

const BE = ["01000", "BELGIE", "BELGIQUE"] as const;
const ANT = ["11002", "ANTWERPEN", "ANVERS"] as const;

// REAL national rows (level 1). Order of each list: closed, open, all, apt.
const NATIONAL: Record<string, Record<TypeId, Fig>> = {
  "2025 Y": { closed: [67331, 195000, 280000, 380000], open: [35531, 285000, 390000, 531500], all: [102862, 220000, 315000, 430000], apt: [53718, 190000, 250000, 328000] },
  "2025 S1": { closed: [32877, 195000, 280000, 380000], open: [17151, 285000, 385000, 525000], all: [50028, 220000, 315000, 425000], apt: [26154, 190000, 249000, 323000] },
  "2025 Q4": { closed: [17794, 192000, 280000, 382000], open: [9617, 285000, 392500, 549000], all: [27411, 217000, 315000, 435000], apt: [14189, 190000, 250000, 335000] },
  "2026 Q1": { closed: [15583, 195000, 285000, 389000], open: [7727, 297000, 405000, 563000], all: [23310, 220000, 320000, 440000], apt: [12774, 192500, 256500, 335000] },
  "2026 Q2": { closed: [15615, 190000, 285000, 389000], open: [7625, 295000, 400000, 550000], all: [23240, 215000, 319000, 440000], apt: [13718, 191000, 257500, 336000] },
  "2026 S1": { closed: [31198, 192500, 285000, 389000], open: [15352, 295000, 402400, 557675], all: [46550, 219000, 320000, 440000], apt: [26492, 192000, 257000, 335000] },
};

// REAL rows for the municipality of Antwerpen (level 5).
const ANTWERPEN: Record<string, Partial<Record<TypeId, Fig>>> = {
  "2025 Y": { all: [2949, 292000, 369000, 480000], apt: [6653, 195000, 245000, 320000] },
  "2026 Q1": { closed: [653, 290000, 374000, 476500], open: [32, 535000, 635000, 820000], all: [685, 293000, 375000, 490000], apt: [1509, 196025, 250000, 332100] },
  "2026 Q2": { closed: [615, 300000, 377500, 485000], open: [23, 485000, 809750, 1400005], all: [638, 300250, 380000, 491000], apt: [1645, 200000, 255000, 341777] },
  "2026 S1": { closed: [1268, 295000, 375000, 480250], open: [55, 499000, 660000, 1030000], all: [1323, 299000, 378000, 490000], apt: [3154, 199500, 255000, 338000] },
};

function build(): string[] {
  const out: string[] = [];
  for (const [pid, types] of Object.entries(NATIONAL)) {
    const [year, period] = pid.split(" ");
    for (const t of Object.keys(types) as TypeId[]) out.push(line(Number(year), t, ...BE, period, types[t], 1));
  }
  for (const [pid, types] of Object.entries(ANTWERPEN)) {
    const [year, period] = pid.split(" ");
    for (const t of Object.keys(types) as TypeId[]) out.push(line(Number(year), t, ...ANT, period, types[t]!, 5));
  }
  return out;
}

/** SYNTHETIC rows (invented numbers): the Flemish region and a tiny municipality, to test comparisons and blank cells. */
export const SYNTHETIC_LINES: string[] = [
  line(2026, "apt", "02000", "VLAAMS GEWEST", "REGION FLAMANDE", "Q2", [8000, 180000, 240000, 310000], 2),
  line(2026, "apt", "02000", "VLAAMS GEWEST", "REGION FLAMANDE", "S1", [15800, 181000, 241000, 311000], 2),
  line(2025, "apt", "02000", "VLAAMS GEWEST", "REGION FLAMANDE", "Y", [31000, 175000, 235000, 305000], 2),
  // a small municipality: the quarter is thin (12 sales), the half-year steadier (40), the year has 3 sales and blank quartiles
  line(2026, "apt", "44021", "GENT", "GAND", "Q2", [12, 190000, 230000, 280000], 5),
  line(2026, "apt", "44021", "GENT", "GAND", "S1", [40, 188000, 232000, 282000], 5),
  line(2025, "apt", "44021", "GENT", "GAND", "Y", [3, null, null, null], 5),
  // a municipality with four sales in the half-year: below the five-record floor, must never be published
  line(2026, "apt", "21009", "ELSENE", "IXELLES", "S1", [4, 200000, 210000, 220000], 5),
];

/** The REAL lines (header excluded). */
export const REAL_LINES: string[] = build();

/** The file as Statbel serves it: header and rows, CRLF line ends. */
export function fileText(extra: string[] = []): string {
  return [HEADER, ...REAL_LINES, ...extra].join("\r\n") + "\r\n";
}

/** Real library area keys (refnis|Dutch name|French name|level) of places the lookups must find; levels read from the file. */
export const REAL_AREA_KEYS = [
  "01000|BELGIE|BELGIQUE|1",
  "02000|VLAAMS GEWEST|REGION FLAMANDE|2",
  "03000|WAALS GEWEST|REGION WALLONNE|2",
  "04000|BRUSSELS HOOFDSTEDELIJK GEWEST|REGION DE BRUXELLES-CAPITALE|2",
  "10000|PROVINCIE ANTWERPEN|PROVINCE D'ANVERS|3",
  "20001|PROVINCIE VLAAMS-BRABANT|PROVINCE DE BRABANT FLAMAND|3",
  "20002|PROVINCIE WAALS-BRABANT|PROVINCE DE BRABANT WALLON|3",
  "90000|PROVINCIE NAMEN|PROVINCE DE NAMUR|3",
  "11000|ARRONDISSEMENT ANTWERPEN|ARRONDISSEMENT D'ANVERS|4", // French name of the arrondissement inferred, Dutch name read from the file
  "11002|ANTWERPEN|ANVERS|5",
  "21004|BRUSSEL|BRUXELLES|5",
  "21009|ELSENE|IXELLES|5",
  "24062|LEUVEN|LOUVAIN|5",
  "25121|OTTIGNIES-LOUVAIN-LA-NEUVE||5",
  "44021|GENT|GAND|5",
  "53053|BERGEN|MONS|5",
  "62063|LUIK|LIEGE|5",
];
