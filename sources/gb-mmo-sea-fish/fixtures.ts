// A trimmed copy of sheet "Table 3" of the real MMO workbook UK_Sea_Fisheries_Statistics_September_2026.xlsx (GOV.UK release
// "Monthly Sea Fisheries Statistics September 2026", published 2026-10-30), read 2026-11-12 with categories/rent/xlsx readXlsx.
// Same cell layout (column A empty, species in B, tonnes, £000s, £/tonne; price "" when nothing was landed); a few species rows kept.
import type { Sheet } from "../../categories/rent/xlsx";

export const TABLE3: Sheet = {
  name: "Table 3",
  rows: [
    ["Table 3 - Landings of UK vessels into all ports (Live weight (tonnes), Value (£000's) and Price (£/tonne)) by Species "],
    [],
    [],
    [null, null, 46266],
    [null, null, "Live weight of landings (t)", "Value", "Price"],
    [null, null, null, "(£000s)", "(£/tonne)"],
    [null, "Bass", 80.07773815653923, 946.0928798547512, 11814.680354798362],
    [null, "Cod", 1284.3055327919124, 7557.169930819093, 5884.246184310047],
    [null, "Haddock", 5412.595980596424, 6041.864429999827, 1116.260007519361],
    [null, "Lemon Sole", 72.88695350410342, 397.4268200030221, 5452.646885298172],
    [null, "Monks or Anglers", 976.5538476436975, 3318.9807633116834, 3398.666413859276],
    [null, "Sand Eels", 0, 0, ""],
    [null, "Sole", 131.07046838086623, 2406.7231196762395, 18362.054774098717],
    [null, "Demersal", 12226.3052486043, 30259.632471352576, 2474.961311374659],
    [],
    [null, "Mackerel", 1416.4335649902016, 4761.231160007551, 3361.4221504560915],
    [null, "Herring", 16866.824249997822, 10047.57737076653, 595.7006026648928],
    [null, "Pelagic", 19878.5093675198, 15816.602817603014, 795.6634235083201],
    [null, null, null, null, ""],
    [null, "Lobsters", 293.91456792257134, 4136.314202243877, 14073.185386760226],
    [null, "Mussels", 0, 0, ""],
    [null, "Nephrops", 1604.52320999403, 5407.744370086097, 3370.3123372744594],
    [null, "Scallops", 2760.0840101457234, 3108.8069402975448, 1126.3450419878377],
    [null, "Shellfish", 9257.246914199115, 22880.073860749395, 2471.585134631666],
    [null, null, null, null, ""],
    [null, "All Fish", 41362.06153032322, 68956.30914970499, 1667.139078625275],
    [],
    [null, "Usage Notes"],
    [null, "See below the specific species codes that are combined into the corresponding sub groups in the table above."],
    [null, "Bream: BRB,POA,SBA,SBG,SBR,SBX"],
  ],
};
export const SHEETS: Sheet[] = [{ name: "Intro", rows: [["UK Sea Fisheries Statistics"]] }, { name: "Table 2", rows: [] }, TABLE3];

/** The GOV.UK content-API record of the release page, trimmed to the attachments (checked 2026-11-12). */
export const RELEASE_PAGE = {
  title: "Monthly Sea Fisheries Statistics September 2026",
  details: {
    attachments: [
      { title: "Accessible version: UK Sea Fisheries Statistics September 2026", url: "https://assets.publishing.service.gov.uk/media/6ae34469976f73ef5cfb6830/UK_Sea_Fisheries_Statistics_September_2026.ods", filename: "UK_Sea_Fisheries_Statistics_September_2026.ods" },
      { title: "Alternative version: UK Sea Fisheries Statistics August 2026", url: "https://assets.publishing.service.gov.uk/media/6ae34536d22fc5fecb3eb7a7/UK_Sea_Fisheries_Statistics_September_2026.xlsx", filename: "UK_Sea_Fisheries_Statistics_September_2026.xlsx" },
    ],
  },
};
