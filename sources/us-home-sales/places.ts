// Place lists used to route a requested place to the right official dataset. Each list was read from the live dataset
// on 2026-10-14 (a grouped Socrata query through the Probe workflow), not typed from memory.

/** All 169 Connecticut towns, as spelled in the OPM file "Real Estate Sales 2001-2024 GL" (field `town`, group-by over all years). */
export const CT_TOWNS: string[] = (
  "Andover|Ansonia|Ashford|Avon|Barkhamsted|Beacon Falls|Berlin|Bethany|Bethel|Bethlehem|Bloomfield|Bolton|Bozrah|Branford|Bridgeport|Bridgewater|" +
  "Bristol|Brookfield|Brooklyn|Burlington|Canaan|Canterbury|Canton|Chaplin|Cheshire|Chester|Clinton|Colchester|Colebrook|Columbia|Cornwall|Coventry|" +
  "Cromwell|Danbury|Darien|Deep River|Derby|Durham|Eastford|East Granby|East Haddam|East Hampton|East Hartford|East Haven|East Lyme|Easton|" +
  "East Windsor|Ellington|Enfield|Essex|Fairfield|Farmington|Franklin|Glastonbury|Goshen|Granby|Greenwich|Griswold|Groton|Guilford|Haddam|Hamden|" +
  "Hampton|Hartford|Hartland|Harwinton|Hebron|Kent|Killingly|Killingworth|Lebanon|Ledyard|Lisbon|Litchfield|Lyme|Madison|Manchester|Mansfield|" +
  "Marlborough|Meriden|Middlebury|Middlefield|Middletown|Milford|Monroe|Montville|Morris|Naugatuck|New Britain|New Canaan|New Fairfield|New Hartford|" +
  "New Haven|Newington|New London|New Milford|Newtown|Norfolk|North Branford|North Canaan|North Haven|North Stonington|Norwalk|Norwich|Old Lyme|" +
  "Old Saybrook|Orange|Oxford|Plainfield|Plainville|Plymouth|Pomfret|Portland|Preston|Prospect|Putnam|Redding|Ridgefield|Rocky Hill|Roxbury|Salem|" +
  "Salisbury|Scotland|Seymour|Sharon|Shelton|Sherman|Simsbury|Somers|Southbury|Southington|South Windsor|Sprague|Stafford|Stamford|Sterling|" +
  "Stonington|Stratford|Suffield|Thomaston|Thompson|Tolland|Torrington|Trumbull|Union|Vernon|Voluntown|Wallingford|Warren|Washington|Waterbury|" +
  "Waterford|Watertown|Westbrook|West Hartford|West Haven|Weston|Westport|Wethersfield|Willington|Wilton|Winchester|Windham|Windsor|Windsor Locks|" +
  "Wolcott|Woodbridge|Woodbury|Woodstock"
).split("|");

/** New York City boroughs as coded in the DOF file (field `borough`). */
export const NYC_BOROUGHS: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island" };

/** The 254 borough/neighborhood pairs in the DOF rolling sales file (field `neighborhood`), as "<borough code>:<NAME>". */
export const NYC_NEIGHBORHOOD_LIST: string[] = (
  "1:ALPHABET CITY|1:CHELSEA|1:CHINATOWN|1:CIVIC CENTER|1:CLINTON|1:EAST VILLAGE|1:FASHION|1:FINANCIAL|1:FLATIRON|1:GRAMERCY|1:GREENWICH VILLAGE-CENTRAL|" +
  "1:GREENWICH VILLAGE-WEST|1:HARLEM-CENTRAL|1:HARLEM-EAST|1:HARLEM-UPPER|1:HARLEM-WEST|1:INWOOD|1:JAVITS CENTER|1:KIPS BAY|1:LITTLE ITALY|" +
  "1:LOWER EAST SIDE|1:MANHATTAN VALLEY|1:MIDTOWN CBD|1:MIDTOWN EAST|1:MIDTOWN WEST|1:MORNINGSIDE HEIGHTS|1:MURRAY HILL|1:ROOSEVELT ISLAND|1:SOHO|" +
  "1:SOUTHBRIDGE|1:TRIBECA|1:UPPER EAST SIDE (59-79)|1:UPPER EAST SIDE (79-96)|1:UPPER EAST SIDE (96-110)|1:UPPER WEST SIDE (59-79)|" +
  "1:UPPER WEST SIDE (79-96)|1:UPPER WEST SIDE (96-116)|1:WASHINGTON HEIGHTS LOWER|1:WASHINGTON HEIGHTS UPPER|2:BATHGATE|2:BAYCHESTER|" +
  "2:BEDFORD PARK/NORWOOD|2:BELMONT|2:BRONXDALE|2:BRONX PARK|2:CASTLE HILL/UNIONPORT|2:CITY ISLAND|2:CITY ISLAND-PELHAM STRIP|2:COUNTRY CLUB|" +
  "2:CROTONA PARK|2:EAST TREMONT|2:FIELDSTON|2:FORDHAM|2:HIGHBRIDGE/MORRIS HEIGHTS|2:HUNTS POINT|2:KINGSBRIDGE HTS/UNIV HTS|2:KINGSBRIDGE/JEROME PARK|" +
  "2:MELROSE/CONCOURSE|2:MORRISANIA/LONGWOOD|2:MORRIS PARK/VAN NEST|2:MOTT HAVEN/PORT MORRIS|2:MOUNT HOPE/MOUNT EDEN|2:PARKCHESTER|2:PELHAM GARDENS|" +
  "2:PELHAM PARKWAY NORTH|2:PELHAM PARKWAY SOUTH|2:RIVERDALE|2:SCHUYLERVILLE/PELHAM BAY|2:SOUNDVIEW|2:THROGS NECK|2:VAN CORTLANDT PARK|2:WAKEFIELD|" +
  "2:WESTCHESTER|2:WILLIAMSBRIDGE|2:WOODLAWN|3:BATH BEACH|3:BAY RIDGE|3:BEDFORD STUYVESANT|3:BENSONHURST|3:BERGEN BEACH|3:BOERUM HILL|3:BOROUGH PARK|" +
  "3:BRIGHTON BEACH|3:BROOKLYN HEIGHTS|3:BROWNSVILLE|3:BUSH TERMINAL|3:BUSHWICK|3:CANARSIE|3:CARROLL GARDENS|3:CLINTON HILL|3:COBBLE HILL|" +
  "3:COBBLE HILL-WEST|3:CONEY ISLAND|3:CROWN HEIGHTS|3:CYPRESS HILLS|3:DOWNTOWN-FULTON FERRY|3:DOWNTOWN-FULTON MALL|3:DOWNTOWN-METROTECH|" +
  "3:DYKER HEIGHTS|3:EAST NEW YORK|3:FLATBUSH-CENTRAL|3:FLATBUSH-EAST|3:FLATBUSH-LEFFERTS GARDEN|3:FLATBUSH-NORTH|3:FLATLANDS|3:FORT GREENE|" +
  "3:GERRITSEN BEACH|3:GOWANUS|3:GRAVESEND|3:GREENPOINT|3:JAMAICA BAY|3:KENSINGTON|3:MADISON|3:MANHATTAN BEACH|3:MARINE PARK|3:MIDWOOD|3:MILL BASIN|" +
  "3:NAVY YARD|3:OCEAN HILL|3:OCEAN PARKWAY-NORTH|3:OCEAN PARKWAY-SOUTH|3:OLD MILL BASIN|3:PARK SLOPE|3:PARK SLOPE SOUTH|3:PROSPECT HEIGHTS|3:RED HOOK|" +
  "3:SEAGATE|3:SHEEPSHEAD BAY|3:SPRING CREEK|3:SUNSET PARK|3:WILLIAMSBURG-CENTRAL|3:WILLIAMSBURG-EAST|3:WILLIAMSBURG-NORTH|3:WILLIAMSBURG-SOUTH|" +
  "3:WINDSOR TERRACE|3:WYCKOFF HEIGHTS|4:AIRPORT JFK|4:AIRPORT LA GUARDIA|4:ARVERNE|4:ASTORIA|4:BAYSIDE|4:BEECHHURST|4:BELLE HARBOR|4:BELLEROSE|" +
  "4:BREEZY POINT|4:BRIARWOOD|4:BROAD CHANNEL|4:CAMBRIA HEIGHTS|4:COLLEGE POINT|4:CORONA|4:DOUGLASTON|4:EAST ELMHURST|4:ELMHURST|4:FAR ROCKAWAY|" +
  "4:FLORAL PARK|4:FLUSHING MEADOW PARK|4:FLUSHING-NORTH|4:FLUSHING-SOUTH|4:FOREST HILLS|4:FRESH MEADOWS|4:GLENDALE|4:GLEN OAKS|4:HAMMELS|4:HILLCREST|" +
  "4:HOLLIS|4:HOLLIS HILLS|4:HOLLISWOOD|4:HOWARD BEACH|4:JACKSON HEIGHTS|4:JAMAICA|4:JAMAICA BAY|4:JAMAICA ESTATES|4:JAMAICA HILLS|4:KEW GARDENS|" +
  "4:LAURELTON|4:LITTLE NECK|4:LONG ISLAND CITY|4:MASPETH|4:MIDDLE VILLAGE|4:NEPONSIT|4:OAKLAND GARDENS|4:OZONE PARK|4:QUEENS VILLAGE|4:REGO PARK|" +
  "4:RICHMOND HILL|4:RIDGEWOOD|4:ROCKAWAY PARK|4:ROSEDALE|4:SO. JAMAICA-BAISLEY PARK|4:SOUTH JAMAICA|4:SOUTH OZONE PARK|4:SPRINGFIELD GARDENS|" +
  "4:ST. ALBANS|4:SUNNYSIDE|4:WHITESTONE|4:WOODHAVEN|4:WOODSIDE|5:ANNADALE|5:ARDEN HEIGHTS|5:ARROCHAR|5:ARROCHAR-SHORE ACRES|5:BULLS HEAD|" +
  "5:CASTLETON CORNERS|5:CLOVE LAKES|5:CONCORD|5:CONCORD-FOX HILLS|5:DONGAN HILLS|5:DONGAN HILLS-COLONY|5:DONGAN HILLS-OLD TOWN|5:ELTINGVILLE|" +
  "5:EMERSON HILL|5:FRESH KILLS|5:GRANT CITY|5:GRASMERE|5:GREAT KILLS|5:GREAT KILLS-BAY TERRACE|5:GRYMES HILL|5:HUGUENOT|5:LIVINGSTON|5:MANOR HEIGHTS|" +
  "5:MARINERS HARBOR|5:MIDLAND BEACH|5:NEW BRIGHTON|5:NEW BRIGHTON-ST. GEORGE|5:NEW DORP|5:NEW DORP-BEACH|5:NEW DORP-HEIGHTS|5:NEW SPRINGVILLE|" +
  "5:OAKWOOD|5:OAKWOOD-BEACH|5:PLEASANT PLAINS|5:PORT IVORY|5:PORT RICHMOND|5:PRINCES BAY|5:RICHMONDTOWN|5:RICHMONDTOWN-LIGHTHS HILL|5:ROSEBANK|" +
  "5:ROSSVILLE|5:ROSSVILLE-CHARLESTON|5:ROSSVILLE-PORT MOBIL|5:ROSSVILLE-RICHMOND VALLEY|5:SILVER LAKE|5:SOUTH BEACH|5:STAPLETON|5:STAPLETON-CLIFTON|" +
  "5:SUNNYSIDE|5:TODT HILL|5:TOMPKINSVILLE|5:TOTTENVILLE|5:TRAVIS|5:WESTERLEIGH|5:WEST NEW BRIGHTON|5:WILLOWBROOK|5:WOODROW"
).split("|");

export interface NycNeighborhood {
  borough: string; // "1".."5"
  name: string; // exactly as stored, e.g. "WILLIAMSBURG-CENTRAL"
}

export const NYC_NEIGHBORHOODS: NycNeighborhood[] = NYC_NEIGHBORHOOD_LIST.map((s) => {
  const i = s.indexOf(":");
  return { borough: s.slice(0, i), name: s.slice(i + 1) };
});

/**
 * Cook County assessment townships (field `township_code` in the Assessor's sales file). Codes 10-39 are the 30 suburban
 * townships in alphabetical order; 70-77 are the eight townships that make up the City of Chicago. Checked 2026-10-14
 * against the Assessor's Parcel Universe file (township_code with township_name / tax_municipality_name).
 */
export const COOK_TOWNSHIPS: Record<string, string> = {
  "10": "Barrington", "11": "Berwyn", "12": "Bloom", "13": "Bremen", "14": "Calumet", "15": "Cicero", "16": "Elk Grove", "17": "Evanston",
  "18": "Hanover", "19": "Lemont", "20": "Leyden", "21": "Lyons", "22": "Maine", "23": "New Trier", "24": "Niles", "25": "Northfield",
  "26": "Norwood Park", "27": "Oak Park", "28": "Orland", "29": "Palatine", "30": "Palos", "31": "Proviso", "32": "Rich", "33": "River Forest",
  "34": "Riverside", "35": "Schaumburg", "36": "Stickney", "37": "Thornton", "38": "Wheeling", "39": "Worth",
  "70": "Hyde Park", "71": "Jefferson", "72": "Lake", "73": "Lake View", "74": "North Chicago", "75": "Rogers Park", "76": "South Chicago", "77": "West Chicago",
};

/** The eight townships that make up the City of Chicago (99.8% of their parcels carry the municipality "CITY OF CHICAGO"). */
export const CHICAGO_TOWNSHIP_CODES = ["70", "71", "72", "73", "74", "75", "76", "77"];
