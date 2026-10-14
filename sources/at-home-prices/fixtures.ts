// Fixtures for STATISTIK AUSTRIA's "Sonderauswertung Immobilien-Durchschnittspreise" spreadsheet
// (https://www.statistik.at/fileadmin/pages/222/SonderauswertungImmobilienDurchschnittspreise.ods, 90,261 bytes).
// Checked live on 2026-10-14 through a Vercel preview (the file says "Erstellt am 28.05.2026"). Every row below is a real row of that file, as our
// ODS reader returns it: blank cells are "" and keep their column, trailing blanks are dropped. Only a selection of places is kept.

import type { OdsSheet } from "./ods";

export const CHECKED = "2026-10-14";

const YEARS = ["2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
const DISTRICT_HEADER = ["Bz. Nr.", "Bezirk", ...YEARS];
const MUNICIPALITY_HEADER = ["Gem. Kennziffer", "Gemeindename", ...YEARS];
const STATE_YEARS = ["", ...YEARS];

export const FOOTER_DISTRICT =
  "Q: STATISTIK AUSTRIA. Erstellt am 28.05.2026. Alle Ergebnisse sind Medianwerte. Preis in Euro pro Quadratmeter Wohnfläche. Können nach der Datenaufbereitung weniger als 10 Transaktionen in die Kalkulation eingehen, werden keine Bezirkswerte angegeben. " +
  "Laufende jährliche Revision der Vorjahre, um die Vergleichbarkeit der Mittelwerte hinsichtlich methodischer Differenzen und Datennachlieferungen zu gewährleisten. " +
  "Kleinräumige Medianwerte stellen keine reine Preisveränderung dar, sondern enthalten auch Qualitäts- und Standortfaktoren.";
const FOOTER_STATE_HOUSES =
  "Q: STATISTIK AUSTRIA. Erstellt am 28.05.2026. Alle Ergebnisse sind Medianwerte. Preis in Euro pro Quadratmeter Wohnfläche. Laufende jährliche Revision der Vorjahre, um die Vergleichbarkeit der Mittelwerte hinsichtlich methodischer Differenzen und Datennachlieferungen zu gewährleisten.";
const FOOTER_LAND = "Q: STATISTIK AUSTRIA. Erstellt am 28.05.2026. Alle Ergebnisse sind geometrische Mittel. Preis in Euro pro Quadratmeter Grundfläche.";

const row = (...cells: (string | number)[]): string[] => cells.map(String);

export const SHEETS: OdsSheet[] = [
  {
    name: "Wohnungspreise",
    rows: [
      row("Durchschnittliche Wohnungspreise pro pol. Bezirk in den Jahren 2015-2025"),
      DISTRICT_HEADER,
      row(101, "Eisenstadt (Stadt)", "", 1096, 1199, 1455, 1977, 1905, 3348, 2544, 1613, 2299, 2727),
      row(102, "Rust (Stadt)"),
      row(104, "Güssing", "", "", "", "", "", 1206, 1273, 1159, "", "", 919),
      row(105, "Jennersdorf", "", "", "", "", "", "", "", 1255, 1082),
      row(201, "Klagenfurt Stadt", 2147, 1955, 2141, 1824, 2198, 2576, 2750, 3799, 3030, 3262, 3352),
      row(204, "Klagenfurt Land", 2823, 2735, 2573, 2920, 3400, 3964, 3779, 4555, 5037, 4533, 4490),
      row(303, "Waidhofen an der Ybbs (Stadt)", "", "", "", "", 1227, 1461, 1457, 1839, 1748, 1744, 1750),
      row(306, "Baden", 2465, 2590, 2524, 2711, 3246, 3294, 3374, 3600, 3610, 3267, 3621),
      row(921, "Wien 21.,Floridsdorf", 2869, 3253, 3394, 3665, 3894, 4110, 4456, 4852, 4450, 4476, 5253),
      row(922, "Wien 22.,Donaustadt", 3679, 3903, 3953, 4265, 4557, 4782, 5111, 5932, 5600, 5443, 5714),
      row(923, "Wien 23.,Liesing", 3047, 3397, 3878, 3590, 3884, 4301, 4499, 5090, 4820, 4917, 4835),
      [FOOTER_DISTRICT],
    ],
  },
  {
    name: "Häuserpreise",
    rows: [
      row("Durchschnittliche Häuserpreise pro pol. Bezirk in den Jahren 2015-2025"),
      DISTRICT_HEADER,
      row(101, "Eisenstadt (Stadt)", 1255, 1880, 1583, 1978, 2241, 2515, 2017, 2874, 2614, 2465, 2278),
      row(102, "Rust (Stadt)"),
      row(104, "Güssing", 744, 894, 875, 1000, 995, 1075, 1288, 1718, 1296, 1545, 1405),
      row(201, "Klagenfurt Stadt", 1652, 1891, 2271, 2040, 2182, 2419, 2625, 3182, 3301, 3031, 3313),
      row(303, "Waidhofen an der Ybbs (Stadt)", 1435, 1411, "", "", 2269, 1351, 2473, 2050, 1948, 2510, 2025),
      row(306, "Baden", 1987, 2330, 2336, 2469, 2500, 2829, 3250, 3756, 3574, 3397, 3467),
      row(921, "Wien 21.,Floridsdorf", 3465, 3679, 4027, 4137, 4548, 4692, 4642, 5020, 5957, 5333, 5135),
      row(922, "Wien 22.,Donaustadt", 3216, 3454, 3809, 3882, 4144, 4473, 5196, 5242, 5025, 5048, 4929),
      row(923, "Wien 23.,Liesing", 3491, 3894, 3598, 4382, 4714, 5306, 4908, 5653, 5201, 5778, 5000),
      [FOOTER_DISTRICT],
    ],
  },
  {
    name: "Grundpreise",
    rows: [
      row("Durchschnittliche Grundpreise pro pol. Bezirk in den Jahren 2015-2025"),
      DISTRICT_HEADER,
      row(104, "Güssing", 12.2, 12, 15, 10, 14.6, 14.5, 15, 16.399999999999999, 16.3, 23.8, 17.399999999999999),
      row(306, "Baden", 126.5, 124.8, 140, 143.5, 148.4, 198.4, 225.6, 236.1, 271.8, 349.5, 329.5),
      [FOOTER_DISTRICT.replace("Wohnfläche", "Grundfläche")],
    ],
  },
  {
    name: "Bundesländer",
    rows: [
      row("Durchschnittliche Häuserpreise in den Bundesländern in den Jahren 2015- 2025"),
      row("Bundesland", "Jahr"),
      STATE_YEARS,
      row("Österreich", 1667, 1776, 1898, 1986, 2108, 2297, 2616, 2900, 2662, 2711, 2836),
      row("Burgenland", 1030, 1111, 1182, 1286, 1341, 1407, 1667, 1923, 1807, 1804, 1889),
      row("Kärnten", 1352, 1525, 1619, 1642, 1714, 1889, 2083, 2469, 2551, 2500, 2609),
      row("Niederösterreich", 1484, 1625, 1738, 1837, 1978, 2182, 2500, 2807, 2497, 2526, 2653),
      row("Oberösterreich", 1724, 1820, 1917, 2000, 2219, 2372, 2692, 2990, 2798, 2773, 2905),
      row("Salzburg", 3023, 3251, 3427, 3484, 3632, 4083, 4864, 5333, 5161, 4974, 4766),
      row("Steiermark", 1444, 1529, 1638, 1734, 1796, 1926, 2183, 2468, 2336, 2408, 2421),
      row("Tirol", 2413, 2883, 3130, 3285, 3467, 4000, 4756, 5055, 4924, 4967, 4828),
      row("Vorarlberg", 2846, 2973, 3450, 3846, 4038, 4247, 4914, 5528, 5544, 5075, 5077),
      row("Wien", 3579, 3795, 4015, 4207, 4556, 4833, 5421, 5692, 5502, 5462, 5376),
      [FOOTER_STATE_HOUSES],
      [],
      row("Durchschnittliche Wohnungspreise in den Bundesländern in den Jahren 2015 - 2025"),
      row("Bundesland", "Jahr"),
      STATE_YEARS,
      row("Österreich", 2769, 2950, 3068, 3269, 3480, 3625, 3951, 4364, 4000, 3986, 4162),
      row("Burgenland", 1266, 1143, 1200, 1148, 1543, 1643, 1917, 1819, 1821, 1850, 1859),
      row("Kärnten", 2114, 1929, 2135, 2242, 2452, 2864, 3128, 3819, 3332, 3346, 3260),
      row("Niederösterreich", 2367, 2304, 2473, 2618, 2683, 3000, 3141, 3438, 3050, 2959, 3089),
      row("Oberösterreich", 2218, 2100, 2232, 2422, 2880, 2975, 3232, 3508, 3182, 3200, 3373),
      row("Salzburg", 3151, 3300, 3333, 3566, 4002, 4175, 4646, 4950, 5012, 4926, 4968),
      row("Steiermark", 1994, 2046, 2224, 2379, 2637, 2654, 2849, 3055, 2749, 2749, 2750),
      row("Tirol", 2885, 3115, 3235, 3483, 3896, 4114, 4540, 5210, 4783, 4764, 4965),
      row("Vorarlberg", 2949, 3284, 3572, 3882, 3957, 4615, 5100, 5376, 4923, 4978, 5000),
      row("Wien", 3333, 3624, 3828, 4007, 4217, 4538, 5009, 5516, 5000, 4940, 5212),
      [FOOTER_STATE_HOUSES],
      [],
      row("Durchschnittliche Baugrundstückspreise in den Bundesländern in den Jahren 2015 - 2025"),
      row("Bundesland", "Jahr"),
      STATE_YEARS,
      row("Österreich", 77, 76, 79, 80, 79, 82, 85, 102, 120, 137, 153),
      row("Burgenland", 59.4, 55.2, 58, 59, 60.8, 57.3, 64.8, 56.5, 58.9, 83.3, 93),
      [FOOTER_LAND],
    ],
  },
  {
    name: "Wohnungspreise_100_Gemeinden",
    rows: [
      row("Durchschnittliche Wohnungspreise der 100 bevölkerungsreichsten Gemeinden in den Jahren 2015- 2025"),
      MUNICIPALITY_HEADER,
      row(90001, "Wien", 3333, 3624, 3828, 4007, 4217, 4538, 5009, 5516, 5000, 4940, 5212),
      row(60101, "Graz", 2415, 2433, 2654, 2788, 3000, 3125, 3295, 3420, 3299, 3075, 3193),
      row(40101, "Linz", 2527, 2366, 2650, 3039, 3554, 3303, 3854, 3731, 3488, 3371, 3749),
      row(50101, "Salzburg", 3349, 3603, 3571, 3837, 4192, 4423, 5000, 5430, 5101, 5000, 5114),
      row(70101, "Innsbruck", 3879, 4186, 4269, 4613, 5062, 5502, 6000, 6476, 6036, 5886, 6034),
      row(20101, "Klagenfurt am Wörthersee", 2147, 1955, 2141, 1824, 2198, 2576, 2750, 3799, 3030, 3262, 3352),
      row(30201, "Sankt Pölten", 1335, 1337, 1708, 1768, 1809, 1956, 2324, 3564, 3043, 2083, 2665),
      row(30604, "Baden", 2805, 2607, 2400, 2833, 3410, 3949, 3363, 3707, 4198, 3484, 3551),
      row(30639, "Traiskirchen", 2342, 3229, 2791, 2908, 3683, 3781, 3545, 3872, "", "", 2585),
      row(10101, "Eisenstadt", "", 1096, 1199, 1455, 1977, 1905, 3348, 2544, 1613, 2299, 2727),
      row(41116, "Perg", 2097, 1861, "", "", 2267, 3038, 2594, 2221, "", 2189, 2594),
      [FOOTER_DISTRICT.replace("Bezirkswerte", "Gemeindewerte")],
    ],
  },
  {
    name: "Häuserpreise_100_Gemeinden",
    rows: [
      row("Durchschnittliche Hauspreise der 100 bevölkerungsreichsten Gemeinden in den Jahren 2015-2025"),
      MUNICIPALITY_HEADER,
      row(90001, "Wien", 3579, 3795, 4015, 4207, 4556, 4833, 5421, 5692, 5502, 5462, 5376),
      row(60101, "Graz", 2276, 2556, 2662, 2842, 2910, 3658, 3584, 4415, 3943, 4000, 4034),
      row(40101, "Linz", 2621, 2842, 3170, 3117, 2950, 3214, 2896, 4698, 3923, 3876, 4050),
      row(50101, "Salzburg", 4211, 4412, 4750, 4450, 5391, 5657, 6980, 7500, 6923, 6541, 6167),
      row(70101, "Innsbruck", 4990, 3688, 3493, 5634, 5140, 6100, 6840, "", "", 6354, 5621),
      row(20101, "Klagenfurt am Wörthersee", 1652, 1891, 2271, 2040, 2182, 2419, 2625, 3182, 3301, 3031, 3313),
      row(30201, "Sankt Pölten", 1652, 1897, 1942, 1970, 2154, 2591, 2769, 2847, 2667, 3022, 2963),
      row(30604, "Baden", 2762, 2748, 2927, 2850, 3168, 3485, 4546, 4445, 4559, 4267, 4257),
      row(70513, "Kufstein", "", "", "", "", "", "", "", "", "", "", 6040),
      row(80207, "Bregenz", 3541, 2675, "", 4384, "", "", 6397, "", "", "", 5588),
      row(41116, "Perg", "", "", 1231, 1700, 2572, 2784, 2646, 2399, "", 2723, 2797),
      row(70346, "Rum"),
      [FOOTER_DISTRICT.replace("Bezirkswerte", "Gemeindewerte")],
    ],
  },
  {
    name: "Bundesländer_und_Bauperioden",
    rows: [
      row("Gesamte durchschnittliche Häuserpreise in den Bundesländern in den Jahren 2021-2025, getrennt nach Bauperioden"),
      row("Bundesländer", "Gesamt", "Bauperiode"),
      row("", "", "Vor 1960", "1960-1990", "Nach 1990"),
      row("Burgenland", 1911, 1580, 1878, 2497),
      row("Wien", 5682, 6177, 5434, 5470),
      ["Q: STATISTIK AUSTRIA. Erstellt am 28.05.2026. - Datenbasis 2021-2025. Alle Ergebnisse sind geometrische Mittel."],
    ],
  },
];

/** A real piece of the file's content.xml: the title row, and the district rows of Güssing and Jennersdorf (empty cells are stored as repeated runs). */
export const CONTENT_XML_ROWS = [
  '<table:table-row table:style-name="ro1"><table:table-cell office:value-type="string" table:number-columns-spanned="13" table:number-rows-spanned="1" table:style-name="ce22"><text:p>Durchschnittliche Wohnungspreise pro pol. Bezirk in den Jahren 2015-2025</text:p></table:table-cell><table:covered-table-cell table:number-columns-repeated="12"/><table:table-cell table:number-columns-repeated="16371" table:style-name="ce1"/></table:table-row>',
  '<table:table-row table:style-name="ro2"><table:table-cell office:value-type="float" office:value="104" table:style-name="ce11"><text:p>104</text:p></table:table-cell><table:table-cell office:value-type="string" table:style-name="ce12"><text:p>Güssing</text:p></table:table-cell><table:table-cell table:number-columns-repeated="5" table:style-name="ce13"/><table:table-cell office:value-type="float" office:value="1206" table:style-name="ce13"><text:p>1 206</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1273" table:style-name="ce13"><text:p>1 273</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1159" table:style-name="ce13"><text:p>1 159</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2" table:style-name="ce13"/><table:table-cell office:value-type="float" office:value="919" table:style-name="ce14"><text:p>919</text:p></table:table-cell><table:table-cell table:style-name="ce10"/><table:table-cell table:number-columns-repeated="3" table:style-name="ce1"/><table:table-cell table:number-columns-repeated="3" table:style-name="ce5"/><table:table-cell table:number-columns-repeated="16364"/></table:table-row>',
  '<table:table-row table:style-name="ro2"><table:table-cell office:value-type="float" office:value="105" table:style-name="ce6"><text:p>105</text:p></table:table-cell><table:table-cell office:value-type="string" table:style-name="ce7"><text:p>Jennersdorf</text:p></table:table-cell><table:table-cell table:number-columns-repeated="7" table:style-name="ce8"/><table:table-cell office:value-type="float" office:value="1255" table:style-name="ce8"><text:p>1 255</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1082" table:style-name="ce8"><text:p>1 082</text:p></table:table-cell><table:table-cell table:style-name="ce8"/><table:table-cell table:style-name="ce9"/><table:table-cell table:style-name="ce10"/><table:table-cell table:number-columns-repeated="3" table:style-name="ce1"/><table:table-cell table:number-columns-repeated="16364"/></table:table-row>',
];

/** The real start of the table (the sheet name and the column definitions of the "Wohnungspreise" sheet). */
export const CONTENT_XML_TABLE_OPEN =
  '<table:table table:name="Wohnungspreise" table:style-name="ta1"><table:table-column table:style-name="co1" table:default-cell-style-name="ce1"/><table:table-column table:style-name="co2" table:default-cell-style-name="ce1"/><table:table-column table:style-name="co3" table:number-columns-repeated="11" table:default-cell-style-name="ce1"/><table:table-column table:style-name="co4" table:number-columns-repeated="16371" table:default-cell-style-name="ce1"/>';
