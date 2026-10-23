// Real CSV from Statistics Sweden (SCB) table TAB4310 "Prices of electricity for households, half-yearly", copied from the Verifier's GitHub probe of 2026-10-21
// (GET https://api.scb.se/OV0104/v2beta/api/v2/tables/TAB4310/data?lang=en&outputFormat=csv&valuecodes%5BTid%5D=2026H1&valuecodes%5BKategorikwh%5D=*&valuecodes%5BContentsCode%5D=000006WS,000006WO).
// Unit: csek/kWh (hundredths of a krona, ore). The two-period, extra-content versions below are SYNTHETIC: they copy the proven layout
// ("<ContentsCode> <period>" columns) with invented numbers and are used only to test the arithmetic and the header parsing.
export const REAL_CSV = `"Kategorikwh","000006WS 2026H1","000006WO 2026H1"
"DA",634.68,136.93
"DB",374.40,111.40
"DC",330.38,101.60
"DD",263.47,97.76
"DE",234.26,94.42
`;

// SYNTHETIC: same layout, two half-years, with grid price (WP), electricity tax (0000070Q), VAT (000006WR), and one missing value ("..").
export const SYNTHETIC_CSV = `"Kategorikwh","000006WS 2025H2","000006WO 2025H2","000006WP 2025H2","0000070Q 2025H2","000006WR 2025H2","000006WS 2026H1","000006WO 2026H1","000006WP 2026H1","0000070Q 2026H1","000006WR 2026H1"
"DA",600.00,130.00,300.00,50.00,120.00,634.68,136.93,320.00,60.00,126.94
"DB",350.00,100.00,150.00,40.00,70.00,374.40,111.40,160.00,45.00,74.88
"DC",300.00,90.00,100.00,40.00,60.00,330.38,101.60,110.00,42.00,66.08
"DD",250.00,90.00,70.00,40.00,50.00,263.47,97.76,80.00,38.00,52.69
"DE",230.00,90.00,55.00,40.00,45.00,..,..,..,..,..
`;
