// Two real releases from https://www.donneesquebec.ca/.../hebdo_20261012_20261018.json (probe qcseao-2, 2026-10-23); party blocks (buyers, suppliers, addresses) removed on purpose.
export const REAL_RELEASES = [
  {
    ocid: "ocds-ec9k95-20073052", id: "20261013194201", date: "2026-10-13T15:42:01-04:00", tag: ["contract"],
    tender: { id: "2025-30", title: "Débroussaillage des bords de chemins", status: "complete",
      items: [{ id: "S14", description: "S14 - Services publics", classification: { scheme: "UNSPSC", id: "83000000", description: "Services publics et services liés au secteur public" } }] },
    awards: [{ id: "20070068", status: "active", date: "2025-02-03T00:00:00-05:00", value: { amount: 34487.16, currency: "CAD", totalAmount: 30000 } }],
    contracts: [{ id: "20070068", awardID: "20070068", status: "active", value: { amount: 34487.16, currency: "CAD" }, dateSigned: "2025-02-03T00:00:00-05:00" }],
    language: "fr",
  },
  {
    ocid: "ocds-ec9k95-20124182", id: "20261016191733", date: "2026-10-16T15:05:53-04:00", tag: ["contractTermination"],
    tender: { id: "BON252600704", title: "Contrat pour services ", status: "complete",
      items: [{ id: "S16", description: "S16 - Services pédagogiques et formation", classification: { scheme: "UNSPSC", id: "86000000", description: "Enseignement et formation" } }] },
    awards: [{ id: "20120951", status: "active", date: "2025-10-27T00:00:00-04:00", value: { amount: 17850.0, currency: "CAD" } }],
    contracts: [{ id: "20120951", awardID: "20120951", status: "terminated", value: { amount: 87084.61, currency: "CAD" }, dateSigned: "2025-10-27T00:00:00-04:00" }],
    language: "fr",
  },
];
