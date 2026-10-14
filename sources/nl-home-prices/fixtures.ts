// Real responses from the CBS OData API (opendata.cbs.nl, table 83625NED), captured 2026-10-14 through the GitHub probe.
// Whitespace only has been reflowed; every key and value is as returned. The region keys keep their CBS padding ("NL01  ").

/** RegioS?$filter=startswith(Title,'Utrecht')  (a province, the municipality and a different municipality share the name) */
export const REGIONS_UTRECHT = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/83625NED/$metadata#Cbs.OData.WebAPI.RegioS&$select=Key,Title,Description",
  "value": [
    {
      "Key": "PV26  ",
      "Title": "Utrecht (PV)",
      "Description": "PV = Provincie\r\n\r\nBestuurlijke onderverdeling van het Nederlands grondgebied. Sinds het instellen van de provincie Flevoland per 1 januari 1986 telt Nederland 12 provincies."
    },
    {
      "Key": "GM0344",
      "Title": "Utrecht (gemeente)",
      "Description": "Gemeentelijke herindeling per 01-01-2001\r\nBegindatum voor 1830"
    },
    {
      "Key": "GM1581",
      "Title": "Utrechtse Heuvelrug",
      "Description": "Ontstaan per 01-01-2006"
    }
  ]
} as const;

/** RegioS?$filter=substringof('Gravenhage',Title) */
export const REGIONS_GRAVENHAGE = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/83625NED/$metadata#Cbs.OData.WebAPI.RegioS&$select=Key,Title,Description",
  "value": [
    {
      "Key": "GM0518",
      "Title": "'s-Gravenhage (gemeente)",
      "Description": "Begindatum voor 1830"
    }
  ]
} as const;

/** RegioS?$filter=startswith(Title,'Groningen') or ... Haarlem, Rotterdam */
export const REGIONS_MIXED = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/83625NED/$metadata#Cbs.OData.WebAPI.RegioS&$select=Key,Title",
  "value": [
    {
      "Key": "PV20  ",
      "Title": "Groningen (PV)"
    },
    {
      "Key": "GM0014",
      "Title": "Groningen (gemeente)"
    },
    {
      "Key": "GM0392",
      "Title": "Haarlem"
    },
    {
      "Key": "GM0393",
      "Title": "Haarlemmerliede en Spaarnwoude"
    },
    {
      "Key": "GM0394",
      "Title": "Haarlemmermeer"
    },
    {
      "Key": "GM0599",
      "Title": "Rotterdam"
    }
  ]
} as const;

/** TypedDataSet?$filter=(RegioS eq 'GM0363' or RegioS eq 'NL01  ') and Perioden ge '2020JJ00'  (Amsterdam and the Netherlands) */
export const DATA_AMSTERDAM_NATIONAL = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/83625NED/$metadata#Cbs.OData.WebAPI.TypedDataSet",
  "value": [
    {
      "ID": 25,
      "RegioS": "NL01  ",
      "Perioden": "2020JJ00",
      "GemiddeldeVerkoopprijs_1": 334488
    },
    {
      "ID": 26,
      "RegioS": "NL01  ",
      "Perioden": "2021JJ00",
      "GemiddeldeVerkoopprijs_1": 386714
    },
    {
      "ID": 27,
      "RegioS": "NL01  ",
      "Perioden": "2022JJ00",
      "GemiddeldeVerkoopprijs_1": 428591
    },
    {
      "ID": 28,
      "RegioS": "NL01  ",
      "Perioden": "2023JJ00",
      "GemiddeldeVerkoopprijs_1": 416153
    },
    {
      "ID": 29,
      "RegioS": "NL01  ",
      "Perioden": "2024JJ00",
      "GemiddeldeVerkoopprijs_1": 450985
    },
    {
      "ID": 30,
      "RegioS": "NL01  ",
      "Perioden": "2025JJ00",
      "GemiddeldeVerkoopprijs_1": 479527
    },
    {
      "ID": 1358,
      "RegioS": "GM0363",
      "Perioden": "2020JJ00",
      "GemiddeldeVerkoopprijs_1": 510919
    },
    {
      "ID": 1359,
      "RegioS": "GM0363",
      "Perioden": "2021JJ00",
      "GemiddeldeVerkoopprijs_1": 569890
    },
    {
      "ID": 1360,
      "RegioS": "GM0363",
      "Perioden": "2022JJ00",
      "GemiddeldeVerkoopprijs_1": 620954
    },
    {
      "ID": 1361,
      "RegioS": "GM0363",
      "Perioden": "2023JJ00",
      "GemiddeldeVerkoopprijs_1": 568161
    },
    {
      "ID": 1362,
      "RegioS": "GM0363",
      "Perioden": "2024JJ00",
      "GemiddeldeVerkoopprijs_1": 617647
    },
    {
      "ID": 1363,
      "RegioS": "GM0363",
      "Perioden": "2025JJ00",
      "GemiddeldeVerkoopprijs_1": 630621
    }
  ]
} as const;

/** TypedDataSet?$filter=RegioS eq 'GM0518' and Perioden ge '2023JJ00'  ('s-Gravenhage) */
export const DATA_GRAVENHAGE = {
  "odata.metadata": "https://opendata.cbs.nl/ODataApi/OData/83625NED/$metadata#Cbs.OData.WebAPI.TypedDataSet",
  "value": [
    {
      "ID": 7468,
      "RegioS": "GM0518",
      "Perioden": "2023JJ00",
      "GemiddeldeVerkoopprijs_1": 413689
    },
    {
      "ID": 7469,
      "RegioS": "GM0518",
      "Perioden": "2024JJ00",
      "GemiddeldeVerkoopprijs_1": 447417
    },
    {
      "ID": 7470,
      "RegioS": "GM0518",
      "Perioden": "2025JJ00",
      "GemiddeldeVerkoopprijs_1": 465418
    }
  ]
} as const;
