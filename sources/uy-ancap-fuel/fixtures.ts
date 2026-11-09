// Real rows from the Uruguay open-data catalogue (CKAN datastore of resource c486544e-0fca-4f6f-8403-3ee379a868f4, dataset
// "ancap-precio-combustible-pe"), copied from GitHub-Actions probes uyf-2 and uyf-3 of 2026-10-22. Nothing is invented.
// NOTE the real quirk: the columns "Unidad" and "Valor" are swapped in the data (the number sits in "Unidad", the unit in "Valor").
// For months without a quotation both hold "S/C" (sin cotizacion). The newest months, Aug and Sep 2026, are S/C for the pump fuels.
const r = (id: number, Mes: string, Producto: string, Unidad: string, Valor: string) => ({ _id: id, Ano: "2026", Mes, Producto, Unidad, Valor });
export const REAL_RECORDS = [
  r(26600, "9", "SUPER 95 30-S", "S/C", "S/C"),
  r(26599, "9", "PREMIUM 97 30-S", "S/C", "S/C"),
  r(26598, "9", "GASOIL 50-S *", "S/C", "S/C"),
  r(26597, "9", "GASOIL 10-S *", "S/C", "S/C"),
  r(26579, "8", "QUEROSENO ILUMINANTE", "67,5", "$/lt"),
  r(26578, "8", "SUPER 95 30-S", "S/C", "S/C"),
  r(26577, "8", "PREMIUM 97 30-S", "S/C", "S/C"),
  r(26576, "8", "GASOIL 50-S *", "S/C", "S/C"),
  r(26575, "8", "GASOIL 10-S *", "S/C", "S/C"),
  r(26556, "7", "SUPER 95 30-S", "88,67", "$/lt"),
  r(26555, "7", "PREMIUM 97 30-S", "91,19", "$/lt"),
  r(26554, "7", "GASOIL 50-S *", "58,68", "$/lt"),
  r(26553, "7", "GASOIL 10-S *", "67,33", "$/lt"),
  r(26534, "6", "SUPER 95 30-S", "93,36", "$/lt"),
  r(26533, "6", "PREMIUM 97 30-S", "96", "$/lt"),
  r(26532, "6", "GASOIL 50-S *", "61,76", "$/lt"),
  r(26531, "6", "GASOIL 10-S *", "70,91", "$/lt"),
];
export const REAL_REPLY = { success: true, result: { records: REAL_RECORDS, total: 26618 } };
/** The real first rows of the CSV (2022): the number is in the "Unidad" column there too. */
export const OLD_RECORDS = [
  { _id: 1, Ano: "2022", Mes: "2", Producto: "SUPER 95 30-S", Unidad: "73,41", Valor: "$/lt" },
  { _id: 2, Ano: "2022", Mes: "2", Producto: "GASOIL 10-S *", Unidad: "65,98", Valor: "$/lt" },
];

/** REAL lines of the dataset's static CSV (datos-de-precios-de-combustibles.csv, read 2026-11-09 from the open-data catalogue): semicolons, a UTF-8 BOM
 *  and a header on the full file, CRLF line ends, the number in "Unidad" and the unit in "Valor". The first line is cut, as a Range tail slice is. */
export const REAL_CSV_TAIL =
  "\uFEFFcio;Producto;Unidad;Valor\r\n" +
  [
    "2025;7;GASOIL 10-S *;55,08;$/lt",
    "2025;7;GASOIL 50-S *;48,08;$/lt",
    "2025;7;PREMIUM 97 30-S;81,13;$/lt",
    "2025;7;SUPER 95 30-S;78,72;$/lt",
    "2026;6;GASOIL 10-S *;70,91;$/lt",
    "2026;6;GASOIL 50-S *;61,76;$/lt",
    "2026;6;PREMIUM 97 30-S;96;$/lt",
    "2026;6;SUPER 95 30-S;93,36;$/lt",
    "2026;7;GASOIL 10-S *;67,33;$/lt",
    "2026;7;GASOIL 50-S *;58,68;$/lt",
    "2026;7;PREMIUM 97 30-S;91,19;$/lt",
    "2026;7;SUPER 95 30-S;88,67;$/lt",
    "2026;8;GASOIL 10-S *;S/C;S/C",
    "2026;8;GASOIL 50-S *;S/C;S/C",
    "2026;8;PREMIUM 97 30-S;S/C;S/C",
    "2026;8;SUPER 95 30-S;S/C;S/C",
    "2026;9;GASOIL 10-S *;S/C;S/C",
    "2026;9;GASOIL 50-S *;S/C;S/C",
    "2026;9;PREMIUM 97 30-S;S/C;S/C",
    "2026;9;SUPER 95 30-S;S/C;S/C"
  ].join("\r\n") +
  "\r\n";
