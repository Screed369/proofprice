// Fixtures for fi-luke-farm-prices.
// META_*: the REAL table metadata (GET) captured 2026-10-23 from GitHub's servers with the probe workflow (meta-0200.json, meta-0100.json, meta-0300.json).
// DATA_*: responses in PxWeb's native "json" format ({columns, comments, data:[{key, values}]}), built by hand in that layout with plausible numbers;
// the POST itself cannot be probed (GET only), it was checked once on a preview deployment (see Notion row / Gap fixes done log).
import meta0200 from "./meta-0200.json";
import meta0100 from "./meta-0100.json";
import meta0300 from "./meta-0300.json";

export const META_0200: unknown = meta0200;
export const META_0100: unknown = meta0100;
export const META_0300: unknown = meta0300;

const cols = (series: { code: string; text: string }) => [
  { code: "INFO", text: "Information", type: "d" },
  { code: "M", text: "Month", type: "t" },
  { code: series.code, text: series.text, type: "d" },
  { code: "Value", text: "Value", type: "c" },
];

const months = ["2025M06", "2025M07", "2025M08", "2025M09", "2025M10", "2025M11", "2025M12", "2026M01", "2026M02", "2026M03", "2026M04", "2026M05", "2026M06", "2026M07", "2026M08"];

/** Meat: fattening pigs rising from 1.80 to 1.95 EUR/kg over the window, sows with a missing month, broilers flat. */
export const DATA_MEAT: unknown = {
  columns: cols({ code: "LJ", text: "Species" }),
  comments: [],
  data: [
    ...months.map((m, i) => ({ key: ["E_KGS", m, "LSIAT"], values: [String((180 + i * 1.1).toFixed(2))] })),
    ...months.map((m, i) => ({ key: ["E_KGS", m, "EMAK"], values: [i === 7 ? ".." : String((95 + i).toFixed(2))] })),
    ...months.map((m) => ({ key: ["E_KGS", m, "BROI"], values: ["140.00"] })),
  ],
};

/** Milk: average producer price in cents per litre. INFO is the content variable of this table, so the keys hold the month only (the layout the live server answered with on 23 Oct 2026). */
export const DATA_MILK: unknown = {
  columns: [
    { code: "M", text: "Month", type: "t" },
    { code: "INFO", text: "Information", type: "c" },
  ],
  comments: [],
  data: months.map((m, i) => ({ key: [m], values: [String((46 + i * 0.2).toFixed(2))] })),
};

/** Eggs: the newest month is not yet published ("."). */
export const DATA_EGGS: unknown = {
  columns: cols({ code: "LLUOKK_TUOTT", text: "Quality class/production method" }),
  comments: [],
  data: months.map((m, i) => ({ key: ["E_KGS", m, "AB_KESKIM"], values: [i === months.length - 1 ? "." : String((150 + i).toFixed(2))] })),
};
