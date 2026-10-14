// Common public purchases, shared by every government-contracts source.
// A request says what was bought in plain words ("laptops", "school meals"). Where the words match a purchase below we use
// its official product codes (CPV, the EU Common Procurement Vocabulary) for TED and, for the US and the UK, search words.
// Anything else goes to the source as free text. Every CPV code below was counted against live TED award notices on
// 2026-10-14 (each one matches hundreds to tens of thousands of notices in the last 24 months).

export interface Purchase {
  id: string;
  /** English label used in answers, e.g. "laptops". */
  label: string;
  /** Words people use, in English and the main EU languages (matched without accents, case or punctuation). */
  aliases: string[];
  /** CPV codes (8 digits) that cover the purchase. */
  cpv: string[];
  /** Search words for sources that have no product codes (USAspending, Contracts Finder). Several words are searched as a phrase. */
  keyword: string;
  /** Contracts Finder searches several words as "any of them", so a single distinctive word can work better than the phrase. */
  gb?: string;
  /** A US product-or-service code (PSC) that covers the purchase better than a keyword does. */
  usPsc?: string;
}

export const PURCHASES: Purchase[] = [
  {
    id: "laptops", label: "laptops", cpv: ["30213100"], keyword: "laptop",
    aliases: ["laptop", "laptops", "laptop computer", "laptop computers", "notebook", "notebooks", "notebook computer", "notebook computers",
      "portable computer", "portable computers", "ordinateur portable", "ordinateurs portables", "pc portable", "pc portables",
      "portatil", "portatiles", "ordenador portatil", "ordenadores portatiles", "computer portatile", "computer portatili", "pc portatili",
      "tragbarer computer", "tragbare computer", "laptops und notebooks", "computador portatil", "computadores portateis",
      "laptopy", "komputery przenosne", "draagbare computers", "bærbar computer", "bärbar dator"],
  },
  {
    id: "desktop-computers", label: "desktop computers", cpv: ["30213300"], keyword: "desktop computer",
    aliases: ["desktop computer", "desktop computers", "desktop pc", "desktop pcs", "desktops", "ordinateur de bureau", "ordinateurs de bureau",
      "pc fixe", "ordenador de sobremesa", "ordenadores de sobremesa", "computer desktop", "tischcomputer", "desktop rechner", "bureaucomputers"],
  },
  {
    id: "tablets", label: "tablet computers", cpv: ["30213200"], keyword: "tablet",
    aliases: ["tablet", "tablets", "tablet computer", "tablet computers", "tablette", "tablettes", "tableta", "tabletas", "tablets pc"],
  },
  {
    id: "school-meals", label: "school meals", cpv: ["55524000", "55523100"], keyword: "school meals",
    aliases: ["school meals", "school meal", "school catering", "school lunch", "school lunches", "school dinners", "school canteen", "school food",
      "restauration scolaire", "repas scolaires", "cantine scolaire", "schulessen", "schulverpflegung", "schulcatering", "schulkantine",
      "comedor escolar", "comedores escolares", "catering escolar", "ristorazione scolastica", "mensa scolastica", "schoolmaaltijden",
      "refeicoes escolares", "refeitorio escolar", "alimentacao escolar", "posilki szkolne", "skolemad", "skolmat"],
  },
  {
    id: "catering", label: "catering services", cpv: ["55520000"], keyword: "catering",
    aliases: ["catering", "catering services", "restauration", "verpflegung", "restauracion", "ristorazione", "cateringdiensten"],
  },
  {
    id: "road-resurfacing", label: "road resurfacing and repair", cpv: ["45233251", "45233250", "45233142", "45233141"], keyword: "road resurfacing",
    gb: "resurfacing", usPsc: "Z2LB",
    aliases: ["road resurfacing", "resurfacing", "resurfacing roads", "road repair", "road repairs", "road maintenance", "road surfacing", "road works",
      "roadworks", "repaving", "asphalt resurfacing", "carriageway resurfacing", "highway maintenance",
      "refection de chaussee", "reparation de chaussee", "entretien des routes", "entretien de voirie", "travaux de voirie", "rechargement de chaussee",
      "strassensanierung", "fahrbahnsanierung", "strassenunterhaltung", "strassenbau", "fahrbahndecke", "deckenerneuerung",
      "reasfaltado", "asfaltado", "repavimentacion", "mantenimiento de carreteras", "conservacion de carreteras",
      "manutenzione stradale", "rifacimento del manto stradale", "asfaltatura", "wegonderhoud", "asfalteren", "wegdek",
      "repavimentacao", "conservacao de estradas", "remont drog", "nawierzchnia drogowa"],
  },
  {
    id: "office-cleaning", label: "office cleaning", cpv: ["90919200"], keyword: "office cleaning",
    aliases: ["office cleaning", "cleaning offices", "office cleaning services", "nettoyage de bureaux", "nettoyage des locaux", "buroreinigung", "bueroreinigung",
      "limpieza de oficinas", "pulizia uffici", "kantoorschoonmaak", "limpeza de escritorios", "sprzatanie biur"],
  },
  {
    id: "building-cleaning", label: "building cleaning", cpv: ["90911200"], keyword: "building cleaning",
    aliases: ["building cleaning", "cleaning services", "cleaning", "nettoyage de batiments", "gebaudereinigung", "gebaeudereinigung", "limpieza de edificios", "pulizia edifici"],
  },
  {
    id: "school-cleaning", label: "school cleaning", cpv: ["90919300"], keyword: "school cleaning",
    aliases: ["school cleaning", "nettoyage des ecoles", "schulreinigung", "limpieza de colegios", "pulizia scuole"],
  },
  {
    id: "electricity", label: "electricity supply", cpv: ["09310000"], keyword: "electricity supply",
    aliases: ["electricity", "electricity supply", "supply of electricity", "electric power", "power supply", "electricite", "fourniture d electricite",
      "fourniture electricite", "strom", "stromlieferung", "stromversorgung", "elektrizitat", "suministro electrico", "suministro de electricidad", "electricidad",
      "fornitura di energia elettrica", "energia elettrica", "elektriciteit", "elektriciteitslevering", "fornecimento de eletricidade", "dostawa energii elektrycznej"],
  },
  {
    id: "natural-gas", label: "natural gas supply", cpv: ["09123000"], keyword: "natural gas supply",
    aliases: ["natural gas", "gas supply", "natural gas supply", "gaz naturel", "fourniture de gaz", "erdgas", "erdgaslieferung", "gas natural", "suministro de gas", "gas naturale", "aardgas"],
  },
  {
    id: "diesel", label: "diesel fuel", cpv: ["09134200", "09134100"], keyword: "diesel fuel",
    aliases: ["diesel", "diesel fuel", "gas oil", "gasoil", "gazole", "carburant diesel", "dieselkraftstoff", "gasoleo", "gasolio", "diesel brandstof"],
  },
  {
    id: "ambulances", label: "ambulances", cpv: ["34114121", "34114110", "34114120", "34114122"], keyword: "ambulance",
    aliases: ["ambulance", "ambulances", "ambulancia", "ambulancias", "ambulanza", "ambulanze", "krankenwagen", "rettungswagen", "ambulancevoertuigen", "ambulancias medicalizadas"],
  },
  {
    id: "waste-collection", label: "waste collection", cpv: ["90511000", "90511100", "90511200", "90511300"], keyword: "waste collection",
    aliases: ["waste collection", "refuse collection", "rubbish collection", "garbage collection", "bin collection", "household waste collection", "collecte des dechets",
      "ramassage des ordures", "collecte des ordures menageres", "muellabfuhr", "abfallsammlung", "abfallentsorgung", "muellentsorgung", "recogida de residuos",
      "recogida de basuras", "raccolta rifiuti", "raccolta dei rifiuti", "afvalinzameling", "recolha de residuos", "odbior odpadow"],
  },
  {
    id: "street-cleaning", label: "street cleaning and sweeping", cpv: ["90610000"], keyword: "street cleaning",
    aliases: ["street cleaning", "street sweeping", "road sweeping", "nettoyage de la voirie", "strassenreinigung", "limpieza viaria", "pulizia stradale", "straatreiniging"],
  },
  {
    id: "winter-maintenance", label: "snow clearing and winter maintenance", cpv: ["90620000"], keyword: "snow clearing",
    aliases: ["snow clearing", "snow removal", "winter maintenance", "gritting", "deneigement", "winterdienst", "schneeraumung", "quitanieves", "sgombero neve", "sneeuwruiming"],
  },
  {
    id: "school-transport", label: "school transport", cpv: ["60130000"], keyword: "school transport",
    aliases: ["school transport", "school bus service", "school bus services", "home to school transport", "transport scolaire", "schulbustransport", "schulbeforderung", "transporte escolar", "trasporto scolastico", "leerlingenvervoer"],
  },
  {
    id: "buses", label: "buses", cpv: ["34121100", "34121000"], keyword: "bus",
    aliases: ["bus", "buses", "coach", "coaches", "public transport buses", "autobus", "autocars", "omnibus", "autobuses", "autobus urbani", "bussen"],
  },
  {
    id: "electric-buses", label: "electric buses", cpv: ["34144910"], keyword: "electric bus",
    aliases: ["electric bus", "electric buses", "e bus", "e buses", "bus electrique", "bus electriques", "elektrobus", "elektrobusse", "autobus electrico", "autobus elettrico", "elektrische bussen"],
  },
  {
    id: "cars", label: "passenger cars", cpv: ["34110000"], keyword: "passenger car",
    aliases: ["passenger cars", "passenger car", "cars", "car", "vehicles", "voitures particulieres", "voitures", "personenkraftwagen", "pkw", "turismos", "automobili", "personenauto s"],
  },
  {
    id: "fire-engines", label: "fire engines", cpv: ["34144210"], keyword: "fire engine",
    aliases: ["fire engine", "fire engines", "fire truck", "fire trucks", "camion de pompiers", "vehicule de pompiers", "feuerwehrfahrzeug", "feuerwehrfahrzeuge", "camion de bomberos", "autopompa", "brandweerwagen"],
  },
  {
    id: "mobile-phones", label: "mobile phones", cpv: ["32250000"], keyword: "mobile phone",
    aliases: ["mobile phone", "mobile phones", "smartphone", "smartphones", "cell phone", "cell phones", "telephone mobile", "telephones mobiles", "mobiltelefone", "handys", "telefonos moviles", "telefoni cellulari", "mobiele telefoons"],
  },
  {
    id: "printers", label: "printers", cpv: ["30232110"], keyword: "printer",
    aliases: ["printer", "printers", "laser printer", "laser printers", "imprimante", "imprimantes", "drucker", "impresoras", "impresora", "stampanti", "printers en kopieerders"],
  },
  {
    id: "photocopiers", label: "photocopiers", cpv: ["30121100"], keyword: "photocopier",
    aliases: ["photocopier", "photocopiers", "copier", "copiers", "copieur", "photocopieur", "photocopieurs", "kopierer", "fotokopierer", "fotocopiadoras", "fotocopiatrici"],
  },
  {
    id: "office-furniture", label: "office furniture", cpv: ["39130000"], keyword: "office furniture",
    aliases: ["office furniture", "mobilier de bureau", "buromobel", "bueromoebel", "mobiliario de oficina", "mobili per ufficio", "kantoormeubilair"],
  },
  {
    id: "uniforms", label: "uniforms and workwear", cpv: ["18100000"], keyword: "uniforms",
    aliases: ["uniform", "uniforms", "workwear", "work clothing", "vetements de travail", "uniformes", "arbeitskleidung", "dienstkleidung", "ropa de trabajo", "abbigliamento da lavoro", "werkkleding"],
  },
  {
    id: "textbooks", label: "textbooks", cpv: ["22112000"], keyword: "textbooks",
    aliases: ["textbook", "textbooks", "school books", "manuels scolaires", "schulbucher", "schulbuecher", "libros de texto", "libri di testo", "schoolboeken", "podreczniki"],
  },
  {
    id: "software", label: "software packages", cpv: ["48000000"], keyword: "software licenses",
    aliases: ["software", "software licences", "software licenses", "software packages", "logiciels", "licences logicielles", "softwarelizenzen", "licencias de software", "licenze software"],
  },
  {
    id: "it-services", label: "IT services", cpv: ["72000000"], keyword: "IT services",
    aliases: ["it services", "information technology services", "services informatiques", "it dienstleistungen", "servicios informaticos", "servizi informatici", "it diensten"],
  },
  {
    id: "legal-services", label: "legal services", cpv: ["79100000"], keyword: "legal services",
    aliases: ["legal services", "law services", "services juridiques", "rechtsberatung", "juristische dienstleistungen", "servicios juridicos", "servizi legali", "juridische diensten"],
  },
  {
    id: "consultancy", label: "management consultancy", cpv: ["79400000"], keyword: "consultancy",
    aliases: ["consultancy", "consulting", "management consultancy", "business consultancy", "conseil en gestion", "unternehmensberatung", "consultoria", "consulenza gestionale", "adviesdiensten"],
  },
  {
    id: "security-guards", label: "security guard services", cpv: ["79713000"], keyword: "security guard",
    aliases: ["security guard", "security guards", "security guard services", "guarding services", "gardiennage", "services de gardiennage", "wachdienst", "bewachung", "sicherheitsdienst", "vigilancia", "servicios de vigilancia", "vigilanza", "bewaking"],
  },
  {
    id: "grounds-maintenance", label: "grounds and green-space maintenance", cpv: ["77310000"], keyword: "grounds maintenance",
    aliases: ["grounds maintenance", "landscaping", "green space maintenance", "gardening", "entretien des espaces verts", "gruenflachenpflege", "grunflachenpflege", "mantenimiento de zonas verdes", "manutenzione del verde", "groenvoorziening"],
  },
  {
    id: "school-construction", label: "school building construction", cpv: ["45214200"], keyword: "school construction",
    aliases: ["school construction", "school building", "school building construction", "construction d ecole", "construction scolaire", "schulbau", "construccion de colegios", "edilizia scolastica", "schoolbouw"],
  },
  {
    id: "hospital-construction", label: "hospital and health building construction", cpv: ["45215100"], keyword: "hospital construction",
    aliases: ["hospital construction", "health building construction", "construction d hopital", "krankenhausbau", "construccion de hospitales", "edilizia ospedaliera", "ziekenhuisbouw"],
  },
  {
    id: "bridges", label: "bridge construction", cpv: ["45221100"], keyword: "bridge construction",
    aliases: ["bridge construction", "bridge", "bridges", "construction de ponts", "pont", "brucken", "bruckenbau", "brueckenbau", "construccion de puentes", "costruzione di ponti", "brugbouw"],
  },
  {
    id: "pharmaceuticals", label: "pharmaceutical products", cpv: ["33600000"], keyword: "pharmaceutical",
    aliases: ["pharmaceuticals", "pharmaceutical products", "medicines", "medicinal products", "medicaments", "produits pharmaceutiques", "arzneimittel", "medicamentos", "farmaci", "geneesmiddelen"],
  },
  {
    id: "vaccines", label: "vaccines", cpv: ["33651600"], keyword: "vaccine",
    aliases: ["vaccine", "vaccines", "vaccins", "impfstoffe", "vacunas", "vaccini", "vaccins en sera"],
  },
  {
    id: "surgical-gloves", label: "surgical gloves", cpv: ["33141420"], keyword: "surgical gloves",
    aliases: ["surgical gloves", "medical gloves", "gloves", "gants chirurgicaux", "gants medicaux", "operationshandschuhe", "untersuchungshandschuhe", "guantes quirurgicos", "guanti chirurgici"],
  },
  {
    id: "solar-panels", label: "solar photovoltaic modules", cpv: ["09331200"], keyword: "solar panels",
    aliases: ["solar panels", "solar panel", "photovoltaic panels", "photovoltaic modules", "panneaux solaires", "modules photovoltaiques", "solarmodule", "photovoltaikmodule", "paneles solares", "pannelli solari", "zonnepanelen"],
  },
  {
    id: "translation", label: "translation services", cpv: ["79530000"], keyword: "translation services",
    aliases: ["translation", "translation services", "traduction", "services de traduction", "ubersetzung", "uebersetzungsdienste", "traduccion", "traduzione", "vertaaldiensten"],
  },
  {
    id: "insurance", label: "insurance services", cpv: ["66510000"], keyword: "insurance",
    aliases: ["insurance", "insurance services", "assurance", "services d assurance", "versicherung", "versicherungsleistungen", "seguros", "servicios de seguros", "assicurazione", "verzekering"],
  },
];

/** Lower-case, no accents (ß, æ, œ, ø, ł and đ are spelled out), letters and digits only, single spaces. */
export function normaliseText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INDEX: { alias: string; purchase: Purchase }[] = PURCHASES.flatMap((p) =>
  p.aliases.map((a) => ({ alias: normaliseText(a), purchase: p })),
).sort((a, b) => b.alias.length - a.alias.length);

// One-word aliases that are too generic to pick out a purchase from inside a longer request ("tablet formulation", "cleaning of windows").
// They only match when they are the whole request.
const GENERIC_WORDS = new Set([
  "cleaning", "catering", "software", "insurance", "consulting", "consultancy", "vehicles", "bridge", "bridges", "gloves", "medicines", "translation",
  "uniform", "uniforms", "coaches", "coach", "tablet", "tablets", "printer", "printers", "strom", "pont", "cars", "car", "bus", "buses", "gaz", "gas", "power",
]);

/** The purchase that the request's words match: the exact alias, or the longest alias that appears as whole words inside the request. */
export function matchPurchase(what: string): Purchase | null {
  const text = normaliseText(what);
  if (!text) return null;
  const padded = ` ${text} `;
  const exact = INDEX.find((x) => x.alias === text);
  if (exact) return exact.purchase;
  const inside = INDEX.find((x) => (x.alias.includes(" ") || (x.alias.length >= 5 && !GENERIC_WORDS.has(x.alias))) && padded.includes(` ${x.alias} `));
  return inside ? inside.purchase : null;
}

/** A CPV code typed by a person: "30213100", "30213100-5", "3021" (a prefix of two to eight digits). Returns the digits or null. */
export function cleanCpv(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{2,8})(?:-\d)?$/);
  return m ? m[1] : null;
}

/** The part of a CPV code that identifies its group: trailing zeros mean "and everything below". 30213100 -> "302131", 55524000 -> "55524", 3021 -> "3021". */
export function cpvStem(code: string): string {
  const stem = code.replace(/0+$/, "");
  return stem.length >= 2 ? stem : code.slice(0, 2);
}

/** True when a CPV code belongs to one of the groups (stems). */
export function cpvInGroups(code: string, stems: string[]): boolean {
  const digits = code.replace(/\D/g, "").slice(0, 8);
  return stems.some((s) => digits.startsWith(s));
}

/** The window of awards to include, ending today: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }. */
export function monthsWindow(months: number, now: Date = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return { from: d.toISOString().slice(0, 10), to };
}

/** Split a window into n equal slices of whole days, e.g. to ask a source month by month. */
export function sliceWindow(from: string, to: string, n: number): { from: string; to: string }[] {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  const step = Math.max(1, Math.ceil((b - a) / 86400000 / n));
  const out: { from: string; to: string }[] = [];
  for (let t = a; t <= b; t += (step + 1) * 86400000) {
    const end = Math.min(b, t + step * 86400000);
    out.push({ from: new Date(t).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) });
  }
  return out;
}

/** Whole days between an ISO date and now. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(iso.slice(0, 10) + "T00:00:00Z")) / 86400000));
}
