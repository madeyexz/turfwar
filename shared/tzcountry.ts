/**
 * Rough "where are players from": the browser's IANA time zone mapped to the country it mostly
 * means (Asia/Taipei → Taiwan). A zone names a region, not a person's location, and a few zones span
 * several countries; it is an estimate for the owner's player reports. Unknown zones are "Other".
 */
const ZONES: Record<string, string> = {
  // East Asia
  'Asia/Taipei': 'Taiwan', ROC: 'Taiwan',
  'Asia/Tokyo': 'Japan', Japan: 'Japan',
  'Asia/Seoul': 'South Korea', ROK: 'South Korea', 'Asia/Pyongyang': 'North Korea',
  'Asia/Shanghai': 'China', 'Asia/Chongqing': 'China', 'Asia/Chungking': 'China', 'Asia/Harbin': 'China', 'Asia/Urumqi': 'China', 'Asia/Kashgar': 'China', PRC: 'China',
  'Asia/Hong_Kong': 'Hong Kong', Hongkong: 'Hong Kong', 'Asia/Macau': 'Macau', 'Asia/Macao': 'Macau',
  'Asia/Ulaanbaatar': 'Mongolia', 'Asia/Ulan_Bator': 'Mongolia',
  // Southeast Asia
  'Asia/Singapore': 'Singapore', Singapore: 'Singapore',
  'Asia/Kuala_Lumpur': 'Malaysia', 'Asia/Kuching': 'Malaysia',
  'Asia/Bangkok': 'Thailand', 'Asia/Ho_Chi_Minh': 'Vietnam', 'Asia/Saigon': 'Vietnam',
  'Asia/Manila': 'Philippines', 'Asia/Jakarta': 'Indonesia', 'Asia/Makassar': 'Indonesia', 'Asia/Jayapura': 'Indonesia', 'Asia/Pontianak': 'Indonesia',
  'Asia/Phnom_Penh': 'Cambodia', 'Asia/Vientiane': 'Laos', 'Asia/Yangon': 'Myanmar', 'Asia/Rangoon': 'Myanmar', 'Asia/Brunei': 'Brunei',
  // South, Central and West Asia
  'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Karachi': 'Pakistan', 'Asia/Dhaka': 'Bangladesh', 'Asia/Colombo': 'Sri Lanka',
  'Asia/Kathmandu': 'Nepal', 'Asia/Katmandu': 'Nepal', 'Asia/Almaty': 'Kazakhstan', 'Asia/Tashkent': 'Uzbekistan',
  'Asia/Dubai': 'United Arab Emirates', 'Asia/Riyadh': 'Saudi Arabia', 'Asia/Qatar': 'Qatar', 'Asia/Kuwait': 'Kuwait',
  'Asia/Jerusalem': 'Israel', 'Asia/Tel_Aviv': 'Israel', 'Asia/Tehran': 'Iran', 'Asia/Baghdad': 'Iraq', 'Asia/Amman': 'Jordan', 'Asia/Beirut': 'Lebanon',
  'Europe/Istanbul': 'Turkey', 'Asia/Istanbul': 'Turkey', Turkey: 'Turkey',
  // Oceania
  'Australia/Sydney': 'Australia', 'Australia/Melbourne': 'Australia', 'Australia/Brisbane': 'Australia', 'Australia/Perth': 'Australia',
  'Australia/Adelaide': 'Australia', 'Australia/Hobart': 'Australia', 'Australia/Darwin': 'Australia', 'Australia/Canberra': 'Australia',
  'Pacific/Auckland': 'New Zealand', NZ: 'New Zealand', 'Pacific/Guam': 'Guam', 'Pacific/Honolulu': 'United States',
  // Europe
  'Europe/London': 'United Kingdom', GB: 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Lisbon': 'Portugal', 'Europe/Madrid': 'Spain',
  'Europe/Paris': 'France', 'Europe/Brussels': 'Belgium', 'Europe/Amsterdam': 'Netherlands', 'Europe/Luxembourg': 'Luxembourg',
  'Europe/Berlin': 'Germany', 'Europe/Zurich': 'Switzerland', 'Europe/Vienna': 'Austria', 'Europe/Rome': 'Italy', 'Europe/Prague': 'Czechia',
  'Europe/Warsaw': 'Poland', 'Europe/Budapest': 'Hungary', 'Europe/Copenhagen': 'Denmark', 'Europe/Stockholm': 'Sweden', 'Europe/Oslo': 'Norway',
  'Europe/Helsinki': 'Finland', 'Europe/Tallinn': 'Estonia', 'Europe/Riga': 'Latvia', 'Europe/Vilnius': 'Lithuania', 'Europe/Athens': 'Greece',
  'Europe/Bucharest': 'Romania', 'Europe/Sofia': 'Bulgaria', 'Europe/Belgrade': 'Serbia', 'Europe/Zagreb': 'Croatia', 'Europe/Kyiv': 'Ukraine',
  'Europe/Kiev': 'Ukraine', 'Europe/Moscow': 'Russia', 'Europe/Minsk': 'Belarus', 'Asia/Yekaterinburg': 'Russia', 'Asia/Novosibirsk': 'Russia',
  'Asia/Vladivostok': 'Russia', 'Atlantic/Reykjavik': 'Iceland',
  // Americas
  'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Denver': 'United States', 'America/Phoenix': 'United States',
  'America/Los_Angeles': 'United States', 'America/Anchorage': 'United States', 'America/Detroit': 'United States', 'America/Boise': 'United States',
  'America/Indiana/Indianapolis': 'United States', 'America/Kentucky/Louisville': 'United States', 'US/Eastern': 'United States',
  'US/Central': 'United States', 'US/Mountain': 'United States', 'US/Pacific': 'United States',
  'America/Toronto': 'Canada', 'America/Vancouver': 'Canada', 'America/Edmonton': 'Canada', 'America/Winnipeg': 'Canada', 'America/Halifax': 'Canada',
  'America/St_Johns': 'Canada', 'America/Regina': 'Canada', 'America/Montreal': 'Canada',
  'America/Mexico_City': 'Mexico', 'America/Tijuana': 'Mexico', 'America/Monterrey': 'Mexico', 'America/Cancun': 'Mexico',
  'America/Sao_Paulo': 'Brazil', 'America/Manaus': 'Brazil', 'America/Fortaleza': 'Brazil', 'America/Recife': 'Brazil', 'America/Bahia': 'Brazil',
  'America/Argentina/Buenos_Aires': 'Argentina', 'America/Buenos_Aires': 'Argentina', 'America/Santiago': 'Chile', 'America/Bogota': 'Colombia',
  'America/Lima': 'Peru', 'America/Caracas': 'Venezuela', 'America/Montevideo': 'Uruguay', 'America/Guayaquil': 'Ecuador', 'America/La_Paz': 'Bolivia',
  'America/Panama': 'Panama', 'America/Costa_Rica': 'Costa Rica', 'America/Guatemala': 'Guatemala', 'America/Puerto_Rico': 'Puerto Rico',
  'America/Havana': 'Cuba', 'America/Santo_Domingo': 'Dominican Republic', 'America/Jamaica': 'Jamaica',
  // Africa
  'Africa/Cairo': 'Egypt', 'Africa/Johannesburg': 'South Africa', 'Africa/Lagos': 'Nigeria', 'Africa/Nairobi': 'Kenya', 'Africa/Casablanca': 'Morocco',
  'Africa/Algiers': 'Algeria', 'Africa/Tunis': 'Tunisia', 'Africa/Accra': 'Ghana', 'Africa/Addis_Ababa': 'Ethiopia',
};

/** The country a time zone mostly means, or "Other" (unknown, empty or generic zones like UTC). */
export function countryOf(tz: string): string {
  return ZONES[tz.trim()] ?? 'Other';
}

/** Players per country, most first ("Other" last among equals). */
export function countByCountry(zones: Iterable<string>): [country: string, players: number][] {
  const counts = new Map<string, number>();
  for (const tz of zones) { const c = countryOf(tz); counts.set(c, (counts.get(c) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : a[0].localeCompare(b[0])));
}
