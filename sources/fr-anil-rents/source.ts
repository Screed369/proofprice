// France: observed rents from the local rent observatories (Observatoires Locaux des Loyers, ANIL network),
// national results by agglomeration on data.gouv.fr, read through the key-free Tabular API.
// Format checked live on 2026-10-20 from GitHub's servers (see fixtures/: rows-paris-2p.json, agglomerations.json, resources.json).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "fr-anil-rents",
  country: "FR (France)",
  category: "rent (observed rents, local rent observatories)",
  name: "Loyers observés dans les agglomérations (Observatoires Locaux des Loyers, réseau ANIL)",
  publisher: "Observatoires Locaux des Loyers (réseau ANIL), via data.gouv.fr",
  what_is_recorded:
    "Rents observed on real leases (collected from property managers, landlords and tenancy files, not from listings) in about 50 observed agglomerations: median, 10th and 90th percentile monthly rent per dwelling and per square metre, number of observations, by dwelling size, house or flat, building period and age of the lease.",
  price_type: "official_statistic",
  freshness: "Annual; the 2025 results were published in October 2026",
  licence: "Licence Ouverte 2.0 (Etalab)",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  attribution: "Source : Observatoires Locaux des Loyers (réseau ANIL), data.gouv.fr, Licence Ouverte 2.0",
  homepage: "https://www.data.gouv.fr/datasets/resultats-nationaux-des-observatoires-locaux-des-loyers",
  limits:
    "Only the agglomerations covered by an observatory (about 50, such as Paris, Marseille, Toulouse, Nantes, Rennes, Strasbourg, Bordeaux), not every town, and no Lyon or Lille. Percentiles are the publisher's own; the publisher leaves the 10th and 90th percentile empty when a group is small. Rents are for sitting tenants and new lets together unless you ask for new lets, so they are below the rents asked on listings for new tenants. France counts rooms including the living room: 1 bedroom = 2 rooms.",
};

const DATASET_ID = "56fd8e8788ee387079c352f7";
/** The 2025 agglomeration file, used if the dataset listing cannot be read. */
export const FALLBACK_RESOURCE_ID = "21543ae5-7d6e-4c49-8719-e7f725d441da";
export const RESOURCES_URL = `https://www.data.gouv.fr/api/2/datasets/${DATASET_ID}/resources/?page_size=30`;
const tabular = (id: string) => `https://tabular-api.data.gouv.fr/api/resources/${id}/data/`;
export const listUrl = (id: string) => `${tabular(id)}?agglomeration__groupby&agglomeration__count&agglomeration__sort=asc&page_size=200`;
export const rowsUrl = (id: string, agglomeration: string, pieces: string | null, page = 1) =>
  `${tabular(id)}?agglomeration__exact=${encodeURIComponent(agglomeration)}` +
  (pieces ? `&nombre_pieces_homogene__exact=${encodeURIComponent(pieces)}` : "") +
  `&page_size=200&page=${page}`;

export interface RentRow {
  Observatory: string;
  Data_year: number;
  agglomeration: string;
  Zone_complementaire: string | null;
  Type_habitat: string | null;
  epoque_construction_homogene: string | null;
  anciennete_locataire_homogene: string | null;
  nombre_pieces_homogene: string | null;
  loyer_1_decile: number | null;
  loyer_1_quartile: number | null;
  loyer_median: number | null;
  loyer_3_quartile: number | null;
  loyer_9_decile: number | null;
  loyer_moyen: number | null;
  loyer_mensuel_1_decile: number | null;
  loyer_mensuel_1_quartile: number | null;
  loyer_mensuel_median: number | null;
  loyer_mensuel_3_quartile: number | null;
  loyer_mensuel_9_decile: number | null;
  moyenne_loyer_mensuel: number | null;
  surface_moyenne: number | null;
  nombre_observations: number | null;
  methodologie_production: string | null;
}

export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pick the newest "Loyers YYYY dans les agglomérations" resource from the dataset listing. */
export function pickResource(json: unknown): { id: string; year: number } | null {
  const data = (json as { data?: { id?: string; title?: string }[] })?.data;
  if (!Array.isArray(data)) return null;
  let best: { id: string; year: number } | null = null;
  for (const r of data) {
    const m = /^Loyers (\d{4}) dans les agglom/i.exec(r.title ?? "");
    if (m && r.id && (!best || Number(m[1]) > best.year)) best = { id: r.id, year: Number(m[1]) };
  }
  return best;
}

/** The observed agglomerations, from the group-by answer. Entries that are only a code (e.g. "L7500") are dropped. */
export function parseAgglomerations(json: unknown): string[] {
  const data = (json as { data?: { agglomeration?: string }[] })?.data;
  if (!Array.isArray(data)) throw new SourceError("The rent observatories' data changed layout; this source needs updating.");
  const names = data.map((r) => r.agglomeration ?? "").filter((n) => n && !/^[A-Z]\d{4}$/.test(n));
  if (!names.length) throw new SourceError("The rent observatories' data returned no agglomerations just now.");
  return names;
}

const ALIASES: Record<string, string> = {
  paris: "Paris intra-muros",
  "paris intra muros": "Paris intra-muros",
  "ville de paris": "Paris intra-muros",
  "ile de france": "Agglomération parisienne",
  "region parisienne": "Agglomération parisienne",
  "grand paris": "Agglomération parisienne",
  "paris region": "Agglomération parisienne",
  "greater paris": "Agglomération parisienne",
  marseille: "Agglomérations d'Aix-Marseille et Arles",
  "aix en provence": "Agglomérations d'Aix-Marseille et Arles",
  aix: "Agglomérations d'Aix-Marseille et Arles",
  strasbourg: "Eurométropole de Strasbourg",
};

export function matchAgglomeration(names: string[], input: string | undefined): string {
  const list = names.join("; ");
  if (!input || !norm(input)) {
    throw new InputError("France: give town as one of the observed agglomerations, e.g. 'Paris', 'Toulouse', 'Nantes'. Available: " + list + ".");
  }
  const q = norm(input);
  const alias = ALIASES[q];
  if (alias && names.includes(alias)) return alias;
  const exact = names.filter((n) => norm(n) === q);
  if (exact.length === 1) return exact[0];
  const hits = names.filter((n) => ` ${norm(n)} `.includes(` ${q} `));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new InputError(`'${input}' fits several observed areas (${hits.join("; ")}). Give the exact name.`);
  throw new InputError(`'${input}' is not one of the agglomerations observed by the French rent observatories. Available: ${list}.`);
}

export interface Selection {
  pieces: string | null;
  type: string | null;
  tenure: string | null;
  roomsLabel: string;
  tenancyLabel: string;
}

export function selection(opts: { property_type?: string; bedrooms?: number; tenancy?: string }): Selection {
  const pt = opts.property_type ?? "any";
  if (pt === "room") throw new InputError("France: rents of single rooms are not published; use apartment, house or leave property_type out.");
  const tenancy = opts.tenancy ?? "all";
  if (!["all", "new", "existing"].includes(tenancy)) throw new InputError("tenancy must be 'all' (default), 'new' (leases under one year) or 'existing'.");
  const tenure = tenancy === "new" ? "1. Moins de 1 an" : tenancy === "existing" ? "2. 1 an et plus" : null;
  let pieces: string | null = null;
  let roomsLabel = "all sizes";
  if (opts.bedrooms !== undefined) {
    const rooms = opts.bedrooms + 1; // French count includes the living room
    const suffix = rooms >= 4 ? "4P+" : `${rooms}P`;
    if (pt === "house") pieces = rooms <= 3 ? "Maison 1-3P" : "Maison 4P+";
    else if (pt === "apartment") pieces = `Appart ${suffix}`;
    else pieces = `Ensemble ${suffix}`;
    const bed = opts.bedrooms === 0 ? "studio" : `${opts.bedrooms} bedroom${opts.bedrooms > 1 ? "s" : ""}`;
    roomsLabel = pt === "house" ? (rooms <= 3 ? "houses with 1 to 3 rooms" : "houses with 4 or more rooms") : `${rooms >= 4 ? "4 or more" : rooms} rooms (${bed}${rooms >= 4 ? " or more" : ""})`;
  }
  let type: string | null = null;
  if (pieces === null || tenure !== null) type = pt === "apartment" ? "Appartement" : pt === "house" ? "Maison" : null;
  const tenancyLabel = tenancy === "new" ? "new leases (under 1 year)" : tenancy === "existing" ? "existing leases (1 year or more)" : "all leases";
  return { pieces, type, tenure, roomsLabel, tenancyLabel };
}

export function chooseRow(rows: RentRow[], sel: Selection): RentRow | null {
  const hits = rows.filter(
    (r) =>
      r.Zone_complementaire == null &&
      r.epoque_construction_homogene == null &&
      (r.anciennete_locataire_homogene ?? null) === sel.tenure &&
      (r.nombre_pieces_homogene ?? null) === sel.pieces &&
      (r.Type_habitat ?? null) === sel.type &&
      typeof r.loyer_mensuel_median === "number" &&
      typeof r.nombre_observations === "number",
  );
  hits.sort((a, b) => (b.nombre_observations ?? 0) - (a.nombre_observations ?? 0));
  return hits[0] ?? null;
}

export interface FrRentInput { town?: string; property_type?: string; bedrooms?: number; tenancy?: string; baseUrl?: string }

export async function frRent(input: FrRentInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 20000));
  const sel = selection(input);
  let resourceId = FALLBACK_RESOURCE_ID;
  try {
    const r = pickResource(await get(RESOURCES_URL));
    if (r) resourceId = r.id;
  } catch {
    /* the listing is a convenience; the fallback file is still valid */
  }
  const run = async (id: string) => {
    const names = parseAgglomerations(await get(listUrl(id)));
    const area = matchAgglomeration(names, input.town);
    const rows: RentRow[] = [];
    for (let page = 1; page <= 5; page++) {
      const body = (await get(rowsUrl(id, area, sel.pieces, page))) as { data?: RentRow[]; links?: { next?: string | null } };
      if (!Array.isArray(body.data)) throw new SourceError("The rent observatories' data changed layout; this source needs updating.");
      rows.push(...body.data);
      if (!body.links?.next) break;
    }
    return { area, rows };
  };
  let res: { area: string; rows: RentRow[] };
  try {
    res = await run(resourceId);
  } catch (e) {
    if (e instanceof InputError || resourceId === FALLBACK_RESOURCE_ID) throw e;
    res = await run(FALLBACK_RESOURCE_ID);
  }
  const row = chooseRow(res.rows, sel);
  const obs = row?.nombre_observations ?? 0;
  const usable = row && obs >= 5 ? row : null;
  const year = row?.Data_year ?? res.rows[0]?.Data_year;
  const median = usable?.loyer_mensuel_median ?? null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "FR", town: res.area, property_type: input.property_type ?? "any", bedrooms: input.bedrooms ?? null, tenancy: input.tenancy ?? "all" },
    value: median,
    measure: "median",
    currency: "EUR",
    unit: "per month",
    period: year ? { from: `${year}-01-01`, to: `${year}-12-31` } : { from: null, to: null },
    reference_period: year ? String(year) : "",
    sample_size: usable ? obs : null,
    low: usable?.loyer_mensuel_1_decile ?? null,
    high: usable?.loyer_mensuel_9_decile ?? null,
    method:
      "France rents (Observatoires Locaux des Loyers, ANIL network, national results by agglomeration): the median monthly rent of leases observed in the chosen agglomeration for the chosen size, with the publisher's own 10th and 90th percentile (left empty by the publisher for small groups) and number of observations. Groups with fewer than 5 observations are not shown. Observed rents, not listing rents.",
    describe: (v) =>
      `The median monthly rent observed in ${res.area} (${sel.roomsLabel}, ${sel.tenancyLabel}) was ${fmtMoney(v, "EUR")} in ${year}, from ${obs} observed leases.`,
    note: usable?.methodologie_production && /estimation/i.test(usable.methodologie_production) && !/directe/i.test(usable.methodologie_production) ? `Publisher method: ${usable.methodologie_production}.` : undefined,
    baseUrl: input.baseUrl,
    extra: usable
      ? {
          agglomeration: res.area,
          observatory: usable.Observatory,
          selection: { rooms: sel.roomsLabel, leases: sel.tenancyLabel, dwelling: usable.nombre_pieces_homogene ?? usable.Type_habitat ?? "all dwellings" },
          median_per_m2_per_month: usable.loyer_median,
          p10_per_m2_per_month: usable.loyer_1_decile,
          p90_per_m2_per_month: usable.loyer_9_decile,
          quartiles_per_month: { q1: usable.loyer_mensuel_1_quartile, q3: usable.loyer_mensuel_3_quartile },
          mean_per_month: usable.moyenne_loyer_mensuel,
          average_surface_m2: usable.surface_moyenne,
          publisher_method: usable.methodologie_production,
          rent_kind: "observed rents on real leases (not listings)",
        }
      : { agglomeration: res.area, note: row ? "Fewer than 5 observed leases in this group; the publisher's figure is withheld here." : "The observatory publishes no figure for this combination (try another size, or leave tenancy at 'all')." },
  });
}
