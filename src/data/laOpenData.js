/**
 * ParceLLA — LA Open Data Integration
 *
 * Real endpoints. Requires:
 *   - SOCRATA_APP_TOKEN  (free at data.lacity.org)
 *   - ZILLOW_API_KEY     (Bridge Data Output, ~$200/mo)
 *   - COSTAR_API_KEY     (enterprise, ~$3–8K/mo)
 *
 * Set in .env:
 *   SOCRATA_APP_TOKEN=xxxx
 *   ZILLOW_API_KEY=xxxx
 */

const SOCRATA_BASE = 'https://data.lacity.org/resource';
const APP_TOKEN    = process.env.SOCRATA_APP_TOKEN ?? '';

function socrataHeaders() {
  const h = { 'Accept': 'application/json' };
  if (APP_TOKEN) h['X-App-Token'] = APP_TOKEN;
  return h;
}

/**
 * Fetch LADBS building permits
 * Dataset: nbyu-2ha9
 * Key fields: permitissuancedate, address, permittype, zone, workdescription, status
 */
export async function fetchPermits({ address, zone, limit = 50 } = {}) {
  const params = new URLSearchParams({ $limit: limit, $order: 'permitissuancedate DESC' });
  if (address) params.append('$where', `upper(addressstreet) LIKE '%${address.toUpperCase()}%'`);
  if (zone)    params.append('zonecode', zone);
  const url = `${SOCRATA_BASE}/nbyu-2ha9.json?${params}`;
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`LADBS API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Fetch RTI / plan check status
 * Dataset: 9t2t-sksn (building cases)
 */
export async function fetchRTIStatus(address) {
  const params = new URLSearchParams({
    $where: `upper(address) LIKE '%${address.toUpperCase()}%'`,
    $limit: 10,
  });
  const url = `${SOCRATA_BASE}/9t2t-sksn.json?${params}`;
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`Plan check API ${res.status}`);
  const data = await res.json();
  return data.map(d => ({
    caseNumber: d.case_number,
    address:    d.address,
    status:     d.status,
    type:       d.case_type,
    filed:      d.date_filed,
    approved:   d.date_approved,
    isRTI:      d.status?.toLowerCase().includes('rti') ||
                d.status?.toLowerCase().includes('approved'),
  }));
}

/**
 * Fetch zoning data
 * Dataset: qv65-mhbd
 */
export async function fetchZoning({ lat, lng, address } = {}) {
  const params = new URLSearchParams({ $limit: 5 });
  if (address) params.append('$where', `upper(address) LIKE '%${address.toUpperCase()}%'`);
  const url = `${SOCRATA_BASE}/qv65-mhbd.json?${params}`;
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`Zoning API ${res.status}`);
  return res.json();
}

/**
 * Fetch RSO (Rent Stabilization Ordinance) status
 * Dataset: tqzr-k54n
 */
export async function fetchRSOStatus(address) {
  const params = new URLSearchParams({
    $where: `upper(property_address) LIKE '%${address.toUpperCase()}%'`,
    $limit: 1,
  });
  const url = `${SOCRATA_BASE}/tqzr-k54n.json?${params}`;
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0]?.rso_status ?? null;
}

/**
 * Zillow rent comp estimate via Bridge Data Output
 * Returns median rent by bedroom count for a zip code
 */
export async function fetchZillowRentComps(zipCode) {
  const ZILLOW_KEY = process.env.ZILLOW_API_KEY;
  if (!ZILLOW_KEY) {
    console.warn('ZILLOW_API_KEY not set — returning null');
    return null;
  }
  const url = `https://api.bridgedataoutput.com/api/v2/zestimates?` +
    `access_token=${ZILLOW_KEY}&postal_code=${zipCode}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Census ACS — median household income + renter % by tract
 * Free, no key needed for basic queries
 */
export async function fetchCensusData(lat, lng) {
  // Step 1: geocode to FIPS tract
  const geo = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
    `?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`
  );
  const geoData = await geo.json();
  const tract = geoData.result?.geographies?.['Census Tracts']?.[0];
  if (!tract) return null;

  const { STATE: state, COUNTY: county, TRACT: tractCode } = tract;

  // Step 2: fetch ACS variables
  const acsUrl =
    `https://api.census.gov/data/2022/acs/acs5?` +
    `get=B19013_001E,B25003_001E,B25003_003E&` +
    `for=tract:${tractCode}&in=state:${state}+county:${county}`;
  const acs = await fetch(acsUrl);
  const acsData = await acs.json();
  if (!acsData[1]) return null;

  const [medianIncome, totalHH, renterHH] = acsData[1];
  return {
    medianHouseholdIncome: +medianIncome,
    renterHouseholds:      +renterHH,
    totalHouseholds:       +totalHH,
    renterPct:             Math.round(renterHH / totalHH * 100),
  };
}

/**
 * Enrich a site object with all available data sources
 */
export async function enrichSite(site) {
  const [permits, rso, zoning] = await Promise.allSettled([
    fetchPermits({ address: site.address }),
    fetchRSOStatus(site.address),
    fetchZoning({ address: site.address }),
  ]);

  return {
    ...site,
    permits:    permits.status === 'fulfilled'  ? permits.value  : [],
    rsoStatus:  rso.status     === 'fulfilled'  ? rso.value      : null,
    zoningData: zoning.status  === 'fulfilled'  ? zoning.value   : [],
  };
}
