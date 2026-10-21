// Turn whatever an agent sends ("UK", "Spain", "es") into an ISO 3166-1 alpha-2 code.
// Any two-letter code is accepted as-is; names below are the common ones agents use.

const NAMES: Record<string, string> = {
  "UK": "GB", "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "BRITAIN": "GB", "ENGLAND": "GB", "WALES": "GB",
  "ENGLAND AND WALES": "GB", "ENGLAND & WALES": "GB",
  "IRELAND": "IE", "REPUBLIC OF IRELAND": "IE", "EIRE": "IE",
  "FRANCE": "FR", "SPAIN": "ES", "ESPANA": "ES", "ITALY": "IT", "ITALIA": "IT", "GERMANY": "DE", "DEUTSCHLAND": "DE",
  "PORTUGAL": "PT", "NETHERLANDS": "NL", "HOLLAND": "NL", "BELGIUM": "BE", "LUXEMBOURG": "LU", "AUSTRIA": "AT",
  "SWITZERLAND": "CH", "DENMARK": "DK", "NORWAY": "NO", "SWEDEN": "SE", "FINLAND": "FI", "ICELAND": "IS",
  "POLAND": "PL", "CZECHIA": "CZ", "CZECH REPUBLIC": "CZ", "SLOVAKIA": "SK", "HUNGARY": "HU", "SLOVENIA": "SI",
  "CROATIA": "HR", "GREECE": "GR", "CYPRUS": "CY", "MALTA": "MT", "ROMANIA": "RO", "BULGARIA": "BG",
  "ESTONIA": "EE", "LATVIA": "LV", "LITHUANIA": "LT", "TURKEY": "TR", "TURKIYE": "TR",
  "UNITED STATES": "US", "USA": "US", "UNITED STATES OF AMERICA": "US", "AMERICA": "US", "CANADA": "CA", "MEXICO": "MX",
  "BRAZIL": "BR", "ARGENTINA": "AR", "CHILE": "CL", "COLOMBIA": "CO", "PERU": "PE",
  "AUSTRALIA": "AU", "NEW ZEALAND": "NZ", "JAPAN": "JP", "SOUTH KOREA": "KR", "KOREA": "KR", "TAIWAN": "TW",
  "HONG KONG": "HK", "SINGAPORE": "SG", "MALAYSIA": "MY", "THAILAND": "TH", "INDONESIA": "ID", "PHILIPPINES": "PH",
  "VIETNAM": "VN", "INDIA": "IN", "CHINA": "CN", "UNITED ARAB EMIRATES": "AE", "UAE": "AE", "DUBAI": "AE",
  "EURO AREA": "EA", "EUROZONE": "EA", "EURO ZONE": "EA", "EUROAREA": "EA",
  "SAUDI ARABIA": "SA", "ISRAEL": "IL", "SOUTH AFRICA": "ZA", "NIGERIA": "NG", "KENYA": "KE", "EGYPT": "EG",
};

export function normaliseCountry(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!s) return null;
  if (NAMES[s]) return NAMES[s];
  if (/^[A-Z]{2}$/.test(s)) return s;
  return null;
}
