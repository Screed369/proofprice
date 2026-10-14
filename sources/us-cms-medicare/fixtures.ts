// Real responses from the data.cms.gov data API, captured 2026-10-14 through the GitHub Probe workflow. Every value is a string, as CMS sends them.

// Physician file, code 99213 in Texas (facility row first, office row second)
// https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data?filter%5BRndrng_Prvdr_Geo_Lvl%5D=State&filter%5BRndrng_Prvdr_Geo_Desc%5D=Texas&filter%5BHCPCS_Cd%5D=99213
export const PHYS_TX_99213: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "State", "Rndrng_Prvdr_Geo_Cd": "48", "Rndrng_Prvdr_Geo_Desc": "Texas", "HCPCS_Cd": "99213", "HCPCS_Desc": "Established patient office or other outpatient visit with low level od decision making, if using time, 20 minutes or more", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "F", "Tot_Rndrng_Prvdrs": "6932", "Tot_Benes": "121289", "Tot_Srvcs": "237389", "Tot_Bene_Day_Srvcs": "237361", "Avg_Sbmtd_Chrg": "178.19305789", "Avg_Mdcr_Alowd_Amt": "60.407738943", "Avg_Mdcr_Pymt_Amt": "43.615550004", "Avg_Mdcr_Stdzd_Amt": "43.984135659"},
  {"Rndrng_Prvdr_Geo_Lvl": "State", "Rndrng_Prvdr_Geo_Cd": "48", "Rndrng_Prvdr_Geo_Desc": "Texas", "HCPCS_Cd": "99213", "HCPCS_Desc": "Established patient office or other outpatient visit with low level od decision making, if using time, 20 minutes or more", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "O", "Tot_Rndrng_Prvdrs": "43385", "Tot_Benes": "1284409", "Tot_Srvcs": "4080342", "Tot_Bene_Day_Srvcs": "4079908", "Avg_Sbmtd_Chrg": "185.41948879", "Avg_Mdcr_Alowd_Amt": "83.754834965", "Avg_Mdcr_Pymt_Amt": "57.851644859", "Avg_Mdcr_Stdzd_Amt": "59.570995466"},
];

// Physician file, code 99213, national
// https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data?filter%5BHCPCS_Cd%5D=99213&filter%5BRndrng_Prvdr_Geo_Lvl%5D=National
export const PHYS_NATIONAL_99213: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "HCPCS_Cd": "99213", "HCPCS_Desc": "Established patient office or other outpatient visit with low level od decision making, if using time, 20 minutes or more", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "F", "Tot_Rndrng_Prvdrs": "130657", "Tot_Benes": "2400336", "Tot_Srvcs": "4505351", "Tot_Bene_Day_Srvcs": "4504555", "Avg_Sbmtd_Chrg": "175.75403586", "Avg_Mdcr_Alowd_Amt": "61.145347854", "Avg_Mdcr_Pymt_Amt": "43.956284565", "Avg_Mdcr_Stdzd_Amt": "43.955421447"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "HCPCS_Cd": "99213", "HCPCS_Desc": "Established patient office or other outpatient visit with low level od decision making, if using time, 20 minutes or more", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "O", "Tot_Rndrng_Prvdrs": "631995", "Tot_Benes": "18637816", "Tot_Srvcs": "64778139.1", "Tot_Bene_Day_Srvcs": "64771695", "Avg_Sbmtd_Chrg": "189.25214309", "Avg_Mdcr_Alowd_Amt": "85.366781205", "Avg_Mdcr_Pymt_Amt": "59.323602263", "Avg_Mdcr_Stdzd_Amt": "59.380842596"},
];

// Physician file, code 27447 (the surgeon fee for a total knee replacement) in Texas
// https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data?filter%5BHCPCS_Cd%5D=27447&filter%5BRndrng_Prvdr_Geo_Desc%5D=Texas
export const PHYS_TX_27447: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "State", "Rndrng_Prvdr_Geo_Cd": "48", "Rndrng_Prvdr_Geo_Desc": "Texas", "HCPCS_Cd": "27447", "HCPCS_Desc": "Replacement of knee joint, both sides of knee", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "F", "Tot_Rndrng_Prvdrs": "1318", "Tot_Benes": "20705", "Tot_Srvcs": "35139", "Tot_Bene_Day_Srvcs": "35123", "Avg_Sbmtd_Chrg": "7307.3496759", "Avg_Mdcr_Alowd_Amt": "1260.3757466", "Avg_Mdcr_Pymt_Amt": "1001.1078884", "Avg_Mdcr_Stdzd_Amt": "1044.1689556"},
  {"Rndrng_Prvdr_Geo_Lvl": "State", "Rndrng_Prvdr_Geo_Cd": "48", "Rndrng_Prvdr_Geo_Desc": "Texas", "HCPCS_Cd": "27447", "HCPCS_Desc": "Replacement of knee joint, both sides of knee", "HCPCS_Drug_Ind": "N", "Place_Of_Srvc": "O", "Tot_Rndrng_Prvdrs": "76", "Tot_Benes": "294", "Tot_Srvcs": "399", "Tot_Bene_Day_Srvcs": "399", "Avg_Sbmtd_Chrg": "3896.4280201", "Avg_Mdcr_Alowd_Amt": "770.06240602", "Avg_Mdcr_Pymt_Amt": "609.73315789", "Avg_Mdcr_Stdzd_Amt": "640.71030075"},
];

// Inpatient file, MS-DRG 470 in Texas
// https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?filter%5BDRG_Cd%5D=470&filter%5BRndrng_Prvdr_Geo_Desc%5D=Texas
export const INP_TX_470: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "State", "Rndrng_Prvdr_Geo_Cd": "48", "Rndrng_Prvdr_Geo_Desc": "Texas", "DRG_Cd": "470", "DRG_Desc": "MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC", "Tot_Dschrgs": "4151", "Avg_Submtd_Cvrd_Chrg": "116220.34546", "Avg_Tot_Pymt_Amt": "15157.440135", "Avg_Mdcr_Pymt_Amt": "11957.88822"},
];

// Inpatient file, MS-DRG 470, national
// https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?filter%5BDRG_Cd%5D=470&filter%5BRndrng_Prvdr_Geo_Lvl%5D=National
export const INP_NATIONAL_470: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "470", "DRG_Desc": "MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC", "Tot_Dschrgs": "64419", "Avg_Submtd_Cvrd_Chrg": "93183.814589", "Avg_Tot_Pymt_Amt": "17364.016424", "Avg_Mdcr_Pymt_Amt": "14321.653208"},
];

// Inpatient file, national rows whose DRG title contains "pneumonia"
// https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?filter%5Bd%5D%5Bcondition%5D%5Bpath%5D=DRG_Desc&filter%5Bd%5D%5Bcondition%5D%5Boperator%5D=CONTAINS&filter%5Bd%5D%5Bcondition%5D%5Bvalue%5D=pneumonia&filter%5BRndrng_Prvdr_Geo_Lvl%5D=National&size=100
export const INP_PNEUMONIA_TITLES: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "193", "DRG_Desc": "SIMPLE PNEUMONIA AND PLEURISY WITH MCC", "Tot_Dschrgs": "139034", "Avg_Submtd_Cvrd_Chrg": "59757.332171", "Avg_Tot_Pymt_Amt": "12049.620107", "Avg_Mdcr_Pymt_Amt": "9899.1545305"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "194", "DRG_Desc": "SIMPLE PNEUMONIA AND PLEURISY WITH CC", "Tot_Dschrgs": "48668", "Avg_Submtd_Cvrd_Chrg": "38378.594148", "Avg_Tot_Pymt_Amt": "8027.974213", "Avg_Mdcr_Pymt_Amt": "5976.0187803"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "195", "DRG_Desc": "SIMPLE PNEUMONIA AND PLEURISY WITHOUT CC/MCC", "Tot_Dschrgs": "8023", "Avg_Submtd_Cvrd_Chrg": "30173.392497", "Avg_Tot_Pymt_Amt": "6243.9128755", "Avg_Mdcr_Pymt_Amt": "4311.7028543"},
];

// Inpatient file, national rows whose DRG title contains "knee"
// https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?filter%5Bd%5D%5Bcondition%5D%5Bpath%5D=DRG_Desc&filter%5Bd%5D%5Bcondition%5D%5Boperator%5D=CONTAINS&filter%5Bd%5D%5Bcondition%5D%5Bvalue%5D=knee&filter%5BRndrng_Prvdr_Geo_Lvl%5D=National&size=100
export const INP_KNEE_TITLES: Record<string, string>[] = [
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "466", "DRG_Desc": "REVISION OF HIP OR KNEE REPLACEMENT WITH MCC", "Tot_Dschrgs": "4635", "Avg_Submtd_Cvrd_Chrg": "240991.99051", "Avg_Tot_Pymt_Amt": "49983.633657", "Avg_Mdcr_Pymt_Amt": "44693.032147"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "467", "DRG_Desc": "REVISION OF HIP OR KNEE REPLACEMENT WITH CC", "Tot_Dschrgs": "19510", "Avg_Submtd_Cvrd_Chrg": "157758.02624", "Avg_Tot_Pymt_Amt": "30483.290723", "Avg_Mdcr_Pymt_Amt": "26142.469964"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "468", "DRG_Desc": "REVISION OF HIP OR KNEE REPLACEMENT WITHOUT CC/MCC", "Tot_Dschrgs": "14300", "Avg_Submtd_Cvrd_Chrg": "123872.84706", "Avg_Tot_Pymt_Amt": "23777.612308", "Avg_Mdcr_Pymt_Amt": "19706.083566"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "469", "DRG_Desc": "MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITH MCC OR TOTA", "Tot_Dschrgs": "5530", "Avg_Submtd_Cvrd_Chrg": "149677.47559", "Avg_Tot_Pymt_Amt": "29663.081193", "Avg_Mdcr_Pymt_Amt": "25757.414286"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "470", "DRG_Desc": "MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC", "Tot_Dschrgs": "64419", "Avg_Submtd_Cvrd_Chrg": "93183.814589", "Avg_Tot_Pymt_Amt": "17364.016424", "Avg_Mdcr_Pymt_Amt": "14321.653208"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "485", "DRG_Desc": "KNEE PROCEDURES WITH PRINCIPAL DIAGNOSIS OF INFECTION WITH MCC", "Tot_Dschrgs": "1424", "Avg_Submtd_Cvrd_Chrg": "152104.93539", "Avg_Tot_Pymt_Amt": "30763.283708", "Avg_Mdcr_Pymt_Amt": "25956.000702"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "486", "DRG_Desc": "KNEE PROCEDURES WITH PRINCIPAL DIAGNOSIS OF INFECTION WITH CC", "Tot_Dschrgs": "2921", "Avg_Submtd_Cvrd_Chrg": "99485.771311", "Avg_Tot_Pymt_Amt": "19620.238275", "Avg_Mdcr_Pymt_Amt": "15476.773708"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "487", "DRG_Desc": "KNEE PROCEDURES WITH PRINCIPAL DIAGNOSIS OF INFECTION WITHOUT CC/MCC", "Tot_Dschrgs": "703", "Avg_Submtd_Cvrd_Chrg": "75117.142248", "Avg_Tot_Pymt_Amt": "14778.395448", "Avg_Mdcr_Pymt_Amt": "11588.981508"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "488", "DRG_Desc": "KNEE PROCEDURES WITHOUT PRINCIPAL DIAGNOSIS OF INFECTION WITH CC/MCC", "Tot_Dschrgs": "2320", "Avg_Submtd_Cvrd_Chrg": "96295.044397", "Avg_Tot_Pymt_Amt": "18870.330172", "Avg_Mdcr_Pymt_Amt": "15257.164655"},
  {"Rndrng_Prvdr_Geo_Lvl": "National", "Rndrng_Prvdr_Geo_Cd": "", "Rndrng_Prvdr_Geo_Desc": "National", "DRG_Cd": "489", "DRG_Desc": "KNEE PROCEDURES WITHOUT PRINCIPAL DIAGNOSIS OF INFECTION WITHOUT CC/MCC", "Tot_Dschrgs": "2474", "Avg_Submtd_Cvrd_Chrg": "61089.111156", "Avg_Tot_Pymt_Amt": "11271.35772", "Avg_Mdcr_Pymt_Amt": "8603.5076799"},
];

// dataset-resources of the physician file (names the data year)
// https://data.cms.gov/data-api/v1/dataset-resources/6fea9d79-0129-4e4c-b1b8-23cd86a4f435
export const RESOURCES_PHYSICIAN = {"meta": {"success": true}, "data": [{"name": "Medicare Physician & Other Practitioners - by Geography and Service 2024", "fileSize": 42078094, "downloadURL": "https://data.cms.gov/sites/default/files/2026-05/e534c74b-79b8-4892-8a95-5a17e2dfec9f/MUP_PHY_R26_P05_V10_D24_Geo.csv"}, {"name": "Medicare Physician & Other Practitioners - by Geography and Service Data Dictionary", "fileSize": 123169, "downloadURL": "https://data.cms.gov/sites/default/files/2021-10/7008e69d-eaec-4460-8a15-8a733dd32477/MUP_PHY_RY21_20211021_DD_Geo.pdf"}, {"name": "Medicare Physician & Other Practitioners Methodology", "fileSize": 319334, "downloadURL": "https://data.cms.gov/sites/default/files/2025-04/MUP_PHY_RY25_202350312_Methodology_508.pdf"}, {"name": "AMA CPT License Agreement 1995-2017", "fileSize": 18960, "downloadURL": "https://data.cms.gov/sites/default/files/2021-01/cms_ama_cpt_license_agreement.pdf"}, {"name": "Medicare Physician & Other Practitioners Place of Service Categories", "fileSize": 12550, "downloadURL": "https://data.cms.gov/sites/default/files/2025-04/MUP_PHY_RY25_20250408_TBL_POS.xlsx"}, {"name": "AMA CPT Agreement", "fileSize": 18960, "downloadURL": "https://data.cms.gov/sites/default/files/2021-01/CMS_AMA_CPT_license_agreement.pdf"}], "links": {"self": {"href": "https://data.cms.gov/data-api/v1/dataset-resources/6fea9d79-0129-4e4c-b1b8-23cd86a4f435"}}};

// dataset-resources of the inpatient file (names the data year)
// https://data.cms.gov/data-api/v1/dataset-resources/2941ab09-8cee-49d8-9703-f3c5b854e388
export const RESOURCES_INPATIENT = {"meta": {"success": true}, "data": [{"name": "Medicare IP Hospitals - by Geography and Service 2024", "fileSize": 3066131, "downloadURL": "https://data.cms.gov/sites/default/files/2026-04/4517a6a1-adeb-4345-9f3d-a95391a470db/MUP_INP_RY26_P03_V10_DY24_Geo.CSV"}, {"name": "Medicare IP Hospitals - by Geography and Service Data Dictionary", "fileSize": 96931, "downloadURL": "https://data.cms.gov/sites/default/files/2023-05/722d3e72-baa1-453f-bc57-c50136c605ba/MUP_INP_RY23_20230426_DD_Geo_508.pdf"}, {"name": "Medicare Inpatient Hospitals Methodology", "fileSize": 304374, "downloadURL": "https://data.cms.gov/sites/default/files/2024-06/MUP_INP_RY24_20240523_Methodology_508.pdf"}], "links": {"self": {"href": "https://data.cms.gov/data-api/v1/dataset-resources/2941ab09-8cee-49d8-9703-f3c5b854e388"}}};

