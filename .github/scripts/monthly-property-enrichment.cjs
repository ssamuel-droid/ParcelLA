// ParceLLA - monthly external property data enrichment.
//
// This job keeps paid data usage predictable:
// 1) Pulls market-level RentCast rent listings and recent sales by zip once monthly.
// 2) Optionally enriches a capped number of individual sites with property records.
// 3) Stores everything in Supabase so the app, Excel, and PDF can use cached data.

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const RENTCAST_KEY = process.env.RENTCAST_API_KEY;

const SITE_LIMIT = intEnv('PROPERTY_ENRICH_SITE_LIMIT', 25);
const MARKET_LIMIT = intEnv('PROPERTY_ENRICH_MARKET_LIMIT', 500);
const STALE_DAYS = intEnv('PROPERTY_ENRICH_STALE_DAYS', 30);
const SALE_RECENCY_DAYS = intEnv('PROPERTY_ENRICH_SALE_RECENCY_DAYS', 1095);
const REQUEST_DELAY_MS = intEnv('PROPERTY_ENRICH_DELAY_MS', 250);
const INCLUDE_SITE_AVM = /^(1|true|yes)$/i.test(process.env.PROPERTY_ENRICH_AVM || '');

const HOOD_ZIPS = {
  'Silver Lake': '90026',
  'Echo Park': '90026',
  'Highland Park': '90042',
  'Los Feliz': '90027',
  Koreatown: '90006',
  'Mid-Wilshire': '90036',
  Hollywood: '90028',
  'West Adams': '90016',
  'Boyle Heights': '90033',
  'Culver City': '90232',
  'Mar Vista': '90066',
  Venice: '90291',
  'West LA': '90064',
  Brentwood: '90049',
  'Pacific Palisades': '90272',
  'Studio City': '91604',
  'Sherman Oaks': '91423',
  Encino: '91316',
  'Van Nuys': '91405',
  'North Hollywood': '91601',
  'Woodland Hills': '91364',
  Reseda: '91335',
  Northridge: '91325',
};

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text && text !== '0' && text.toLowerCase() !== 'null' ? text : '';
}

function asNumber(value) {
  const n = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  const n = asNumber(value);
  return n && n > 0 ? Math.round(n) : null;
}

function cleanDate(value) {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.slice(0, 10);
}

function normalizeAddress(address) {
  return clean(address)
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fullAddress(address) {
  const text = clean(address);
  if (!text) return '';
  if (/\bCA\b|CALIFORNIA|LOS ANGELES/i.test(text)) return text;
  return `${text}, Los Angeles, CA`;
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.data || payload?.results || payload?.records || payload?.listings || payload?.properties || [];
}

function rentcastType(type) {
  const text = clean(type);
  if (/house|single/i.test(text)) return 'Single Family';
  if (/condo/i.test(text)) return 'Condo';
  if (/town/i.test(text)) return 'Townhouse';
  if (/mixed|multi/i.test(text)) return 'Apartment';
  return 'Apartment';
}

function compactRentListing(r) {
  const lat = r.latitude ?? r.lat;
  const lng = r.longitude ?? r.lng;
  return {
    id: r.id || null,
    propertyName: r.propertyName || r.name || null,
    formattedAddress: r.formattedAddress || [r.addressLine1, r.city, r.state, r.zipCode].filter(Boolean).join(', '),
    addressLine1: r.addressLine1 || null,
    city: r.city || null,
    state: r.state || null,
    zipCode: r.zipCode || r.zip || null,
    latitude: asNumber(lat),
    longitude: asNumber(lng),
    propertyType: r.propertyType || null,
    bedrooms: asNumber(r.bedrooms ?? r.beds),
    bathrooms: asNumber(r.bathrooms ?? r.baths),
    price: money(r.price ?? r.rent ?? r.monthlyRent),
    squareFootage: asNumber(r.squareFootage ?? r.livingArea),
    yearBuilt: asNumber(r.yearBuilt),
    units: asNumber(r.units ?? r.numberOfUnits ?? r.propertyUnits),
    listedDate: cleanDate(r.listedDate),
    lastSeenDate: cleanDate(r.lastSeenDate || r.updatedDate),
    status: r.status || null,
    url: r.url || r.listingUrl || null,
    amenities: r.amenities || r.features || null,
  };
}

function compactPropertyRecord(r) {
  const lat = r.latitude ?? r.lat;
  const lng = r.longitude ?? r.lng;
  const ownerName = first(
    r.ownerName,
    r.owner,
    r.owner1,
    r.owner_name,
    r.ownerNames?.[0],
    r.taxAssessments?.[0]?.ownerName
  );
  const salePrice = money(
    r.lastSalePrice,
    r.lastSoldPrice,
    r.salePrice,
    r.price,
    r.saleHistory?.[0]?.price,
    r.saleHistory?.[0]?.salePrice
  );
  const saleDate = cleanDate(
    r.lastSaleDate,
    r.lastSoldDate,
    r.saleDate,
    r.saleHistory?.[0]?.date,
    r.saleHistory?.[0]?.saleDate
  );
  const units = asNumber(r.units ?? r.numberOfUnits ?? r.propertyUnits ?? r.unitCount);
  const sf = asNumber(r.squareFootage ?? r.livingArea ?? r.buildingArea);
  return {
    id: r.id || null,
    formattedAddress: r.formattedAddress || [r.addressLine1, r.city, r.state, r.zipCode].filter(Boolean).join(', '),
    addressLine1: r.addressLine1 || null,
    city: r.city || null,
    state: r.state || null,
    zipCode: r.zipCode || r.zip || null,
    latitude: asNumber(lat),
    longitude: asNumber(lng),
    propertyType: r.propertyType || null,
    bedrooms: asNumber(r.bedrooms),
    bathrooms: asNumber(r.bathrooms),
    squareFootage: sf,
    lotSize: asNumber(r.lotSize),
    yearBuilt: asNumber(r.yearBuilt),
    units,
    ownerName,
    lastSaleDate: saleDate,
    lastSalePrice: salePrice,
    pricePerUnit: salePrice && units ? Math.round(salePrice / units) : null,
    pricePerSf: salePrice && sf ? Math.round(salePrice / sf) : null,
    taxAssessment: r.taxAssessment || r.assessment || null,
    taxAmount: money(r.taxAmount ?? r.propertyTaxAmount),
  };
}

function compProjectType(value) {
  const type = clean(value).toLowerCase();
  if (type === 'single family') return 'New House';
  if (type === 'condo' || type === 'townhouse') return 'Condo/TH';
  if (type === 'multi-family' || type === 'apartment') return 'Multifamily';
  return clean(value) || 'New House';
}

async function upsertRecentSaleComps(hood, rows) {
  const comps = (rows || []).map(record => {
    const salePrice = money(record.lastSalePrice);
    const saleDate = cleanDate(record.lastSaleDate);
    const address = clean(record.formattedAddress);
    if (!salePrice || !saleDate || !address) return null;

    const projectType = compProjectType(record.propertyType);
    const units = projectType === 'New House' ? 1 : asNumber(record.units);
    const buildingSf = asNumber(record.squareFootage);
    const avgUnitSf = buildingSf && units ? Math.round(buildingSf / units) : null;
    const stableId = clean(record.id) || normalizeAddress(address);
    return {
      address,
      neighborhood: hood,
      zip: clean(record.zipCode) || null,
      lat: asNumber(record.latitude),
      lng: asNumber(record.longitude),
      project_type: projectType,
      units,
      avg_unit_sf: avgUnitSf,
      year_built: asNumber(record.yearBuilt),
      sale_price: salePrice,
      sale_date: saleDate,
      price_per_unit: units ? Math.round(salePrice / units) : null,
      price_per_sf: buildingSf ? Math.round(salePrice / buildingSf) : null,
      buyer: clean(record.ownerName) || null,
      source: 'RentCast monthly property records',
      recorder_document_number: `rentcast:${stableId}:${saleDate}`,
      sale_price_confidence: 'reported',
      sale_price_method: 'monthly cache',
      notes: 'Cached monthly property sale used as an acquisition-basis comp.',
      raw_record: record,
    };
  }).filter(Boolean);

  for (let offset = 0; offset < comps.length; offset += 200) {
    await sbRequest(
      'POST',
      '/rest/v1/sold_comps?on_conflict=recorder_document_number',
      comps.slice(offset, offset + 200),
      'resolution=merge-duplicates,return=minimal'
    );
  }
  return comps.length;
}

function compactAvm(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    price: money(payload.price),
    priceRangeLow: money(payload.priceRangeLow),
    priceRangeHigh: money(payload.priceRangeHigh),
    rent: money(payload.rent),
    rentRangeLow: money(payload.rentRangeLow),
    rentRangeHigh: money(payload.rentRangeHigh),
    subjectProperty: payload.subjectProperty || null,
    comparables: arrayFromPayload(payload.comparables || payload.comps || []).slice(0, 15),
  };
}

async function requestJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const msg = json?.message || json?.error || text.slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return { json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function sbRequest(method, path, body = null, prefer = '') {
  const url = `${SB_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.error || text.slice(0, 300);
    throw new Error(`Supabase ${res.status}: ${msg}`);
  }
  return json;
}

function cacheExpiry() {
  return new Date(Date.now() + STALE_DAYS * 86400000).toISOString();
}

async function upsertCache(row) {
  await sbRequest(
    'POST',
    '/rest/v1/property_enrichment_cache?on_conflict=provider,purpose,cache_key',
    row,
    'resolution=merge-duplicates,return=minimal'
  );
}

async function patchSite(siteId, patch) {
  if (!siteId || !Object.keys(patch).length) return;
  await sbRequest(
    'PATCH',
    `/rest/v1/sites?id=eq.${encodeURIComponent(siteId)}`,
    patch,
    'return=minimal'
  );
}

async function fetchMarkets() {
  const rows = await sbRequest(
    'GET',
    '/rest/v1/sites?select=neighborhood&neighborhood=not.is.null&limit=1000'
  ).catch(() => []);
  const names = new Set(Object.keys(HOOD_ZIPS));
  for (const row of rows || []) {
    const hood = clean(row.neighborhood);
    if (hood && HOOD_ZIPS[hood]) names.add(hood);
  }
  return [...names].sort();
}

async function fetchSitesForPropertyRecords() {
  if (!SITE_LIMIT) return [];
  const columns = [
    'id',
    'address',
    'lat',
    'lng',
    'apn',
    'units',
    'avg_unit_sf',
    'project_type',
    'neighborhood',
    'owner_name',
    'owner_enriched_at',
  ].join(',');
  return await sbRequest(
    'GET',
    `/rest/v1/sites?select=${columns}&address=not.is.null&order=owner_enriched_at.asc.nullsfirst&limit=${SITE_LIMIT}`
  );
}

async function pullRentcastRentalListings(hood, zip) {
  const params = new URLSearchParams({
    zipCode: zip,
    propertyType: 'Apartment',
    status: 'Active',
    limit: String(Math.min(MARKET_LIMIT, 500)),
  });
  const { json, headers } = await requestJson(
    `https://api.rentcast.io/v1/listings/rental/long-term?${params}`,
    { 'X-Api-Key': RENTCAST_KEY }
  );
  const rows = arrayFromPayload(json).map(compactRentListing).filter(r => r.formattedAddress && r.price);
  await upsertCache({
    provider: 'rentcast',
    purpose: 'rental_listings',
    cache_key: `zip:${zip}`,
    address: hood,
    status: 'ok',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: { hood, zip, endpoint: '/listings/rental/long-term', totalCount: headers.get('x-total-count') || null },
    payload: { sampleCount: rows.length },
    normalized: { hood, zip, rows },
  });
  return rows.length;
}

async function pullRentcastRecentSales(hood, zip) {
  const params = new URLSearchParams({
    zipCode: zip,
    propertyType: 'Single Family|Condo|Townhouse|Multi-Family|Apartment',
    saleDateRange: String(SALE_RECENCY_DAYS),
    limit: String(Math.min(MARKET_LIMIT, 500)),
  });
  const { json, headers } = await requestJson(
    `https://api.rentcast.io/v1/properties?${params}`,
    { 'X-Api-Key': RENTCAST_KEY }
  );
  const rows = arrayFromPayload(json).map(compactPropertyRecord).filter(r => r.formattedAddress && r.lastSalePrice && r.lastSaleDate);
  const storedCompCount = await upsertRecentSaleComps(hood, rows);
  await upsertCache({
    provider: 'rentcast',
    purpose: 'recent_sales',
    cache_key: `zip:${zip}`,
    address: hood,
    status: 'ok',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: { hood, zip, endpoint: '/properties', saleDateRange: SALE_RECENCY_DAYS, totalCount: headers.get('x-total-count') || null },
    payload: { sampleCount: rows.length, storedCompCount },
    normalized: { hood, zip, rows },
  });
  return storedCompCount;
}

async function pullRentcastPropertyRecord(site) {
  const address = fullAddress(site.address);
  if (!address) return null;
  const params = new URLSearchParams({
    address,
    limit: '1',
  });
  const { json } = await requestJson(
    `https://api.rentcast.io/v1/properties?${params}`,
    { 'X-Api-Key': RENTCAST_KEY }
  );
  const rows = arrayFromPayload(json).map(compactPropertyRecord).filter(r => r.formattedAddress);
  const record = rows[0] || null;
  await upsertCache({
    site_id: site.id,
    provider: 'rentcast',
    purpose: 'property_record',
    cache_key: `site:${site.id}`,
    address: site.address,
    lat: asNumber(site.lat),
    lng: asNumber(site.lng),
    status: record ? 'ok' : 'miss',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: { endpoint: '/properties', address },
    payload: { sampleCount: rows.length },
    normalized: { record },
  });
  return record;
}

async function pullRentcastAvm(site, endpoint, purpose) {
  const address = fullAddress(site.address);
  if (!address) return null;
  const params = new URLSearchParams({
    address,
    propertyType: rentcastType(site.project_type),
    maxRadius: '3',
    daysOld: String(SALE_RECENCY_DAYS),
    compCount: '10',
    lookupSubjectAttributes: 'true',
  });
  const { json } = await requestJson(
    `https://api.rentcast.io/v1/avm/${endpoint}?${params}`,
    { 'X-Api-Key': RENTCAST_KEY }
  );
  const avm = compactAvm(json);
  await upsertCache({
    site_id: site.id,
    provider: 'rentcast',
    purpose,
    cache_key: `site:${site.id}`,
    address: site.address,
    lat: asNumber(site.lat),
    lng: asNumber(site.lng),
    status: avm ? 'ok' : 'miss',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: { endpoint: `/avm/${endpoint}`, address },
    payload: { hasPayload: !!json },
    normalized: avm || {},
  });
  return avm;
}

async function enrichSite(site) {
  const now = new Date().toISOString();
  const propertyRecord = await pullRentcastPropertyRecord(site);
  const patch = {
    external_enriched_at: now,
    rentcast_enriched_at: now,
    external_data_sources: ['RentCast monthly property records'],
    data_quality: {
      rentcast: propertyRecord ? 'property_record_cached' : 'no_property_record_match',
      rentcastEnrichedAt: now,
      monthlyCache: true,
    },
    external_property_record: propertyRecord,
  };

  if (propertyRecord?.ownerName) {
    patch.owner_name = propertyRecord.ownerName;
    patch.owner_source = 'RentCast monthly property records';
    patch.owner_enriched_at = now;
  }
  if (propertyRecord?.lastSaleDate) patch.owner_last_sale_date = propertyRecord.lastSaleDate;
  if (propertyRecord?.lastSalePrice) patch.owner_last_sale_amount = propertyRecord.lastSalePrice;

  if (INCLUDE_SITE_AVM) {
    const rentAvm = await pullRentcastAvm(site, 'rent/long-term', 'rent_avm').catch(err => {
      console.warn(`[monthly-enrich] Rent AVM failed for ${site.address}: ${err.message}`);
      return null;
    });
    await sleep(REQUEST_DELAY_MS);
    const valueAvm = await pullRentcastAvm(site, 'value', 'value_avm').catch(err => {
      console.warn(`[monthly-enrich] Value AVM failed for ${site.address}: ${err.message}`);
      return null;
    });
    patch.external_rent_estimate = rentAvm;
    patch.external_value_estimate = valueAvm;
    patch.external_rent_comps = rentAvm?.comparables || [];
    patch.external_sale_comps = valueAvm?.comparables || [];
  }

  await patchSite(site.id, patch);
  return propertyRecord ? 'updated' : 'miss';
}

async function main() {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  if (!RENTCAST_KEY) {
    console.log('[monthly-enrich] RENTCAST_API_KEY not set; nothing to pull. Add it as a GitHub secret before running monthly enrichment.');
    return;
  }

  let marketRequests = 0;
  let rentalRows = 0;
  let saleRows = 0;
  const markets = await fetchMarkets();
  const seenZips = new Set();
  for (const hood of markets) {
    const zip = HOOD_ZIPS[hood];
    if (!zip || seenZips.has(zip)) continue;
    seenZips.add(zip);
    try {
      const count = await pullRentcastRentalListings(hood, zip);
      marketRequests++;
      rentalRows += count;
      console.log(`[monthly-enrich] ${hood} ${zip}: cached ${count} rental listing(s).`);
    } catch (err) {
      console.warn(`[monthly-enrich] Rental listings failed for ${hood} ${zip}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
    try {
      const count = await pullRentcastRecentSales(hood, zip);
      marketRequests++;
      saleRows += count;
      console.log(`[monthly-enrich] ${hood} ${zip}: cached ${count} recent sale record(s).`);
    } catch (err) {
      console.warn(`[monthly-enrich] Recent sales failed for ${hood} ${zip}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  let siteUpdated = 0;
  let siteMiss = 0;
  let schemaWarningShown = false;
  const sites = await fetchSitesForPropertyRecords();
  for (const site of sites || []) {
    try {
      const status = await enrichSite(site);
      if (status === 'updated') siteUpdated++;
      else siteMiss++;
      console.log(`[monthly-enrich] ${site.address}: ${status}.`);
    } catch (err) {
      if (!schemaWarningShown && /property_enrichment_cache|external_|rentcast_|data_quality|schema cache|column|relation/i.test(err.message)) {
        console.warn('[monthly-enrich] The monthly cache schema is missing. Run supabase/migrations/010_monthly_property_enrichment.sql, then rerun this workflow.');
        schemaWarningShown = true;
      }
      console.warn(`[monthly-enrich] Site enrichment failed for ${site.address}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[monthly-enrich] Complete. Market API calls: ${marketRequests}; cached rentals: ${rentalRows}; cached recent sales: ${saleRows}; site records updated: ${siteUpdated}; site misses: ${siteMiss}.`);
}

main().catch(err => {
  console.error('[monthly-enrich] Fatal:', err.message);
  process.exit(1);
});
