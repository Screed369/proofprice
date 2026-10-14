// Real data copied from the DESNZ weekly road fuel prices publication on gov.uk, read on 2026-10-14 through the GitHub probe.
// CSV_TEXT: the first line (header, with the file's byte order mark) and the weekly rows from 1 September 2025 onwards of
//   https://assets.publishing.service.gov.uk/media/6acd0403ec9d3aba1e013c7b/CSV__2018_-__.csv (header and numbers unchanged).
// CONTENT_ATTACHMENTS: details.attachments of https://www.gov.uk/api/content/government/statistics/weekly-road-fuel-prices, keeping the keys we use.
export const CSV_TEXT = "﻿Date,ULSP (Ultra low sulphur unleaded petrol) Pump price in pence/litre,ULSD (Ultra low sulphur diesel) Pump price in pence/litre,ULSP (Ultra low sulphur unleaded petrol) Duty rate in pence/litre,ULSD (Ultra low sulphur diesel) Duty rate in pence/litre,ULSP (Ultra low sulphur unleaded petrol) VAT percentage rate,ULSD (Ultra low sulphur diesel) VAT percentage rate\n01/09/2025,133.86,141.65,52.95,52.95,20,20\n08/09/2025,133.72,141.58,52.95,52.95,20,20\n15/09/2025,133.81,141.69,52.95,52.95,20,20\n22/09/2025,134.15,142.02,52.95,52.95,20,20\n29/09/2025,134.36,142.24,52.95,52.95,20,20\n06/10/2025,134.76,142.92,52.95,52.95,20,20\n13/10/2025,134.81,142.99,52.95,52.95,20,20\n20/10/2025,134.69,142.81,52.95,52.95,20,20\n27/10/2025,134.4,142.38,52.95,52.95,20,20\n03/11/2025,134.38,142.61,52.95,52.95,20,20\n10/11/2025,134.65,143.31,52.95,52.95,20,20\n17/11/2025,135.07,143.97,52.95,52.95,20,20\n24/11/2025,136.07,145.4,52.95,52.95,20,20\n01/12/2025,136.61,146.2,52.95,52.95,20,20\n08/12/2025,136.68,146.23,52.95,52.95,20,20\n15/12/2025,136.83,146.14,52.95,52.95,20,20\n22/12/2025,136.23,145.45,52.95,52.95,20,20\n29/12/2025,135.34,144.59,52.95,52.95,20,20\n05/01/2026,134.9,144.19,52.95,52.95,20,20\n12/01/2026,133.43,142.63,52.95,52.95,20,20\n19/01/2026,132.64,141.82,52.95,52.95,20,20\n26/01/2026,132,141.26,52.95,52.95,20,20\n02/02/2026,131.62,140.82,52.95,52.95,20,20\n09/02/2026,131.46,140.72,52.95,52.95,20,20\n16/02/2026,131.6,141.46,52.95,52.95,20,20\n23/02/2026,131.71,141.46,52.95,52.95,20,20\n02/03/2026,132.14,142.15,52.95,52.95,20,20\n09/03/2026,135.67,149.01,52.95,52.95,20,20\n16/03/2026,140.28,158.78,52.95,52.95,20,20\n23/03/2026,144.16,166.88,52.95,52.95,20,20\n30/03/2026,148.78,176.52,52.95,52.95,20,20\n06/04/2026,154.65,186.75,52.95,52.95,20,20\n13/04/2026,158.17,192.14,52.95,52.95,20,20\n20/04/2026,157.62,191.24,52.95,52.95,20,20\n27/04/2026,156.99,189.81,52.95,52.95,20,20\n04/05/2026,156.82,188.79,52.95,52.95,20,20\n11/05/2026,156.81,188.14,52.95,52.95,20,20\n18/05/2026,157.39,186.56,52.95,52.95,20,20\n25/05/2026,158.78,185.07,52.95,52.95,20,20\n01/06/2026,158.74,184.11,52.95,52.95,20,20\n08/06/2026,157.95,181.79,52.95,52.95,20,20\n15/06/2026,155.54,176.71,52.95,52.95,20,20\n22/06/2026,153.26,172.47,52.95,52.95,20,20\n29/06/2026,151.02,167.12,52.95,52.95,20,20\n06/07/2026,149.8,164.77,52.95,52.95,20,20\n13/07/2026,150.53,164.52,52.95,52.95,20,20\n20/07/2026,152.29,167.08,52.95,52.95,20,20\n27/07/2026,156.13,173.97,52.95,52.95,20,20\n03/08/2026,159.89,179.19,52.95,52.95,20,20\n10/08/2026,162.15,181.97,52.95,52.95,20,20\n17/08/2026,161.8,182.45,52.95,52.95,20,20\n24/08/2026,161.63,182.82,52.95,52.95,20,20\n31/08/2026,161.61,183.49,52.95,52.95,20,20\n07/09/2026,164.4,186.36,52.95,52.95,20,20\n14/09/2026,168.14,190.72,52.95,52.95,20,20\n21/09/2026,172.01,195.53,52.95,52.95,20,20\n28/09/2026,173.46,197.58,52.95,52.95,20,20\n05/10/2026,174.88,199.52,52.95,52.95,20,20\n12/10/2026,175.28,200.04,52.95,52.95,20,20\n";

export const CONTENT_ATTACHMENTS = [
  {
    "title": "Weekly road fuel prices (Excel)",
    "url": "https://assets.publishing.service.gov.uk/media/6acd03f7b8542d3693fd437c/Weekly_Fuel_Prices_12-10-26.xlsx",
    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "filename": "Weekly_Fuel_Prices_12-10-26.xlsx",
    "file_size": 260941,
    "id": "9551803",
    "attachment_type": "file"
  },
  {
    "title": "Weekly road fuel prices (CSV) 2018 to 2026",
    "url": "https://assets.publishing.service.gov.uk/media/6acd0403ec9d3aba1e013c7b/CSV__2018_-__.csv",
    "content_type": "text/csv",
    "filename": "CSV__2018_-__.csv",
    "file_size": 20458,
    "id": "9551804",
    "attachment_type": "file"
  },
  {
    "title": "Weekly road fuel prices (CSV) 2003 to 2017",
    "url": "https://assets.publishing.service.gov.uk/media/68a3326b32d2c63f869343a3/weekly_road_fuel_prices_2003_to_2017.csv",
    "content_type": "text/csv",
    "filename": "weekly_road_fuel_prices_2003_to_2017.csv",
    "file_size": 34088,
    "id": "9551805",
    "attachment_type": "file"
  },
  {
    "title": "Weekly road fuel prices (XML)",
    "url": "https://assets.publishing.service.gov.uk/media/6acd0410f1ba855cc196ab39/XML.xml",
    "content_type": "application/xml",
    "filename": "XML.xml",
    "file_size": 539394,
    "id": "9551806",
    "attachment_type": "file"
  }
];
