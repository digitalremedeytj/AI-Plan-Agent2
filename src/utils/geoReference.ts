// Canonical US States, Territories, and 210 Nielsen DMAs (Designated Market Areas)

export interface StateRecord {
  code: string;
  name: string;
}

export const US_STATES: StateRecord[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'PR', name: 'Puerto Rico' },
];

export interface DmaRecord {
  code?: number;
  name: string;
  aliases?: string[];
}

export const NIELSEN_DMAS: DmaRecord[] = [
  { code: 501, name: 'New York, NY', aliases: ['NYC', 'New York City', 'New York'] },
  { code: 803, name: 'Los Angeles, CA', aliases: ['LA', 'SoCal', 'Los Angeles'] },
  { code: 602, name: 'Chicago, IL', aliases: ['Chicago', 'Chicagoland'] },
  { code: 504, name: 'Philadelphia, PA', aliases: ['Philly', 'Philadelphia'] },
  { code: 623, name: 'Dallas-Ft. Worth, TX', aliases: ['Dallas', 'DFW', 'Fort Worth', 'Dallas Fort Worth'] },
  { code: 524, name: 'Atlanta, GA', aliases: ['Atlanta', 'ATL'] },
  { code: 618, name: 'Houston, TX', aliases: ['Houston'] },
  { code: 511, name: 'Washington, DC (Hag, Wsh)', aliases: ['Washington DC', 'Washington', 'DC DMA', 'DMV'] },
  { code: 506, name: 'Boston (Manchester), MA', aliases: ['Boston', 'Boston MA', 'Manchester'] },
  { code: 807, name: 'San Francisco-Oak-San Jose, CA', aliases: ['San Francisco', 'SF Bay Area', 'Bay Area', 'Oakland', 'San Jose'] },
  { code: 753, name: 'Phoenix (Prescott), AZ', aliases: ['Phoenix', 'Prescott'] },
  { code: 819, name: 'Seattle-Tacoma, WA', aliases: ['Seattle', 'Tacoma', 'Seattle Tacoma'] },
  { code: 539, name: 'Tampa-St. Petersburg (Sarasota), FL', aliases: ['Tampa', 'St. Petersburg', 'Tampa Bay', 'Sarasota'] },
  { code: 613, name: 'Minneapolis-St. Paul, MN', aliases: ['Minneapolis', 'St. Paul', 'Twin Cities'] },
  { code: 505, name: 'Detroit, MI', aliases: ['Detroit', 'Motor City'] },
  { code: 751, name: 'Denver, CO', aliases: ['Denver'] },
  { code: 534, name: 'Orlando-Daytona Bch-Melbrn, FL', aliases: ['Orlando', 'Daytona Beach', 'Melbourne'] },
  { code: 528, name: 'Miami-Ft. Lauderdale, FL', aliases: ['Miami', 'Fort Lauderdale', 'Ft Lauderdale', 'South Florida'] },
  { code: 510, name: 'Cleveland-Akron (Canton), OH', aliases: ['Cleveland', 'Akron', 'Canton'] },
  { code: 862, name: 'Sacramento-Stktn-Modesto, CA', aliases: ['Sacramento', 'Stockton', 'Modesto'] },
  { code: 517, name: 'Charlotte, NC', aliases: ['Charlotte'] },
  { code: 820, name: 'Portland, OR', aliases: ['Portland', 'Portland OR'] },
  { code: 609, name: 'St. Louis, MO', aliases: ['St. Louis', 'Saint Louis', 'St Louis'] },
  { code: 527, name: 'Indianapolis, IN', aliases: ['Indianapolis', 'Indy'] },
  { code: 508, name: 'Pittsburgh, PA', aliases: ['Pittsburgh'] },
  { code: 560, name: 'Raleigh-Durham (Fayetvlle), NC', aliases: ['Raleigh', 'Durham', 'Fayetteville', 'Research Triangle'] },
  { code: 512, name: 'Baltimore, MD', aliases: ['Baltimore'] },
  { code: 770, name: 'Salt Lake City, UT', aliases: ['Salt Lake City', 'SLC', 'Salt Lake'] },
  { code: 659, name: 'Nashville, TN', aliases: ['Nashville'] },
  { code: 825, name: 'San Diego, CA', aliases: ['San Diego'] },
  { code: 641, name: 'San Antonio, TX', aliases: ['San Antonio'] },
  { code: 533, name: 'Hartford & New Haven, CT', aliases: ['Hartford', 'New Haven', 'Hartford New Haven'] },
  { code: 535, name: 'Columbus, OH', aliases: ['Columbus', 'Columbus OH'] },
  { code: 616, name: 'Kansas City, MO', aliases: ['Kansas City', 'KC'] },
  { code: 567, name: 'Greenville-Spart-Ashevll, SC', aliases: ['Greenville', 'Spartanburg', 'Asheville'] },
  { code: 515, name: 'Cincinnati, OH', aliases: ['Cincinnati'] },
  { code: 617, name: 'Milwaukee, WI', aliases: ['Milwaukee'] },
  { code: 635, name: 'Austin, TX', aliases: ['Austin'] },
  { code: 548, name: 'West Palm Beach-Ft. Pierce, FL', aliases: ['West Palm Beach', 'Ft Pierce', 'Palm Beach'] },
  { code: 839, name: 'Las Vegas, NV', aliases: ['Las Vegas', 'Vegas'] },
  { code: 563, name: 'Grand Rapids-Kalmzoo-B.Crk, MI', aliases: ['Grand Rapids', 'Kalamazoo', 'Battle Creek'] },
  { code: 566, name: 'Harrisburg-Lncstr-Leb-York, PA', aliases: ['Harrisburg', 'Lancaster', 'Lebanon', 'York'] },
  { code: 561, name: 'Jacksonville, FL', aliases: ['Jacksonville'] },
  { code: 630, name: 'Birmingham (Ann and Tusc), AL', aliases: ['Birmingham', 'Anniston', 'Tuscaloosa'] },
  { code: 544, name: 'Norfolk-Portsmth-Newpt Nws, VA', aliases: ['Norfolk', 'Portsmouth', 'Newport News', 'Hampton Roads', 'Virginia Beach'] },
  { code: 518, name: 'Greensboro-H.Point-W.Salem, NC', aliases: ['Greensboro', 'High Point', 'Winston-Salem', 'Triad'] },
  { code: 650, name: 'Oklahoma City, OK', aliases: ['Oklahoma City', 'OKC'] },
  { code: 790, name: 'Albuquerque-Santa Fe, NM', aliases: ['Albuquerque', 'Santa Fe'] },
  { code: 529, name: 'Louisville, KY', aliases: ['Louisville'] },
  { code: 640, name: 'Memphis, TN', aliases: ['Memphis'] },
  { code: 622, name: 'New Orleans, LA', aliases: ['New Orleans', 'NOLA'] },
  { code: 521, name: 'Providence-New Bedford, RI', aliases: ['Providence', 'New Bedford'] },
  { code: 514, name: 'Buffalo, NY', aliases: ['Buffalo'] },
  { code: 866, name: 'Fresno-Visalia, CA', aliases: ['Fresno', 'Visalia'] },
  { code: 556, name: 'Richmond-Petersburg, VA', aliases: ['Richmond', 'Petersburg'] },
  { code: 577, name: 'Wilkes Barre-Scranton-Hztn, PA', aliases: ['Wilkes Barre', 'Scranton', 'Hazleton'] },
  { code: 532, name: 'Albany-Schenectady-Troy, NY', aliases: ['Albany', 'Schenectady', 'Troy', 'Capital Region'] },
  { code: 671, name: 'Tulsa, OK', aliases: ['Tulsa'] },
  { code: 693, name: 'Little Rock-Pine Bluff, AR', aliases: ['Little Rock', 'Pine Bluff'] },
  { code: 686, name: 'Mobile-Pensacola (Ft Walt), AL', aliases: ['Mobile', 'Pensacola', 'Fort Walton Beach'] },
  { code: 557, name: 'Knoxville, TN', aliases: ['Knoxville'] },
  { code: 571, name: 'Ft. Myers-Naples, FL', aliases: ['Ft Myers', 'Fort Myers', 'Naples'] },
  { code: 541, name: 'Lexington, KY', aliases: ['Lexington'] },
  { code: 542, name: 'Dayton, OH', aliases: ['Dayton'] },
  { code: 744, name: 'Honolulu, HI', aliases: ['Honolulu', 'Hawaii DMA'] },
  { code: 679, name: 'Des Moines-Ames, IA', aliases: ['Des Moines', 'Ames'] },
  { code: 573, name: 'Roanoke-Lynchburg, VA', aliases: ['Roanoke', 'Lynchburg'] },
  { code: 658, name: 'Green Bay-Appleton, WI', aliases: ['Green Bay', 'Appleton'] },
  { code: 881, name: 'Spokane, WA', aliases: ['Spokane'] },
  { code: 652, name: 'Omaha, NE', aliases: ['Omaha'] },
  { code: 789, name: 'Tucson (Sierra Vista), AZ', aliases: ['Tucson', 'Sierra Vista'] },
  { code: 619, name: 'Springfield, MO', aliases: ['Springfield MO'] },
  { code: 538, name: 'Rochester, NY', aliases: ['Rochester NY', 'Rochester'] },
  { code: 546, name: 'Columbia, SC', aliases: ['Columbia SC', 'Columbia'] },
  { code: 547, name: 'Toledo, OH', aliases: ['Toledo'] },
  { code: 691, name: 'Huntsville-Decatur (Flor), AL', aliases: ['Huntsville', 'Decatur', 'Florence'] },
  { code: 500, name: 'Portland-Auburn, ME', aliases: ['Portland ME', 'Portland Auburn', 'Auburn'] },
  { code: 612, name: 'Shreveport, LA', aliases: ['Shreveport'] },
  { code: 669, name: 'Madison, WI', aliases: ['Madison'] },
  { code: 555, name: 'Syracuse, NY', aliases: ['Syracuse'] },
  { code: 625, name: 'Waco-Temple-Bryan, TX', aliases: ['Waco', 'Temple', 'Bryan'] },
  { code: 648, name: 'Champaign & Sprngfld-Decatur, IL', aliases: ['Champaign', 'Springfield IL', 'Decatur IL'] },
  { code: 636, name: 'Harlingen-Wslco-Brnsvl-Mca, TX', aliases: ['Harlingen', 'Weslaco', 'Brownsville', 'McAllen', 'Rio Grande Valley'] },
  { code: 637, name: 'Cedar Rapids-Wtrlo-IWC&Dub, IA', aliases: ['Cedar Rapids', 'Waterloo', 'Dubuque', 'Iowa City'] },
  { code: 752, name: 'Colorado Springs-Pueblo, CO', aliases: ['Colorado Springs', 'Pueblo'] },
  { code: 765, name: 'El Paso (Las Cruces), TX', aliases: ['El Paso', 'Las Cruces'] },
  { code: 507, name: 'Savannah, GA', aliases: ['Savannah'] },
  { code: 716, name: 'Baton Rouge, LA', aliases: ['Baton Rouge'] },
  { code: 519, name: 'Charleston, SC', aliases: ['Charleston SC', 'Charleston'] },
  { code: 575, name: 'Chattanooga, TN', aliases: ['Chattanooga'] },
  { code: 588, name: 'South Bend-Elkhart, IN', aliases: ['South Bend', 'Elkhart'] },
  { code: 718, name: 'Jackson, MS', aliases: ['Jackson MS', 'Jackson'] },
  { code: 531, name: 'Tri-Cities, TN-VA', aliases: ['Tri-Cities', 'Johnson City', 'Kingsport', 'Bristol'] },
  { code: 523, name: 'Burlington-Plattsburgh, VT', aliases: ['Burlington', 'Plattsburgh'] },
  { code: 682, name: 'Quad Cities, IA-IL', aliases: ['Davenport', 'Moline', 'Rock Island', 'Bettendorf'] },
  { code: 670, name: 'Fort Smith-Fay-Sprngdl-Rgr, AR', aliases: ['Fort Smith', 'Fayetteville AR', 'Springdale', 'Rogers'] },
  { code: 570, name: 'Myrtle Beach-Florence, SC', aliases: ['Myrtle Beach', 'Florence SC'] },
  { code: 649, name: 'Evansville, IN', aliases: ['Evansville'] },
  { code: 545, name: 'Greenville-N.Bern-Washngtn, NC', aliases: ['Greenville NC', 'New Bern', 'Washington NC'] },
  { code: 757, name: 'Boise, ID', aliases: ['Boise'] },
  { code: 584, name: 'Charlottesville, VA', aliases: ['Charlottesville'] },
  { code: 605, name: 'Topeka, KS', aliases: ['Topeka'] },
  { code: 678, name: 'Wichita-Hutchinson, KS', aliases: ['Wichita', 'Hutchinson'] },
  { code: 745, name: 'Fairbanks, AK', aliases: ['Fairbanks'] },
  { code: 743, name: 'Anchorage, AK', aliases: ['Anchorage'] },
  { code: 747, name: 'Juneau, AK', aliases: ['Juneau'] },
  { code: 811, name: 'Reno, NV', aliases: ['Reno'] },
  { code: 855, name: 'Santa Barbara-San Mar-San Lu Ob, CA', aliases: ['Santa Barbara', 'Santa Maria', 'San Luis Obispo'] },
  { code: 868, name: 'Chico-Redding, CA', aliases: ['Chico', 'Redding'] },
  { code: 802, name: 'Eureka, CA', aliases: ['Eureka'] },
  { code: 813, name: 'Medford-Klamath Falls, OR', aliases: ['Medford', 'Klamath Falls'] },
  { code: 801, name: 'Eugene, OR', aliases: ['Eugene'] },
  { code: 810, name: 'Yakima-Pasco-Rchlnd-Knnwck, WA', aliases: ['Yakima', 'Pasco', 'Richland', 'Kennewick', 'Tri-Cities WA'] },
  { code: 800, name: 'Bakersfield, CA', aliases: ['Bakersfield'] },
  { code: 828, name: 'Monterey-Salinas, CA', aliases: ['Monterey', 'Salinas'] },
  { code: 771, name: 'Yuma-El Centro, AZ', aliases: ['Yuma', 'El Centro', 'Yuma, AZ'] },
  { code: 756, name: 'Billings, MT', aliases: ['Billings'] },
  { code: 762, name: 'Missoula, MT', aliases: ['Missoula'] },
  { code: 754, name: 'Butte-Bozeman, MT', aliases: ['Butte', 'Bozeman'] },
  { code: 755, name: 'Great Falls, MT', aliases: ['Great Falls'] },
  { code: 766, name: 'Helena, MT', aliases: ['Helena'] },
  { code: 759, name: 'Cheyenne-Scottsbluff, WY', aliases: ['Cheyenne', 'Scottsbluff'] },
  { code: 737, name: 'Mankato, MN', aliases: ['Mankato'] },
  { code: 631, name: 'Ottumwa-Kirksville, IA', aliases: ['Ottumwa', 'Kirksville'] },
  { code: 767, name: 'Casper-Riverton, WY', aliases: ['Casper', 'Riverton'] },
  { code: 773, name: 'Grand Junction-Montrose, CO', aliases: ['Grand Junction', 'Montrose', 'Grand Junction, CO'] },
  { code: 798, name: 'Glendive, MT', aliases: ['Glendive'] },
  { code: 724, name: 'Fargo-Valley City, ND', aliases: ['Fargo', 'Valley City'] },
  { code: 687, name: 'Minot-Bismarck-Dickinson, ND', aliases: ['Minot', 'Bismarck', 'Dickinson'] },
  { code: 722, name: 'Lincoln & Hastings-Krny, NE', aliases: ['Lincoln', 'Hastings', 'Kearney'] },
  { code: 740, name: 'North Platte, NE', aliases: ['North Platte'] },
  { code: 725, name: 'Sioux Falls (Mitchell), SD', aliases: ['Sioux Falls', 'Mitchell'] },
  { code: 764, name: 'Rapid City, SD', aliases: ['Rapid City'] },
  { code: 624, name: 'Sioux City, IA', aliases: ['Sioux City'] },
  { code: 611, name: 'Rochester-Mason City-Austin, MN', aliases: ['Mason City', 'Austin MN'] },
  { code: 676, name: 'Duluth-Superior, MN', aliases: ['Duluth', 'Superior'] },
  { code: 638, name: 'St. Joseph, MO', aliases: ['St Joseph', 'Saint Joseph'] },
  { code: 604, name: 'Columbia-Jefferson City, MO', aliases: ['Jefferson City'] },
  { code: 603, name: 'Joplin-Pittsburg, MO', aliases: ['Joplin', 'Pittsburg KS'] },
  { code: 627, name: 'Wichita Falls & Lawton, TX', aliases: ['Wichita Falls', 'Lawton'] },
  { code: 633, name: 'Odessa-Midland, TX', aliases: ['Odessa', 'Midland'] },
  { code: 634, name: 'Amarillo, TX', aliases: ['Amarillo'] },
  { code: 651, name: 'Lubbock, TX', aliases: ['Lubbock'] },
  { code: 804, name: 'Palm Springs, CA', aliases: ['Palm Springs'] },
  { code: 662, name: 'Abilene-Sweetwater, TX', aliases: ['Abilene', 'Sweetwater'] },
  { code: 661, name: 'San Angelo, TX', aliases: ['San Angelo'] },
  { code: 600, name: 'Corpus Christi, TX', aliases: ['Corpus Christi'] },
  { code: 692, name: 'Beaumont-Port Arthur, TX', aliases: ['Beaumont', 'Port Arthur'] },
  { code: 749, name: 'Laredo, TX', aliases: ['Laredo'] },
  { code: 642, name: 'Lafayette, LA', aliases: ['Lafayette LA', 'Lafayette'] },
  { code: 628, name: 'Monroe-El Dorado, LA', aliases: ['Monroe LA', 'El Dorado'] },
  { code: 643, name: 'Lake Charles, LA', aliases: ['Lake Charles'] },
  { code: 565, name: 'Elmira (Corning), NY', aliases: ['Elmira', 'Corning'] },
  { code: 644, name: 'Alexandria, LA', aliases: ['Alexandria LA'] },
  { code: 710, name: 'Hattiesburg-Laurel, MS', aliases: ['Hattiesburg', 'Laurel'] },
  { code: 711, name: 'Meridian, MS', aliases: ['Meridian'] },
  { code: 647, name: 'Greenwood-Greenville, MS', aliases: ['Greenwood', 'Greenville MS'] },
  { code: 673, name: 'Columbus-Tupelo-West Point, MS', aliases: ['Tupelo', 'West Point MS'] },
  { code: 746, name: 'Biloxi-Gulfport, MS', aliases: ['Biloxi', 'Gulfport'] },
  { code: 606, name: 'Dothan, AL', aliases: ['Dothan'] },
  { code: 698, name: 'Montgomery-Selma, AL', aliases: ['Montgomery', 'Selma'] },
  { code: 522, name: 'Columbus, GA', aliases: ['Columbus GA'] },
  { code: 503, name: 'Macon, GA', aliases: ['Macon'] },
  { code: 520, name: 'Augusta, GA', aliases: ['Augusta'] },
  { code: 525, name: 'Albany, GA', aliases: ['Albany GA'] },
  { code: 530, name: 'Tallahassee-Thomasville, FL', aliases: ['Tallahassee', 'Thomasville'] },
  { code: 709, name: 'Tyler-Longview (Lufkin & Nacogdoches), TX', aliases: ['Tyler', 'Longview', 'Lufkin', 'Nacogdoches'] },
  { code: 656, name: 'Panama City, FL', aliases: ['Panama City', 'Destin', 'Panama City-Destin, FL'] },
  { code: 574, name: 'Johnstown-Altoona-St Colge, PA', aliases: ['Johnstown', 'Altoona', 'State College'] },
  { code: 516, name: 'Erie, PA', aliases: ['Erie'] },
  { code: 564, name: 'Charleston-Huntington, WV', aliases: ['Huntington', 'Charleston WV'] },
  { code: 559, name: 'Bluefield-Beckley-Oak Hill, WV', aliases: ['Bluefield', 'Beckley', 'Oak Hill'] },
  { code: 502, name: 'Binghamton, NY', aliases: ['Binghamton'] },
  { code: 592, name: 'Gainesville, FL', aliases: ['Gainesville FL'] },
  { code: 598, name: 'Clarksburg-Weston, WV', aliases: ['Clarksburg', 'Weston'] },
  { code: 597, name: 'Parkersburg, WV', aliases: ['Parkersburg'] },
  { code: 554, name: 'Wheeling-Steubenville, WV', aliases: ['Wheeling', 'Steubenville'] },
  { code: 552, name: 'Presque Isle, ME', aliases: ['Presque Isle'] },
  { code: 537, name: 'Bangor, ME', aliases: ['Bangor'] },
  { code: 526, name: 'Utica, NY', aliases: ['Utica'] },
  { code: 540, name: 'Traverse City-Cadillac, MI', aliases: ['Traverse City', 'Cadillac'] },
  { code: 513, name: 'Flint-Saginaw-Bay City, MI', aliases: ['Flint', 'Saginaw', 'Bay City'] },
  { code: 551, name: 'Lansing, MI', aliases: ['Lansing'] },
  { code: 543, name: 'Springfield-Holyoke, MA', aliases: ['Springfield MA', 'Holyoke'] },
  { code: 553, name: 'Marquette, MI', aliases: ['Marquette'] },
  { code: 583, name: 'Alpena, MI', aliases: ['Alpena'] },
  { code: 536, name: 'Youngstown, OH', aliases: ['Youngstown'] },
  { code: 558, name: 'Lima, OH', aliases: ['Lima'] },
  { code: 509, name: 'Fort Wayne, IN', aliases: ['Fort Wayne'] },
  { code: 596, name: 'Zanesville, OH', aliases: ['Zanesville'] },
  { code: 581, name: 'Terre Haute, IN', aliases: ['Terre Haute'] },
  { code: 582, name: 'Lafayette, IN', aliases: ['Lafayette IN'] },
  { code: 675, name: 'Peoria-Bloomington, IL', aliases: ['Peoria', 'Bloomington IL'] },
  { code: 610, name: 'Rockford, IL', aliases: ['Rockford'] },
  { code: 717, name: 'Quincy-Hannibal-Keokuk, IL', aliases: ['Quincy', 'Hannibal', 'Keokuk', 'Quincy-Hannibal, IL-MO'] },
  { code: 657, name: 'Sherman-Ada, TX', aliases: ['Sherman', 'Ada'] },
  { code: 626, name: 'Victoria, TX', aliases: ['Victoria TX'] },
  { code: 576, name: 'Salisbury, MD', aliases: ['Salisbury'] },
  { code: 569, name: 'Harrisonburg, VA', aliases: ['Harrisonburg'] },
  { code: 549, name: 'Watertown, NY', aliases: ['Watertown NY'] },
  { code: 736, name: 'Bowling Green, KY', aliases: ['Bowling Green'] },
  { code: 734, name: 'Jonesboro, AR', aliases: ['Jonesboro'] },
  { code: 632, name: 'Paducah-Cape Girard-Harsbg, KY', aliases: ['Paducah', 'Cape Girardeau', 'Harrisburg IL'] },
  { code: 639, name: 'Jackson, TN', aliases: ['Jackson TN'] },
  { code: 702, name: 'La Crosse-Eau Claire, WI', aliases: ['La Crosse', 'Eau Claire'] },
  { code: 550, name: 'Wilmington, NC', aliases: ['Wilmington NC'] },
  { code: 705, name: 'Wausau-Rhinelander, WI', aliases: ['Wausau', 'Rhinelander'] },
  { code: 758, name: 'Idaho Falls-Pocatello, ID', aliases: ['Idaho Falls', 'Pocatello'] },
  { code: 760, name: 'Twin Falls, ID', aliases: ['Twin Falls'] },
  { code: 821, name: 'Bend, OR', aliases: ['Bend'] },
];

/** Fast lookup dictionaries */
const stateByCode = new Map<string, StateRecord>();
const stateByName = new Map<string, StateRecord>();

US_STATES.forEach((state) => {
  stateByCode.set(state.code.toUpperCase(), state);
  stateByName.set(state.name.toLowerCase(), state);
});

// DMA normalized lookup
interface DmaLookupEntry {
  canonical: string;
  code?: number;
}

const dmaLookup = new Map<string, DmaLookupEntry>();

function cleanDmaKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

NIELSEN_DMAS.forEach((dma) => {
  const entry: DmaLookupEntry = { canonical: dma.name, code: dma.code };
  // Canonical name
  dmaLookup.set(cleanDmaKey(dma.name), entry);
  // Without state suffix if present (e.g., "New York, NY" -> "new york")
  const withoutState = dma.name.split(',')[0];
  if (withoutState) {
    dmaLookup.set(cleanDmaKey(withoutState), entry);
  }
  // Code as string
  if (dma.code) {
    dmaLookup.set(String(dma.code), entry);
  }
  // Aliases
  if (dma.aliases) {
    dma.aliases.forEach((alias) => {
      dmaLookup.set(cleanDmaKey(alias), entry);
    });
  }
});

/**
 * Normalizes a single state string to its canonical Form: "State Name (Code)" or "Code"
 */
export function normalizeState(input: string): StateRecord | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct 2-letter code check
  const upper = trimmed.toUpperCase();
  if (stateByCode.has(upper)) {
    return stateByCode.get(upper)!;
  }

  // Full name check
  const lower = trimmed.toLowerCase();
  if (stateByName.has(lower)) {
    return stateByName.get(lower)!;
  }

  // Check if starts with code e.g. "NY - New York" or "New York, US"
  for (const state of US_STATES) {
    if (lower.startsWith(state.name.toLowerCase()) || lower.includes(`(${state.code.toLowerCase()})`)) {
      return state;
    }
  }

  return null;
}

/**
 * Normalizes a single DMA string/code to its canonical name
 */
export function normalizeDma(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Remove common prefixes like "DMA 501", "DMA - New York"
  const stripped = trimmed.replace(/^dma[\s:-]+/i, '').trim();
  const cleaned = cleanDmaKey(stripped);

  const direct = dmaLookup.get(cleaned);
  if (direct) return direct.canonical;

  // Partial search if no direct match
  for (const [key, entry] of dmaLookup.entries()) {
    if (key.length >= 4 && (cleaned.includes(key) || key.includes(cleaned))) {
      return entry.canonical;
    }
  }

  return null;
}

/** Only an exact state name or code: "Washington Metro" is not Washington state. */
export function exactState(input: string): StateRecord | null {
  const trimmed = input.trim().replace(/\s+state$/i, '');
  return stateByCode.get(trimmed.toUpperCase()) ?? stateByName.get(trimmed.toLowerCase()) ?? null;
}

// Longest first, so "Washington DC" is consumed before "Washington" can match on its own.
const dmaTextKeys = Array.from(dmaLookup.keys())
  .filter((key) => key.length >= 4 && !/^\d+$/.test(key))
  .sort((a, b) => b.length - a.length);

/**
 * The DMAs a free-text location names, e.g. "Greater Boston Area (Boston + 30 mi)" gives Boston.
 * Stricter than normalizeDma, which also matches when a market name merely contains the text
 * ("ports" is Portsmouth there): here a market counts only when its name or alias appears as
 * whole words. Short aliases ("LA", "ATL") count only as the whole text.
 */
export function dmasNamedIn(text: string): string[] {
  const cleaned = cleanDmaKey(text.replace(/^dma[\s:-]+/i, ''));
  const direct = dmaLookup.get(cleaned);
  if (direct) return [direct.canonical];
  const found = new Set<string>();
  let rest = ` ${cleaned} `;
  for (const key of dmaTextKeys) {
    const at = rest.indexOf(` ${key} `);
    if (at === -1) continue;
    found.add(dmaLookup.get(key)!.canonical);
    rest = `${rest.slice(0, at)} | ${rest.slice(at + key.length + 2)}`;
  }
  return Array.from(found);
}

/**
 * Parse comma-separated or newline-separated text into matched targets and unparsed strings.
 */
export function parseGeoTextInput(
  text: string,
  type: 'State' | 'DMA',
): { valid: string[]; unrecognized: string[] } {
  if (!text || !text.trim()) {
    return { valid: [], unrecognized: [] };
  }

  const rawTokens = text
    .split(/[\n,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const validSet = new Set<string>();
  const unrecognized: string[] = [];

  for (const token of rawTokens) {
    if (type === 'State') {
      const match = normalizeState(token);
      if (match) {
        validSet.add(`${match.name} (${match.code})`);
      } else {
        unrecognized.push(token);
      }
    } else {
      const match = normalizeDma(token);
      if (match) {
        validSet.add(match);
      } else {
        // If user typed something that looks like a market name, keep it if it's reasonable, or mark unrecognized
        unrecognized.push(token);
      }
    }
  }

  return {
    valid: Array.from(validSet),
    unrecognized,
  };
}

/**
 * Parses rows from a CSV or Excel sheet array to find State or DMA targets.
 */
export function extractGeoFromSpreadsheetRows(
  rows: any[][],
  type: 'State' | 'DMA',
): {
  valid: string[];
  unrecognized: string[];
  detectedColumnName?: string;
  totalRowsProcessed: number;
} {
  if (!rows || rows.length === 0) {
    return { valid: [], unrecognized: [], totalRowsProcessed: 0 };
  }

  // Step 1: Scan header row for likely column names
  let headerIndex = -1;
  let targetColIndex = -1;
  let detectedColumnName: string | undefined;

  const headerKeywords =
    type === 'State'
      ? ['state', 'states', 'st', 'province', 'state code', 'target state', 'geo', 'location']
      : ['dma', 'dma name', 'market', 'metro', 'market name', 'dma code', 'designated market area', 'geo', 'location'];

  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim().toLowerCase();
      if (headerKeywords.some((keyword) => cellVal === keyword || cellVal.includes(keyword))) {
        headerIndex = r;
        targetColIndex = c;
        detectedColumnName = String(row[c]).trim();
        break;
      }
    }
    if (targetColIndex !== -1) break;
  }

  // If a header column was detected, extract rows below the header
  const validSet = new Set<string>();
  const unrecognizedSet = new Set<string>();
  let rowsCount = 0;

  if (targetColIndex !== -1 && headerIndex !== -1) {
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const cellVal = String(row[targetColIndex] || '').trim();
      if (!cellVal) continue;
      rowsCount++;

      if (type === 'State') {
        const match = normalizeState(cellVal);
        if (match) {
          validSet.add(`${match.name} (${match.code})`);
        } else {
          unrecognizedSet.add(cellVal);
        }
      } else {
        const match = normalizeDma(cellVal);
        if (match) {
          validSet.add(match);
        } else {
          unrecognizedSet.add(cellVal);
        }
      }
    }
  } else {
    // If no header was found, scan all cells in the first 50 rows to find which column has the highest match rate
    const colMatchCounts = new Map<number, number>();
    const checkRows = rows.slice(0, Math.min(rows.length, 50));

    checkRows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, colIdx) => {
        const cellVal = String(cell || '').trim();
        if (!cellVal) return;
        const match = type === 'State' ? normalizeState(cellVal) : normalizeDma(cellVal);
        if (match) {
          colMatchCounts.set(colIdx, (colMatchCounts.get(colIdx) || 0) + 1);
        }
      });
    });

    let bestCol = -1;
    let maxMatches = 0;
    colMatchCounts.forEach((count, colIdx) => {
      if (count > maxMatches) {
        maxMatches = count;
        bestCol = colIdx;
      }
    });

    if (bestCol !== -1) {
      targetColIndex = bestCol;
      detectedColumnName = `Column ${bestCol + 1}`;
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const cellVal = String(row[bestCol] || '').trim();
        if (!cellVal) continue;
        rowsCount++;

        if (type === 'State') {
          const match = normalizeState(cellVal);
          if (match) {
            validSet.add(`${match.name} (${match.code})`);
          } else {
            unrecognizedSet.add(cellVal);
          }
        } else {
          const match = normalizeDma(cellVal);
          if (match) {
            validSet.add(match);
          } else {
            unrecognizedSet.add(cellVal);
          }
        }
      }
    } else {
      // Fallback: examine all cell values across the sheet
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          const cellVal = String(cell || '').trim();
          if (!cellVal) continue;
          rowsCount++;

          if (type === 'State') {
            const match = normalizeState(cellVal);
            if (match) validSet.add(`${match.name} (${match.code})`);
          } else {
            const match = normalizeDma(cellVal);
            if (match) validSet.add(match);
          }
        }
      }
    }
  }

  return {
    valid: Array.from(validSet),
    unrecognized: Array.from(unrecognizedSet),
    detectedColumnName,
    totalRowsProcessed: rowsCount,
  };
}
