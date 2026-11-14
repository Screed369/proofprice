# Licence clearance for the pay-first door, batch of 14 Nov 2026

Scope: the sources behind the most-asked questions (fuel IT, FR, ES, IE, US, GB, DE; home sales GB, IE, FR, SG, TW, US and others with real sale
records; rent IE, GB, CA, DE, FR, US, AU, NZ, SG). Source ids come from `findSource` in `lib/registry.ts`.

Method: the licence text and URL in each source's `INFO` were read, then the official licence page was opened on 2026-11-14 and the commercial-reuse
clause quoted. A source is YES only when that clause clearly allows commercial reuse. Share-alike licences and sources with no stated licence are never
cleared. If a licence page could not be opened (blocked, robots, error, permission not granted), the verdict is UNCLEAR, not a guess.

"Basis" column: **page** = the licence page was opened and the clause quoted; the dataset's own record was not re-opened, so the statement that the
dataset is published under that licence is taken from the source's `INFO` (read earlier by the Licence Checker). The lead should confirm those
against the Notion Source Pipeline rows.

## Cleared (YES): added to `CLEARED_FOR_PAID`

| Source id | Publisher | Licence | Quoted clause (checked 2026-11-14) | URL | Restrictions |
|---|---|---|---|---|---|
| it-fuel | MIMIT Osservaprezzi carburanti | IODL 2.0 | "anche qualora la finalità ... sia di tipo commerciale" (s.3) | https://www.dati.gov.it/content/italian-open-data-license-v20 | Name source and licensor; do not imply official status or endorsement. |
| fr-fuel | Ministère de l'Économie | Licence Ouverte / Etalab 2.0 | "à des fins commerciales ou non" | https://www.data.gouv.fr/pages/legal/licences/etalab-2-0 | Credit source and last-update date. |
| fr-dvf | DGFiP / Etalab | Licence Ouverte 2.0 | Dataset page shows "Licence Ouverte / Open Licence version 2.0"; clause as for fr-fuel | https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/ | Must not allow re-identification of people or indexing by search engines. Aggregates only. |
| fr-anil-rents | ANIL local rent observatories | Licence Ouverte 2.0 | "à des fins commerciales ou non" | https://www.data.gouv.fr/pages/legal/licences/etalab-2-0 | Credit source. Basis: page. |
| eu-oil-bulletin | European Commission DG Energy | CC BY 4.0 | "licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence" | https://commission.europa.eu/legal-notice_en | Credit and mark changes. Notice says "unless otherwise indicated". Answers IE and DE (and other EU) fuel. |
| us-eia-fuel | US EIA | Public domain | "You may use and/or distribute any of our data" | https://www.eia.gov/about/copyrights_reuse.php | Acknowledge with publication date; EIA logo not used. |
| gb-desnz-fuel | DESNZ | OGL v3.0 | "exploit the Information commercially and non-commercially" | https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ | OGL excludes personal data and third-party rights. |
| gb-hmlr-ppd | HM Land Registry | OGL v3.0 | same OGL clause | same | Aggregates only (the register holds addresses). |
| gb-ukhpi | HMLR, RoS, LPS NI, ONS | OGL v3.0 | same OGL clause | same | As above. |
| gb-ons-rents | ONS | OGL v3.0 | same OGL clause | same | |
| ie-ppr | PSRA | CC BY 4.0 (data.gov.ie record "PSRA - Dublin Residential Property Price Register"); PSRA re-use terms | CC deed: "for any purpose, even commercially" (https://creativecommons.org/licenses/by/4.0/). PSRA terms: "free of charge in any format" | https://www.propertypriceregister.ie/website/npsra/ppr-copyright-en.html | PSRA terms forbid use "for the principal purpose of advertising or promoting a particular product or service". A price look-up is not that, but never use the register to promote a product. The PSRA page itself does not mention commercial use; the clearance rests on the CC BY 4.0 catalogue record (the record title says Dublin; the national file is the same register). Lead to confirm. |
| sg-hdb-resale | HDB via data.gov.sg | Singapore Open Data Licence v1.0 | "whether commercially or non-commercially" | https://data.gov.sg/open-data-licence | Visible attribution notice; do not imply endorsement. |
| sg-hdb-rents | HDB via data.gov.sg | Singapore Open Data Licence v1.0 | same | same | same |
| tw-home-sales | Ministry of the Interior, Taiwan | Open Government Data License v1.0 | "for any purpose, including but not limited to making all kinds of Derivative Works" (cl. 2.1) | https://data.gov.tw/license | Attribution (cl. 3.2). Read by curl (the fetch tool is robots-blocked there). |
| us-allegheny-home-sales | Allegheny County via WPRDC | CC0 1.0 | "copy, modify, distribute and perform the work, even for commercial purposes" | https://creativecommons.org/publicdomain/zero/1.0/ | Basis: page. |
| us-dc-home-sales | DC OCFO | CC BY 4.0 | "for any purpose, even commercially" | https://creativecommons.org/licenses/by/4.0/ | Credit. Basis: page. |
| au-sa-metro-home-sales | SA Govt (DHUD) | CC BY 4.0 | same | same | Credit. Basis: page. |
| au-adelaide-sa-rents | SA Housing Authority | CC BY 4.0 | same | same | Basis: page. |
| au-justice-tas-rents | Tasmanian Dept of Justice | CC BY 4.0 | same | same | Basis: page. |
| au-qld-rents | Queensland RTA | CC BY 4.0 | same | same | Basis: page. |

## Not cleared

| Source id | Verdict | Why |
|---|---|---|
| es-fuel | UNCLEAR | The ministry page named in INFO (sede.serviciosmin.gob.es aviso legal) belongs to the Industry ministry and never says "comerciales". datos.gob.es's general notice does allow "fines comerciales y no comerciales" but does not mention the Ministerio para la Transición Ecológica's dataset. The ministry also requires that content "no sea alterado"; our medians are derived. Needs the MITECO dataset's own licence line. |
| es-appraised-homes | UNCLEAR | Ministry licence pages refused automated reading (INFO note). Not opened. |
| ie-rtb-rents | UNCLEAR | CSO copyright page could not be opened today (fetch permission not granted). INFO says CC BY 4.0, which would be YES once confirmed. |
| au-home-sales | UNCLEAR | ABS copyright page could not be opened today. INFO quotes CC BY 4.0. |
| nz-hud-home-sales | UNCLEAR | HUD copyright page could not be opened today. INFO says CC BY 4.0. |
| ca-bc-ptt | UNCLEAR | BC OGL page could not be opened today. INFO quotes "including for commercial purposes". |
| hk-landreg-sales, hk-ha-tps-sales | UNCLEAR | data.gov.hk terms could not be opened today. INFO says commercial reuse allowed. |
| de-zensus-rents | UNCLEAR | Destatis copyright page could not be opened today. INFO quotes commercial reuse allowed. |
| de-nrw-irw | UNCLEAR | govdata.de dl-de/zero page could not be opened today. INFO says free for any purpose. |
| us-census-acs-rent | UNCLEAR | Census open-data page could not be opened today; INFO says licence wording was never read. US federal statistics are normally public domain, so likely YES once read. |
| nz-mbie-rents | UNCLEAR | CC BY 3.0 NZ deed and MBIE page not opened. |
| au-nsw-rents | UNCLEAR | Dataset states only "Creative Commons Attribution", version not stated; record not opened. |
| us-home-sales | UNCLEAR | Three publishers; Cook County states no licence and commercial reuse is unconfirmed, so the source as a whole is not cleared. |
| us-detroit-home-sales | NO | No licence on the dataset record. |
| us-az-maricopa-home-sales | NO | No reuse licence stated. |

Not covered in this batch: groceries, contracts, medicines, energy (next most-asked), and the smaller home-sales sources (CH, CO, QA, PL, LV, BR, CZ and others).
