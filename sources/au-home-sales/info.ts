// Source facts for au-home-sales. Kept in its own file so the router (source.ts) and the module (abs.ts) can both import it.

import type { SourceInfo } from "../../lib/plugin";

export const ABS_COPYRIGHT_URL = "https://www.abs.gov.au/website-privacy-copyright-and-disclaimer#copyright-and-creative-commons";
export const ABS_API_GUIDE_URL = "https://www.abs.gov.au/about/data-services/application-programming-interfaces-apis/data-api-user-guide";
export const ABS_HOMEPAGE =
  "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/residential-property-price-indexes-eight-capital-cities/latest-release";
export const NSW_PSI_URL = "https://valuation.property.nsw.gov.au/embed/propertySalesInformation";

export const INFO: SourceInfo = {
  id: "au-home-sales",
  country: "AU (Australia)",
  category: "home sales (official mean price of residential dwellings, by state and territory)",
  name: "Residential Dwellings: Values, Mean Price and Number by State and Territories (ABS Data API, dataflow RES_DWELL_ST)",
  publisher: "Australian Bureau of Statistics (ABS)",
  what_is_recorded:
    "For Australia and each state and territory, each quarter: the mean price of residential dwellings (the ABS estimate of the total value of the residential dwelling stock divided by the number of residential dwellings) " +
    "and the number of residential dwellings, as published by the ABS in its Residential Property Price Indexes release (catalogue 6416.0). One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness:
    "Quarterly, about three months after the quarter ends. The newest quarter is marked preliminary by the ABS and is revised the next quarter; every answer states its quarter and whether it is preliminary",
  licence:
    'Australian Bureau of Statistics: "All material presented on this website is provided under a Creative Commons Attribution 4.0 International licence, with the exception of: the Commonwealth Coat of Arms, the ABS logo, material protected by a trade mark, unit record data (microdata), content supplied by third parties" (and ABS sub-brands). ' +
    'The ABS Data API user guide states: "The Data API is freely accessible without the need for an API key."',
  licence_url: ABS_COPYRIGHT_URL,
  attribution:
    "Source: Australian Bureau of Statistics, Residential Property Price Indexes: Eight Capital Cities (cat. no. 6416.0), dataflow RES_DWELL_ST, " +
    "retrieved from the ABS Data API (data.api.abs.gov.au). Licensed under Creative Commons Attribution 4.0 International. " +
    "Figures are passed on as published; the changes between quarters are own calculations by ProofPrice.",
  homepage: ABS_HOMEPAGE,
  limits:
    "State, territory and national averages only: the ABS does not publish a mean price for a suburb, postcode or city, so a city or postcode is answered with the state or territory it lies in, and the answer says so. " +
    "The mean price is an estimate for the whole stock of residential dwellings (houses and attached dwellings together), not the average price of the homes sold in the quarter, not a median and not a valuation of one home. " +
    "The newest quarter is preliminary and is revised; ProofPrice states which. There is no sample size: the ABS does not publish the number of sales behind the figure. " +
    "The ABS describes its Data API as a beta release: availability is not guaranteed and its data may lag the ABS website. " +
    `Suburb and postcode sale prices for New South Wales are published by the NSW Valuer General as bulk files under the Creative Commons BY-NC-ND 4.0 licence (${NSW_PSI_URL}); that licence does not allow commercial use or adapted material, so ProofPrice does not use them.`,
};
