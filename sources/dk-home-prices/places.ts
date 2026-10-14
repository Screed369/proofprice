// Places of Denmark for the Statistics Denmark table EJEN77 "Sales of real property" (StatBank, tableinfo checked live 2026-10-14).
// The table's region variable holds: All Denmark (000), 5 regions (081-085) and 11 provinces ("landsdele", 01-11). It has NO
// municipalities. The list of municipalities below (code and name, as in StatBank table FOLK1A) is only used to point a
// municipality at the province it lies in; the grouping follows the order in which StatBank lists them under each province.

/** [code, name as published, short name used in answers] */
export type Area = [string, string, string];

export const DK_REGIONS: Area[] = [
  ["084", "Region Hovedstaden", "Region Hovedstaden"],
  ["085", "Region Sjælland", "Region Sjælland"],
  ["083", "Region Syddanmark", "Region Syddanmark"],
  ["082", "Region Midtjylland", "Region Midtjylland"],
  ["081", "Region Nordjylland", "Region Nordjylland"],
];

export const DK_PROVINCES: Area[] = [
  ["01", "Province Byen København", "Byen København"],
  ["02", "Province Københavns omegn", "Københavns omegn"],
  ["03", "Province Nordsjælland", "Nordsjælland"],
  ["04", "Province Bornholm", "Bornholm"],
  ["05", "Province Østsjælland", "Østsjælland"],
  ["06", "Province Vest- og Sydsjælland", "Vest- og Sydsjælland"],
  ["07", "Province Fyn", "Fyn"],
  ["08", "Province Sydjylland", "Sydjylland"],
  ["09", "Province Østjylland", "Østjylland"],
  ["10", "Province Vestjylland", "Vestjylland"],
  ["11", "Province Nordjylland", "Nordjylland"],
];

/** Province code -> region code. */
export const PROVINCE_REGION: Record<string, string> = {
  "01": "084", "02": "084", "03": "084", "04": "084",
  "05": "085", "06": "085",
  "07": "083", "08": "083",
  "09": "082", "10": "082",
  "11": "081",
};

/** Municipality code -> [name, province code]. 98 municipalities plus Christiansø (411). */
export const DK_MUNICIPALITIES: Record<string, [string, string]> = {
  // Byen København
  "101": ["Copenhagen", "01"], "147": ["Frederiksberg", "01"],
  // Københavns omegn
  "155": ["Dragør", "02"], "185": ["Tårnby", "02"], "165": ["Albertslund", "02"], "151": ["Ballerup", "02"], "153": ["Brøndby", "02"],
  "157": ["Gentofte", "02"], "159": ["Gladsaxe", "02"], "161": ["Glostrup", "02"], "163": ["Herlev", "02"], "167": ["Hvidovre", "02"],
  "169": ["Høje-Taastrup", "02"], "183": ["Ishøj", "02"], "173": ["Lyngby-Taarbæk", "02"], "175": ["Rødovre", "02"], "187": ["Vallensbæk", "02"],
  // Nordsjælland
  "201": ["Allerød", "03"], "240": ["Egedal", "03"], "210": ["Fredensborg", "03"], "250": ["Frederikssund", "03"], "190": ["Furesø", "03"],
  "270": ["Gribskov", "03"], "260": ["Halsnæs", "03"], "217": ["Helsingør", "03"], "219": ["Hillerød", "03"], "223": ["Hørsholm", "03"], "230": ["Rudersdal", "03"],
  // Bornholm
  "400": ["Bornholm", "04"], "411": ["Christiansø", "04"],
  // Østsjælland
  "253": ["Greve", "05"], "259": ["Køge", "05"], "350": ["Lejre", "05"], "265": ["Roskilde", "05"], "269": ["Solrød", "05"],
  // Vest- og Sydsjælland
  "320": ["Faxe", "06"], "376": ["Guldborgsund", "06"], "316": ["Holbæk", "06"], "326": ["Kalundborg", "06"], "360": ["Lolland", "06"],
  "370": ["Næstved", "06"], "306": ["Odsherred", "06"], "329": ["Ringsted", "06"], "330": ["Slagelse", "06"], "340": ["Sorø", "06"],
  "336": ["Stevns", "06"], "390": ["Vordingborg", "06"],
  // Fyn
  "420": ["Assens", "07"], "430": ["Faaborg-Midtfyn", "07"], "440": ["Kerteminde", "07"], "482": ["Langeland", "07"], "410": ["Middelfart", "07"],
  "480": ["Nordfyns", "07"], "450": ["Nyborg", "07"], "461": ["Odense", "07"], "479": ["Svendborg", "07"], "492": ["Ærø", "07"],
  // Sydjylland
  "530": ["Billund", "08"], "561": ["Esbjerg", "08"], "563": ["Fanø", "08"], "607": ["Fredericia", "08"], "510": ["Haderslev", "08"],
  "621": ["Kolding", "08"], "540": ["Sønderborg", "08"], "550": ["Tønder", "08"], "573": ["Varde", "08"], "575": ["Vejen", "08"],
  "630": ["Vejle", "08"], "580": ["Aabenraa", "08"],
  // Østjylland
  "710": ["Favrskov", "09"], "766": ["Hedensted", "09"], "615": ["Horsens", "09"], "707": ["Norddjurs", "09"], "727": ["Odder", "09"],
  "730": ["Randers", "09"], "741": ["Samsø", "09"], "740": ["Silkeborg", "09"], "746": ["Skanderborg", "09"], "706": ["Syddjurs", "09"], "751": ["Aarhus", "09"],
  // Vestjylland
  "657": ["Herning", "10"], "661": ["Holstebro", "10"], "756": ["Ikast-Brande", "10"], "665": ["Lemvig", "10"], "760": ["Ringkøbing-Skjern", "10"],
  "779": ["Skive", "10"], "671": ["Struer", "10"], "791": ["Viborg", "10"],
  // Nordjylland
  "810": ["Brønderslev", "11"], "813": ["Frederikshavn", "11"], "860": ["Hjørring", "11"], "849": ["Jammerbugt", "11"], "825": ["Læsø", "11"],
  "846": ["Mariagerfjord", "11"], "773": ["Morsø", "11"], "840": ["Rebild", "11"], "787": ["Thisted", "11"], "820": ["Vesthimmerlands", "11"], "851": ["Aalborg", "11"],
};
