// Universal portal adapters: one small, dependency-free helper per open-data platform.
//   ckan         data.gov.uk, data.gov.au, open.canada.ca, catalog.data.gov, data.qld.gov.au, data.gov.sg, ...
//   socrata      data.cityofchicago.org, data.cityofnewyork.us, data.sfgov.org, data.cdc.gov, ...
//   opendatasoft data.economie.gouv.fr, opendata.paris.fr, data.iledefrance.fr, ...
//   arcgis       ArcGIS hosted layers / hub sites and agency map servers
//   jsonstat     Eurostat and other JSON-stat 2.0 statistics APIs (PxWeb / PxStat offices)
// Each exports pure URL builders and parsers (unit-tested against real responses) plus thin fetch wrappers.
// See sources/_template/README.md ("Adapters") for when to use them and how.

export * from "./common";
export * from "./ckan";
export * from "./socrata";
export * from "./opendatasoft";
export * from "./arcgis";
export * from "./jsonstat";
