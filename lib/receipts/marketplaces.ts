// Marketplaces whose order/sale emails we accept as receipt evidence, keyed by the DKIM signing domain.
// A receipt only counts if the email's seal (DKIM signature) is valid AND was made by one of these domains.
// This list is a starting point for the feasibility test; each entry must be confirmed with real emails.

export interface Marketplace {
  name: string;
  domains: string[]; // registrable domains; subdomains are accepted
  kind: "marketplace" | "retailer" | "buyback";
}

export const MARKETPLACES: Marketplace[] = [
  { name: "eBay", domains: ["ebay.com", "ebay.co.uk", "ebay.ie", "ebay.de", "ebay.fr", "ebay.es", "ebay.it", "ebay.com.au", "ebay.ca"], kind: "marketplace" },
  { name: "Back Market", domains: ["backmarket.com", "backmarket.co.uk", "backmarket.fr", "backmarket.es", "backmarket.de", "backmarket.it", "backmarket.ie"], kind: "marketplace" },
  { name: "Amazon", domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.es", "amazon.it", "amazon.ca", "amazon.com.au"], kind: "retailer" },
  { name: "Vinted", domains: ["vinted.com", "vinted.co.uk", "vinted.fr", "vinted.es", "vinted.de", "vinted.it", "vinted.ie"], kind: "marketplace" },
  { name: "Wallapop", domains: ["wallapop.com"], kind: "marketplace" },
  { name: "Swappa", domains: ["swappa.com"], kind: "marketplace" },
  { name: "Mercari", domains: ["mercari.com"], kind: "marketplace" },
  { name: "musicMagpie", domains: ["musicmagpie.co.uk", "musicmagpie.com"], kind: "buyback" },
  { name: "CeX", domains: ["webuy.com"], kind: "buyback" },
  { name: "Decluttr", domains: ["decluttr.com"], kind: "buyback" },
  { name: "Gazelle", domains: ["gazelle.com"], kind: "buyback" },
  { name: "Apple (Trade In / Refurbished)", domains: ["apple.com", "email.apple.com"], kind: "retailer" },
  { name: "Samsung", domains: ["samsung.com"], kind: "retailer" },
  { name: "Refurbed", domains: ["refurbed.com", "refurbed.de", "refurbed.ie", "refurbed.fr"], kind: "marketplace" },
  { name: "Facebook Marketplace (Meta)", domains: ["facebookmail.com"], kind: "marketplace" },
];

export function matchMarketplace(domain: string | undefined | null): Marketplace | null {
  if (!domain) return null;
  const d = domain.toLowerCase().replace(/\.$/, "");
  for (const m of MARKETPLACES) {
    for (const md of m.domains) {
      if (d === md || d.endsWith("." + md)) return m;
    }
  }
  return null;
}

// Organisational-domain check used for alignment between the seal's domain and the From address.
export function sameOrgDomain(a: string, b: string): boolean {
  const base = (x: string) => x.toLowerCase().split(".").slice(-2).join(".");
  const multi = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/;
  const org = (x: string) => (multi.test(x.toLowerCase()) ? x.toLowerCase().split(".").slice(-3).join(".") : base(x));
  return org(a) === org(b);
}
