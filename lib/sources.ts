// Registry of every data source: what it is, its licence, and the attribution we must show.
// Rule: every answer carries its source and licence, so agents can cite it.

export interface SourceInfo {
  id: string;
  country: string;
  category: string;
  name: string;
  publisher: string;
  what_is_recorded: string;
  price_type: "transaction" | "posted_pump_price";
  freshness: string;
  licence: string;
  licence_url: string;
  attribution: string;
  homepage: string;
  limits: string;
}

export const SOURCES: Record<string, SourceInfo> = {
  "gb-hmlr-ppd": {
    id: "gb-hmlr-ppd",
    country: "GB (England & Wales)",
    category: "home sales",
    name: "Price Paid Data",
    publisher: "HM Land Registry",
    what_is_recorded: "Residential property sales: price paid, completion date, property type, address.",
    price_type: "transaction",
    freshness: "Monthly",
    licence: "Open Government Licence v3.0",
    licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    attribution:
      "Contains HM Land Registry data © Crown copyright and database right. This data is licensed under the Open Government Licence v3.0.",
    homepage: "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
    limits:
      "We return aggregates only (median, range, count), never individual addresses. Standard-price sales only (category A).",
  },
  "sg-hdb-resale": {
    id: "sg-hdb-resale",
    country: "SG",
    category: "home sales (public housing resale)",
    name: "Resale flat prices (from Jan 2017)",
    publisher: "Housing & Development Board via data.gov.sg",
    what_is_recorded: "HDB resale transactions: month, town, flat type, floor area, lease, resale price.",
    price_type: "transaction",
    freshness: "Daily updates of registered resales",
    licence: "Singapore Open Data Licence v1.0",
    licence_url: "https://data.gov.sg/open-data-licence",
    attribution:
      "Contains information from Resale flat prices accessed from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0.",
    homepage: "https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view",
    limits: "Public housing (HDB) only; private condominium sales are a separate source (not yet included).",
  },
  "fr-fuel": {
    id: "fr-fuel",
    country: "FR",
    category: "fuel (pump prices)",
    name: "Prix des carburants en France – flux instantané v2",
    publisher: "Ministère de l'Économie via data.economie.gouv.fr",
    what_is_recorded: "Current pump price per litre at each filling station, by fuel type, with last-update time.",
    price_type: "posted_pump_price",
    freshness: "About every 10 minutes",
    licence: "Licence Ouverte / Etalab 2.0",
    licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    attribution: "Source: Ministère de l'Économie – prix des carburants (Licence Ouverte / Etalab 2.0).",
    homepage: "https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/",
    limits:
      "Pump prices are what every customer pays at that station at that moment; they are posted prices, not individual receipts.",
  },
  "fr-dvf": {
    id: "fr-dvf",
    country: "FR",
    category: "home sales",
    name: "Demandes de valeurs foncières (DVF), geo-dvf per-commune files",
    publisher: "Direction générale des Finances publiques (DGFiP), files prepared by Etalab",
    what_is_recorded: "Property sales recorded by French land registries: date, nature, price, type of property, built surface.",
    price_type: "transaction",
    freshness: "Twice a year, with a delay of several months",
    licence: "Licence Ouverte / Etalab 2.0, plus the DVF reuse conditions (no re-identification of people; raw data not to be indexed by search engines)",
    licence_url: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/",
    attribution: "Source: DGFiP, Demandes de valeurs foncières (DVF), via geo-dvf (Etalab), Licence Ouverte 2.0.",
    homepage: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres-geolocalisees/",
    limits:
      "We return aggregates only (median, range, count), never addresses or parcels. Alsace-Moselle and Mayotte are not covered by DVF.",
  },
  "es-fuel": {
    id: "es-fuel",
    country: "ES",
    category: "fuel (pump prices)",
    name: "Precios de carburantes en las estaciones de servicio terrestres",
    publisher: "Ministerio para la Transición Ecológica y el Reto Demográfico (Geoportal de hidrocarburos), via datos.gob.es",
    what_is_recorded: "Current pump price at each public filling station in Spain, by fuel type.",
    price_type: "posted_pump_price",
    freshness: "Several times a day",
    licence: "Spanish public-sector information reuse terms (Ley 37/2007, RD 1495/2011): reuse allowed with the source and update date cited. Exact licence text to be confirmed.",
    licence_url: "https://datos.gob.es/en/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas",
    attribution: "Source: Ministerio para la Transición Ecológica y el Reto Demográfico – precios de carburantes (datos.gob.es).",
    homepage: "https://geoportalgasolineras.es/",
    limits: "Posted pump prices, not individual receipts. Restricted-sale stations are excluded.",
  },
  "it-fuel": {
    id: "it-fuel",
    country: "IT",
    category: "fuel (pump prices)",
    name: "Carburanti – Prezzi praticati e anagrafica degli impianti",
    publisher: "Ministero delle Imprese e del Made in Italy (MIMIT), Osservaprezzi carburanti",
    what_is_recorded: "Pump prices in force at 08:00 each day at every station in Italy, by fuel and service type (self or attended).",
    price_type: "posted_pump_price",
    freshness: "Daily (prices at 08:00 of the extraction day)",
    licence: "Italian Open Data Licence v2.0 (IODL 2.0)",
    licence_url: "https://www.dati.gov.it/content/italian-open-data-license-v20",
    attribution: "Fonte: Ministero delle Imprese e del Made in Italy – Osservaprezzi carburanti (IODL 2.0).",
    homepage: "https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti",
    limits: "Posted pump prices, not individual receipts. Prices not updated in 30 days are left out.",
  },
};

export const METHOD_URL = "/method";
