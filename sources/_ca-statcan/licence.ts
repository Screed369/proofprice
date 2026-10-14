// The Statistics Canada Open Licence, quoted once for the two sources that publish under it (ca-statcan-fuel and ca-statcan-prices).
// ca-cmhc-rents does NOT use this: the CMHC rent table carries CMHC's own licence (see sources/ca-cmhc-rents/source.ts).
// Licence page checked on 2026-10-14: https://www.statcan.gc.ca/en/terms-conditions/open-licence

import { OPEN_LICENCE_URL } from "./wds";

export { OPEN_LICENCE_URL };

export const OPEN_LICENCE_TEXT =
  "Statistics Canada Open Licence. \"Subject to this licence, Statistics Canada grants you a worldwide, royalty-free, non-exclusive licence to: use, reproduce, publish, freely distribute, or sell the Information; " +
  "use, reproduce, publish, freely distribute, or sell Value-added Products; and, sublicence any or all such rights, under terms consistent with this licence.\" " +
  "Conditions include accurate reproduction, no suggestion that Statistics Canada endorses the user, and the acknowledgment of source notices below.";

/** The licence's source and adaptation notices for a table, without a reference month (used in the source block). */
export function openLicenceAttribution(tableName: string): string {
  return (
    `Source: Statistics Canada, ${tableName} (reference month stated in each answer). Reproduced and distributed on an "as is" basis with the permission of Statistics Canada. ` +
    `Adapted from Statistics Canada, ${tableName}. This does not constitute an endorsement by Statistics Canada of this product.`
  );
}

/** The same notices for one answer, with the reference month: "August 2026". */
export function openLicenceNotice(tableName: string, monthLabel: string): string {
  return (
    `Source: Statistics Canada, ${tableName}, ${monthLabel}. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada. ` +
    `Adapted from Statistics Canada, ${tableName}, ${monthLabel}. This does not constitute an endorsement by Statistics Canada of this product.`
  );
}
