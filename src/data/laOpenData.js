/**
 * ParceLLA — LA Open Data Integration
 *
 * Covers all four free data sources:
 *   1. LA City Open Data (Socrata) — LADBS permits, RTI, zoning, RSO
 *   2. US Census Bureau — geocoder + ACS demographics
 *   3. Mapbox — geocoding + tile rendering (frontend only)
 *   4. Supabase — handled separately via supabase-js client
 *
 * Required env vars:
 *   SOCRATA_APP_TOKEN  — data.lacity.org/profile/edit/developer_settings
 *   CENSUS_API_KEY     — api.census.gov/data/key_signup.html
 *   MAPBOX_TOKEN       — account.mapbox.com (used in frontend)
 */

const SOCRATA_BASE = 'https://data.lacity.org/resource';

function socrataHeaders() {
  // Socrata only needs X-App-Token header — no Basic auth needed
  const token = process.env.SOCRATA_APP_TOKEN;
  return {
    'Accept': 'application/json',
    ...(token ? { 'X-App-Token': token } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LADBS PERMITS
// Dataset: 6q2s-9pnn
// Docs: https://data.lacity.org/Building-Safety/Building-Permits/6q2s-9pnn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch recent LADBS building permits
 * @param {Object} opts
 * @param {string} opts.address  — partial street address filter
 * @param {string} opts.zone     — zoning code filter
 * @param {string} opts.type     — permit type (BLDG, ELEC, PLMB, etc.)
 * @param {number} opts.limit    — max results (default 50)
 */
export async function fetchPermits({ address, zone, type, limit = 50 } = {}) {
  const where = [];
  if (address) where.push(`upper(addressstreet) LIKE '%${address.toUpperCase()}%'`);
  if (zone)    where.push(`zonecode = '${zone}'`);
  if (type)    where.push(`permittype = '${type}'`);

  const params = new URLSearchParams({
    $limit:  limit,
    $order: 'permitissuancedate DESC',
    ...(where.length ? { $where: where.join(' AND ') } : {}),
  });

  const url = `${SOCRATA_BASE}/6q2s-9pnn.json?${params}`;
  console.log('[socrata] Fetching:', url);
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LADBS permits: HTTP ${res.status} — ${body.slice(0,200)}`);
  }
  const data = await res.json();

  return data.map(p => ({
    permitNumber:    p.permitnum,
    address:         `${p.addresshouse} ${p.addressstreet}`,
    type:            p.permittype,
    subType:         p.permitsubtype,
    status:          p.statuscurrent,
    zone:            p.zonecode,
    issued:          p.permitissuancedate,
    expires:         p.permitexpiredate,
    description:     p.workdescription,
    valuation:       p.approvedvaluation ? +p.approvedvaluation : null,
    units:           p.numberofunits ? +p.numberofunits : null,
    lat:             p.latitude ? +p.latitude : null,
    lng:             p.longitude ? +p.longitude : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// RTI / PLAN CHECK STATUS
// Dataset: 9t2t-sksn (building cases)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchRTIStatus(address) {
  const params = new URLSearchParams({
    $where: `upper(address) LIKE '%${address.toUpperCase()}%'`,
    $limit: 10,
    $order: 'date_filed DESC',
  });

  const res = await fetch(`${SOCRATA_BASE}/9t2t-sksn.json?${params}`, {
    headers: socrataHeaders(),
  });
  if (!res.ok) throw new Error(`Plan check: HTTP ${res.status}`);
  const data = await res.json();

  return data.map(d => ({
    caseNumber: d.case_number,
    address:    d.address,
    status:     d.status,
    type:       d.case_type,
    filed:      d.date_filed,
    approved:   d.date_approved,
    isRTI:
      d.status?.toLowerCase().includes('rti') ||
      d.status?.toLowerCase().includes('ready to issue') ||
      d.status?.toLowerCase().includes('approved for permit'),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ZONING
// Dataset: qv65-mhbd
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchZoning({ address, limit = 5 } = {}) {
  const params = new URLSearchParams({ $limit: limit });
  if (address) {
    params.set('$where', `upper(address) LIKE '%${address.toUpperCase()}%'`);
  }

  const res = await fetch(`${SOCRATA_BASE}/qv65-mhbd.json?${params}`, {
    headers: socrataHeaders(),
  });
  if (!res.ok) throw new Error(`Zoning: HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// RSO (Rent Stabilization Ordinance)
// Dataset: tqzr-k54n
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchRSOStatus(address) {
  const params = new URLSearchParams({
    $where: `upper(property_address) LIKE '%${address.toUpperCase()}%'`,
    $limit: 1,
  });

  const res = await fetch(`${SOCRATA_BASE}/tqzr-k54n.json?${params}`, {
    headers: socrataHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;

  return {
    rsoStatus:    data[0].rso_status,
    units:        data[0].number_of_units ? +data[0].number_of_units : null,
    yearBuilt:    data[0].year_built,
    address:      data[0].property_address,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CENSUS — GEOCODER + ACS DEMOGRAPHICS
// Free, no key required (key removes 500 req/day cap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geocode an address to Census tract + FIPS codes
 */
export async function censusGeocode(address) {
  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage:   'Current_Current',
    format:    'json',
  });

  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${params}`
  );
  if (!res.ok) throw new Error(`Census geocoder: HTTP ${res.status}`);
  const data = await res.json();

  const match = data.result?.addressMatches?.[0];
  if (!match) throw new Error('No Census geocode match for address');

  const tract = match.geographies?.['Census Tracts']?.[0];
  if (!tract) throw new Error('No Census tract found');

  return {
    lat:    +match.coordinates.y,
    lng:    +match.coordinates.x,
    state:  tract.STATE,
    county: tract.COUNTY,
    tract:  tract.TRACT,
    geoid:  tract.GEOID,
  };
}

/**
 * Fetch ACS 5-year demographic estimates for a Census tract
 * Variables:
 *   B19013_001E — median household income
 *   B25003_001E — total housing units
 *   B25003_003E — renter-occupied units
 *   B01003_001E — total population
 */
export async function fetchCensusACS(state, county, tract) {
  const key = process.env.CENSUS_API_KEY;
  const params = new URLSearchParams({
    get:  'B19013_001E,B25003_001E,B25003_003E,B01003_001E',
    for:  `tract:${tract}`,
    in:   `state:${state}+county:${county}`,
    ...(key ? { key } : {}),
  });

  const res = await fetch(`https://api.census.gov/data/2022/acs/acs5?${params}`);
  if (!res.ok) throw new Error(`Census ACS: HTTP ${res.status}`);
  const rows = await res.json();

  // rows[0] = headers, rows[1] = data
  if (rows.length < 2) throw new Error('No ACS data returned');
  const [headers, values] = rows;
  const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));

  const totalHH  = +row.B25003_001E;
  const renterHH = +row.B25003_003E;

  return {
    medianHouseholdIncome: +row.B19013_001E,
    totalPopulation:       +row.B01003_001E,
    totalHousingUnits:     totalHH,
    renterHouseholds:      renterHH,
    renterPct:             totalHH > 0 ? Math.round(renterHH / totalHH * 100) : null,
    ownerPct:              totalHH > 0 ? Math.round((totalHH - renterHH) / totalHH * 100) : null,
    tract, county, state,
  };
}

/**
 * One-shot: geocode address → fetch ACS demographics
 */
export async function getDemographics(address) {
  const geo = await censusGeocode(address);
  const acs = await fetchCensusACS(geo.state, geo.county, geo.tract);
  return { ...geo, ...acs };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPBOX GEOCODING (server-side address → lat/lng)
// Token: process.env.MAPBOX_TOKEN
// Note: tile rendering is handled client-side via mapbox-gl-js
// ─────────────────────────────────────────────────────────────────────────────

export async function mapboxGeocode(address) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error('MAPBOX_TOKEN not set');

  const encoded = encodeURIComponent(`${address}, Los Angeles, CA`);
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${token}&country=US&limit=1&types=address`
  );
  if (!res.ok) throw new Error(`Mapbox geocoding: HTTP ${res.status}`);
  const data = await res.json();

  const feature = data.features?.[0];
  if (!feature) throw new Error('No Mapbox geocode result');

  const [lng, lat] = feature.geometry.coordinates;
  return {
    lat,
    lng,
    placeName: feature.place_name,
    accuracy:  feature.properties?.accuracy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SITE ENRICHMENT — runs all sources in parallel for a given site
// ─────────────────────────────────────────────────────────────────────────────

export async function enrichSite(site) {
  const [permits, rtiStatus, rso, zoning, demographics, geocode] =
    await Promise.allSettled([
      fetchPermits({ address: site.address, limit: 10 }),
      fetchRTIStatus(site.address),
      fetchRSOStatus(site.address),
      fetchZoning({ address: site.address }),
      getDemographics(`${site.address}, Los Angeles CA`),
      mapboxGeocode(site.address),
    ]);

  const val = r => r.status === 'fulfilled' ? r.value : null;

  return {
    ...site,
    permits:      val(permits)      ?? [],
    rtiStatus:    val(rtiStatus)    ?? [],
    rsoStatus:    val(rso),
    zoningData:   val(zoning)       ?? [],
    demographics: val(demographics),
    coordinates:  val(geocode),
    enrichedAt:   new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW HOUSING UNITS
// Dataset: cpkv-aajs — tracks new residential units permitted in LA
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchNewHousingUnits({ neighborhood, limit = 100 } = {}) {
  const params = new URLSearchParams({ $limit: limit, $order: 'date DESC' });
  if (neighborhood) params.set('$where', `upper(community_plan_area) LIKE '%${neighborhood.toUpperCase()}%'`);

  const url = `${SOCRATA_BASE}/cpkv-aajs.json?${params}`;
  console.log('[socrata] Fetching new housing units:', url);
  const res = await fetch(url, { headers: socrataHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`New housing units: HTTP ${res.status} — ${body.slice(0,200)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// DBS PERMITS — t57t-h8jb
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchDBSPermits({ address, limit = 100 } = {}) {
  const params = new URLSearchParams({ $limit: limit, $order: 'issue_date DESC' });
  if (address) params.set('$where', `upper(address) LIKE '%${address.toUpperCase()}%'`);
  const res = await fetch(`${SOCRATA_BASE}/t57t-h8jb.json?${params}`, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`DBS permits: HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// DBS PERMITS 2 — peyn-q7x3
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchDBSPermits2({ limit = 100 } = {}) {
  const params = new URLSearchParams({ $limit: limit });
  const res = await fetch(`${SOCRATA_BASE}/peyn-q7x3.json?${params}`, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`DBS permits 2: HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS GEOCODING (replaces Mapbox server-side geocoding)
// Uses the same API key as the frontend map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geocode an LA address using Google Geocoding API
 * More accurate than Mapbox for LA street addresses
 */
export async function googleGeocode(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const encoded = encodeURIComponent(`${address}, Los Angeles, CA`);
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${key}&region=us`
  );
  if (!res.ok) throw new Error(`Google Geocoding: ${res.status}`);

  const data = await res.json();
  if (data.status !== 'OK' || !data.results.length) {
    throw new Error(`No geocode result: ${data.status} — ${address}`);
  }

  const result = data.results[0];
  const loc    = result.geometry.location;

  // Extract address components
  const components = {};
  result.address_components.forEach(c => {
    c.types.forEach(t => { components[t] = c.long_name; });
  });

  return {
    lat:              loc.lat,
    lng:              loc.lng,
    formattedAddress: result.formatted_address,
    zip:              components.postal_code,
    neighborhood:     components.neighborhood,
    city:             components.locality,
    county:           components.administrative_area_level_2,
    accuracy:         result.geometry.location_type,  // ROOFTOP, RANGE_INTERPOLATED, etc.
  };
}

/**
 * Batch geocode multiple addresses (respects 50 req/s limit)
 */
export async function batchGeocode(addresses, delayMs = 20) {
  const results = [];
  for (const address of addresses) {
    try {
      const r = await googleGeocode(address);
      results.push({ address, ...r, error: null });
    } catch (e) {
      results.push({ address, error: e.message });
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

/**
 * Street View Static API — returns image URL for a location
 * Used in PDF deal memos and email templates
 */
export function streetViewImageURL(lat, lng, options = {}) {
  const key    = process.env.GOOGLE_MAPS_API_KEY;
  const size   = options.size    ?? '600x300';
  const fov    = options.fov     ?? 90;
  const heading = options.heading ?? 0;
  const pitch  = options.pitch   ?? 10;
  return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&fov=${fov}&heading=${heading}&pitch=${pitch}&key=${key}`;
}
