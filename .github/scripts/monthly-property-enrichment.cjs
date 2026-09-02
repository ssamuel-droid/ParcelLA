// ParceLLA - monthly external property data enrichment.
//
// This job keeps paid data usage predictable:
// 1) Pulls market-level RentCast rent listings and recent sales by zip once monthly.
// 2) Optionally enriches a capped number of individual sites with property records.
// 3) Stores everything in Supabase so the app, Excel, and PDF can use cached data.

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const RENTCAST_KEY = process.env.RENTCAST_API_KEY;
const ATTOM_KEY = process.env.ATTOM_API_KEY;

const SITE_LIMIT = intEnv('PROPERTY_ENRICH_SITE_LIMIT', 5);
const MARKET_LIMIT = intEnv('PROPERTY_ENRICH_MARKET_LIMIT', 500);
const STALE_DAYS = intEnv('PROPERTY_ENRICH_STALE_DAYS', 30);
const SALE_RECENCY_DAYS = intEnv('PROPERTY_ENRICH_SALE_RECENCY_DAYS', 1095);
const REQUEST_DELAY_MS = intEnv('PROPERTY_ENRICH_DELAY_MS', 250);
const MAX_RENTCAST_CALLS = intEnv('PROPERTY_ENRICH_MAX_RENTCAST_CALLS', 50);
const MAX_ATTOM_CALLS = intEnv('PROPERTY_ENRICH_MAX_ATTOM_CALLS', 5);
const INCLUDE_SITE_AVM = /^(1|true|yes)$/i.test(process.env.PROPERTY_ENRICH_AVM || '');
const RENTCAST_SALE_SOURCE = 'RentCast monthly property records';
const ATTOM_MORTGAGE_SOURCE = 'ATTOM monthly mortgage records';
const RENTCAST_SEARCH_RADIUS_MILES = 0.12;
let rentcastCallCount = 0;
let attomCallCount = 0;

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
  if (value !== null && typeof value === 'object') return '';
  const text = String(value ?? '').trim();
  return text && text !== '0' && text.toLowerCase() !== 'null' ? text : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeApns(...values) {
  const found = [];
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined || typeof value === 'object') return;
    const matches = String(value).match(/\b(?:\d{8,14}|\d{4}[\s-]\d{3}[\s-]\d{3})\b/g) || [];
    for (const match of matches) {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 14) found.push(digits);
    }
  };
  values.forEach(visit);
  return unique(found).slice(0, 50);
}

function ownerNameParts(value) {
  if (Array.isArray(value)) return value.flatMap(ownerNameParts);
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') {
    const text = clean(value);
    return text && text !== '[object Object]' ? [text] : [];
  }

  const named = [
    value.fullName,
    value.name,
    value.ownerName,
    value.companyName,
    value.organizationName,
    value.entityName,
  ].map(clean).filter(Boolean);
  if (named.length) return named;

  const person = [value.firstName, value.middleName, value.lastName]
    .map(clean)
    .filter(Boolean)
    .join(' ');
  return person ? [person] : [];
}

function latestRentCastSale(record) {
  return rentCastSaleHistory(record)[0] || null;
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

function rentCastSaleHistory(record) {
  if (!record || typeof record !== 'object') return [];
  const candidates = [];
  const history = record.history;
  if (history && typeof history === 'object' && !Array.isArray(history)) {
    for (const [date, row] of Object.entries(history)) {
      if (row && typeof row === 'object') candidates.push({ ...row, _dateHint: date });
    }
  }
  if (Array.isArray(record.saleHistory)) candidates.push(...record.saleHistory);
  if (Array.isArray(record.salesHistory)) candidates.push(...record.salesHistory);
  if (record.lastSaleDate || record.lastSalePrice || record.lastSoldDate || record.lastSoldPrice) {
    candidates.push({
      event: 'Sale',
      date: record.lastSaleDate || record.lastSoldDate,
      price: record.lastSalePrice || record.lastSoldPrice,
    });
  }

  const deduped = new Map();
  for (const row of candidates) {
    if (!row || typeof row !== 'object' || (row.event && !/sale/i.test(String(row.event)))) continue;
    const date = cleanDate(first(row.date, row.saleDate, row.recordingDate, row._dateHint));
    const price = money(first(row.price, row.salePrice, row.amount, row.saleAmount));
    if (!date || !price) continue;
    const normalized = {
      date,
      price,
      event: first(row.event, 'Sale'),
      documentType: first(row.documentType, row.deedType, row.transactionType),
      documentNumber: first(row.documentNumber, row.documentNo, row.instrumentNumber),
      buyer: first(row.buyer, row.buyerName, row.grantee),
      seller: first(row.seller, row.sellerName, row.grantor),
      source: first(row.source, RENTCAST_SALE_SOURCE),
    };
    deduped.set(`${date}|${price}`, normalized);
  }
  return [...deduped.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
}

function compactMortgageRecord(value, source = '') {
  if (!value || typeof value !== 'object') return null;
  const lender = value.lender && typeof value.lender === 'object' ? value.lender : {};
  const amount = money(first(
    value.amount,
    value.loanAmount,
    value.originalLoanAmount,
    value.mortgageAmount,
    value.originalBalance
  ));
  const date = cleanDate(first(
    value.date,
    value.mortgageDate,
    value.loanDate,
    value.originationDate,
    value.recordingDate
  ));
  if (!amount && !date) return null;
  return {
    amount,
    date,
    lender: first(
      value.lenderName,
      value.lender,
      lender.companyName,
      lender.name,
      [lender.firstname || lender.firstName, lender.lastname || lender.lastName].map(clean).filter(Boolean).join(' ')
    ),
    interestRate: asNumber(value.interestRate ?? value.interestrate),
    loanType: first(value.loanType, value.loanTypeCode, value.loantypecode),
    deedType: first(value.deedType, value.deedtype),
    termMonths: asNumber(value.termMonths ?? value.term),
    dueDate: cleanDate(value.dueDate ?? value.duedate),
    documentNumber: first(value.documentNumber, value.documentNo, value.trustDeedDocumentNumber),
    source: first(value.source, source),
  };
}

function normalizeAddress(address) {
  return clean(address)
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressLine(address) {
  return clean(address)
    .split(',')[0]
    .toUpperCase()
    .replace(/[.#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nearestRentCastRecord(records, site = {}) {
  const latitude = asNumber(site.lat);
  const longitude = asNumber(site.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return records[0] || null;
  const distance = record => {
    const recordLatitude = asNumber(record?.latitude ?? record?.lat);
    const recordLongitude = asNumber(record?.longitude ?? record?.lng);
    return Number.isFinite(recordLatitude) && Number.isFinite(recordLongitude)
      ? Math.hypot(recordLatitude - latitude, recordLongitude - longitude)
      : Number.POSITIVE_INFINITY;
  };
  return [...records].sort((left, right) => distance(left) - distance(right))[0] || null;
}

function rentCastMatchedRecords(records, site = {}) {
  const candidates = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!candidates.length) return [];
  const targetApns = normalizeApns(site.apns, site.apn);
  const apnMatches = targetApns.length
    ? candidates.filter(record => normalizeApns(record?.assessorID, record?.assessorId, record?.apn)
      .some(apn => targetApns.includes(apn)))
    : [];
  if (apnMatches.length) return apnMatches;

  const targetAddresses = new Set([
    site.address,
    ...(Array.isArray(site.addresses) ? site.addresses : []),
  ].map(addressLine).filter(Boolean));
  const addressMatches = targetAddresses.size
    ? candidates.filter(record => targetAddresses.has(addressLine(record?.formattedAddress || record?.addressLine1)))
    : [];
  if (addressMatches.length) return addressMatches;

  const nearest = nearestRentCastRecord(candidates, site);
  return nearest ? [nearest] : [];
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
  const rentcastOwnerNames = [...new Set([
    ...ownerNameParts(r.owner?.names),
    ...ownerNameParts(r.ownerName),
    ...ownerNameParts(r.ownerNames),
  ])];
  const ownerName = first(
    rentcastOwnerNames.length ? rentcastOwnerNames.join(' / ') : null,
    typeof r.owner === 'string' ? r.owner : null,
    r.owner1,
    r.owner_name,
    r.taxAssessments?.[0]?.ownerName
  );
  const ownerMailingAddress = first(
    r.owner?.mailingAddress?.formattedAddress,
    r.ownerMailingAddress,
    r.owner_mailing_address
  );
  const saleHistory = rentCastSaleHistory(r);
  const latestSale = saleHistory[0] || latestRentCastSale(r);
  const salePrice = money(first(
    latestSale?.price,
    r.lastSalePrice,
    r.lastSoldPrice,
    r.salePrice,
    r.price,
    r.saleHistory?.[0]?.price,
    r.saleHistory?.[0]?.salePrice
  ));
  const saleDate = cleanDate(first(
    latestSale?.date,
    r.lastSaleDate,
    r.lastSoldDate,
    r.saleDate,
    r.saleHistory?.[0]?.date,
    r.saleHistory?.[0]?.saleDate
  ));
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
    ownerType: first(r.owner?.type, r.ownerType),
    ownerMailingAddress,
    ownerOccupied: typeof r.ownerOccupied === 'boolean' ? r.ownerOccupied : null,
    assessorId: first(r.assessorID, r.assessorId, r.apn),
    apns: normalizeApns(r.assessorID, r.assessorId, r.apn),
    legalDescription: first(r.legalDescription),
    lastSaleDate: saleDate,
    lastSalePrice: salePrice,
    saleHistory,
    originalMortgage: compactMortgageRecord(r.originalMortgage, first(r.originalMortgage?.source, RENTCAST_SALE_SOURCE)),
    pricePerUnit: salePrice && units ? Math.round(salePrice / units) : null,
    pricePerSf: salePrice && sf ? Math.round(salePrice / sf) : null,
    taxAssessment: r.taxAssessment || r.assessment || null,
    taxAmount: money(r.taxAmount ?? r.propertyTaxAmount),
  };
}

function compProjectType(value) {
  const type = clean(value).toLowerCase();
  if (/land|vacant|residential lot|lot\/land/.test(type)) return 'Land';
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
    return {
      address,
      apn: normalizeApns(record.apns, record.assessorId)[0] || null,
      neighborhood: hood,
      zip: clean(record.zipCode) || null,
      lat: asNumber(record.latitude),
      lng: asNumber(record.longitude),
      project_type: projectType,
      units,
      avg_unit_sf: avgUnitSf,
      sale_price: salePrice,
      sale_date: saleDate,
      price_per_unit: units ? Math.round(salePrice / units) : null,
      price_per_sf: buildingSf ? Math.round(salePrice / buildingSf) : null,
      source: RENTCAST_SALE_SOURCE,
      notes: 'Cached monthly property sale used as an acquisition-basis comp.',
      raw_record: record,
    };
  }).filter(Boolean);

  // Replace this provider's prior neighborhood snapshot. This stays compatible
  // with early ParcelLA databases that do not have the optional recorder fields.
  await sbRequest(
    'DELETE',
    `/rest/v1/sold_comps?source=eq.${encodeURIComponent(RENTCAST_SALE_SOURCE)}&neighborhood=eq.${encodeURIComponent(hood)}`,
    null,
    'return=minimal'
  );

  for (let offset = 0; offset < comps.length; offset += 200) {
    const batch = comps.slice(offset, offset + 200);
    try {
      await sbRequest('POST', '/rest/v1/sold_comps', batch, 'return=minimal');
    } catch (error) {
      if (!/raw_record/i.test(error.message)) throw error;
      await sbRequest(
        'POST',
        '/rest/v1/sold_comps',
        batch.map(({ raw_record, ...row }) => row),
        'return=minimal'
      );
    }
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

async function requestRentcast(url) {
  if (rentcastCallCount >= MAX_RENTCAST_CALLS) {
    throw new Error(`RentCast call budget exhausted (${MAX_RENTCAST_CALLS} calls per run)`);
  }
  rentcastCallCount += 1;
  return requestJson(url, { 'X-Api-Key': RENTCAST_KEY });
}

async function requestAttom(url) {
  if (!ATTOM_KEY) return null;
  if (attomCallCount >= MAX_ATTOM_CALLS) {
    throw new Error(`ATTOM call budget exhausted (${MAX_ATTOM_CALLS} calls per run)`);
  }
  attomCallCount += 1;
  return requestJson(url, { apikey: ATTOM_KEY });
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
    'raw_permit_data',
  ].join(',');
  const candidateLimit = Math.min(Math.max(SITE_LIMIT * 10, 100), 1000);
  const siteRows = await sbRequest(
    'GET',
    `/rest/v1/sites?select=${columns}&address=not.is.null&order=id.desc&limit=${candidateLimit}`
  );
  const permitRows = await sbRequest(
    'GET',
    `/rest/v1/permits?select=id,address,lat,lng,units,building_sf&address=not.is.null&permit_type=eq.Bldg-New&project_detail_complete=eq.true&order=id.desc&limit=${candidateLimit}`
  ).catch(() => []);
  const cacheRows = await sbRequest(
    'GET',
    `/rest/v1/property_enrichment_cache?select=site_id,cache_key,fetched_at,expires_at,status&purpose=eq.property_record&order=fetched_at.desc&limit=${Math.min(candidateLimit * 2, 2000)}`
  ).catch(() => []);
  const latestCache = new Map();
  for (const row of cacheRows || []) {
    const siteId = Number.parseInt(row.site_id, 10) || null;
    const cacheKey = siteId ? `site:${siteId}` : clean(row.cache_key).replace(/^owner:/, '');
    if (!cacheKey || latestCache.has(cacheKey)) continue;
    latestCache.set(cacheKey, {
      fetchedAt: row.fetched_at ? new Date(row.fetched_at).getTime() : 0,
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : 0,
      tracked: /^owner:site:/i.test(clean(row.cache_key)),
    });
  }
  const candidates = [
    ...(siteRows || []).map(row => ({
      ...row,
      recordKind: 'site',
      cacheKey: `site:${row.id}`,
      apns: normalizeApns(
        row.apn,
        row.raw_permit_data?.apns,
        row.raw_permit_data?.apn,
        row.raw_permit_data?.assessor_id,
        row.raw_permit_data?.assessorID
      ),
    })),
    ...(permitRows || []).map(row => ({
      ...row,
      recordKind: 'permit',
      cacheKey: `permit:${row.id}`,
      project_type: 'New House',
      avg_unit_sf: row.building_sf,
      neighborhood: null,
    })),
  ];
  const seenAddresses = new Set();
  const now = Date.now();
  return candidates
    .filter(row => {
      const cached = latestCache.get(row.cacheKey);
      return !cached || !cached.expiresAt || cached.expiresAt <= now;
    })
    .sort((a, b) => {
      const aCache = latestCache.get(a.cacheKey);
      const bCache = latestCache.get(b.cacheKey);
      if (!!aCache?.tracked !== !!bCache?.tracked) return aCache?.tracked ? -1 : 1;
      const aTime = aCache?.fetchedAt || (a.owner_enriched_at ? new Date(a.owner_enriched_at).getTime() : 0);
      const bTime = bCache?.fetchedAt || (b.owner_enriched_at ? new Date(b.owner_enriched_at).getTime() : 0);
      return aTime - bTime;
    })
    .filter(row => {
      const key = normalizeAddress(row.address);
      if (!key || seenAddresses.has(key)) return false;
      seenAddresses.add(key);
      return true;
    })
    .slice(0, SITE_LIMIT);
}

async function fetchFreshMarketCache() {
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await sbRequest(
    'GET',
    `/rest/v1/property_enrichment_cache?select=purpose,cache_key,expires_at&provider=eq.rentcast&purpose=in.(rental_listings,recent_sales)&status=eq.ok&expires_at=gt.${now}&limit=1000`
  ).catch(() => []);
  return new Set((rows || []).map(row => `${clean(row.purpose)}|${clean(row.cache_key)}`));
}

async function pullRentcastRentalListings(hood, zip) {
  const params = new URLSearchParams({
    zipCode: zip,
    propertyType: 'Apartment',
    status: 'Active',
    limit: String(Math.min(MARKET_LIMIT, 500)),
  });
  const { json, headers } = await requestRentcast(
    `https://api.rentcast.io/v1/listings/rental/long-term?${params}`
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
  const { json, headers } = await requestRentcast(
    `https://api.rentcast.io/v1/properties?${params}`
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
  const latitude = asNumber(site.lat);
  const longitude = asNumber(site.lng);
  if (!address && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) return null;
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const params = hasCoordinates
    ? new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        radius: String(RENTCAST_SEARCH_RADIUS_MILES),
        limit: '50',
      })
    : new URLSearchParams({ address, limit: '1' });
  const { json } = await requestRentcast(
    `https://api.rentcast.io/v1/properties?${params}`
  );
  const matchedRows = rentCastMatchedRecords(arrayFromPayload(json), site)
    .map(compactPropertyRecord)
    .filter(record => record.formattedAddress);
  const saleHistory = rentCastSaleHistory({
    saleHistory: matchedRows.flatMap(record => record.saleHistory || []),
  });
  const latestSale = saleHistory[0] || null;
  const record = matchedRows.length ? {
    ...matchedRows[0],
    ownerName: unique(matchedRows.map(row => row.ownerName).filter(Boolean)).join(' / ') || null,
    ownerMailingAddress: matchedRows.find(row => row.ownerMailingAddress)?.ownerMailingAddress || null,
    assessorId: normalizeApns(matchedRows.map(row => row.apns), site.apns, site.apn)[0] || null,
    apns: normalizeApns(matchedRows.map(row => row.apns), site.apns, site.apn),
    lastSaleDate: latestSale?.date || matchedRows[0].lastSaleDate || null,
    lastSalePrice: latestSale?.price || matchedRows[0].lastSalePrice || null,
    saleHistory,
    parcelRecords: matchedRows,
  } : null;
  await upsertCache({
    site_id: site.recordKind === 'site' ? site.id : null,
    provider: 'rentcast',
    purpose: 'property_record',
    cache_key: site.cacheKey || `site:${site.id}`,
    address: site.address,
    lat: asNumber(site.lat),
    lng: asNumber(site.lng),
    status: record ? 'ok' : 'miss',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: {
      endpoint: '/properties',
      address,
      lookupStrategy: hasCoordinates ? 'coordinate_apn' : 'address',
      apns: normalizeApns(site.apns, site.apn),
    },
    payload: { sampleCount: matchedRows.length },
    normalized: { record },
  });
  return record;
}

function attomAddressParts(address) {
  const parts = clean(address).split(',').map(part => clean(part)).filter(Boolean);
  return {
    address1: parts[0] || clean(address),
    address2: parts.slice(1).join(', ') || 'Los Angeles, CA',
  };
}

function compactAttomMortgage(payload) {
  const property = Array.isArray(payload?.property)
    ? payload.property[0]
    : Array.isArray(payload?.data?.property)
      ? payload.data.property[0]
      : payload?.property || payload?.data?.property || null;
  if (!property || typeof property !== 'object') return null;
  const mortgage = compactMortgageRecord(property.mortgage, ATTOM_MORTGAGE_SOURCE);
  if (!mortgage) return null;
  return {
    ...mortgage,
    source: ATTOM_MORTGAGE_SOURCE,
    attomId: first(property.identifier?.attomId, property.identifier?.Id),
  };
}

async function pullAttomMortgage(site) {
  if (!ATTOM_KEY || !MAX_ATTOM_CALLS) return null;
  const { address1, address2 } = attomAddressParts(site.address);
  if (!address1) return null;
  const params = new URLSearchParams({ address1, address2 });
  const result = await requestAttom(
    `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detailmortgageowner?${params}`
  );
  const mortgage = compactAttomMortgage(result?.json);
  await upsertCache({
    site_id: site.recordKind === 'site' ? site.id : null,
    provider: 'attom',
    purpose: 'mortgage_record',
    cache_key: site.cacheKey || `site:${site.id}`,
    address: site.address,
    lat: asNumber(site.lat),
    lng: asNumber(site.lng),
    status: mortgage ? 'ok' : 'miss',
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiry(),
    request_meta: { endpoint: '/property/detailmortgageowner', address1, address2 },
    payload: { hasMortgage: !!mortgage },
    normalized: { originalMortgage: mortgage },
  });
  return mortgage;
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
  const { json } = await requestRentcast(
    `https://api.rentcast.io/v1/avm/${endpoint}?${params}`
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
  await sleep(REQUEST_DELAY_MS);
  const originalMortgage = await pullAttomMortgage(site).catch(err => {
    console.warn(`[monthly-enrich] Mortgage record failed for ${site.address}: ${err.message}`);
    return null;
  });
  const mergedRecord = propertyRecord || originalMortgage
    ? {
        ...(propertyRecord || { formattedAddress: site.address, saleHistory: [] }),
        originalMortgage: originalMortgage || propertyRecord?.originalMortgage || null,
      }
    : null;
  const externalSources = [
    propertyRecord ? RENTCAST_SALE_SOURCE : null,
    originalMortgage ? ATTOM_MORTGAGE_SOURCE : null,
  ].filter(Boolean);
  const patch = {
    external_enriched_at: now,
    rentcast_enriched_at: now,
    external_data_sources: externalSources,
    data_quality: {
      rentcast: propertyRecord ? 'property_record_cached' : 'no_property_record_match',
      mortgage: originalMortgage
        ? 'recorded_mortgage_cached'
        : ATTOM_KEY
          ? 'no_recorded_mortgage_match'
          : 'mortgage_provider_not_configured',
      rentcastEnrichedAt: now,
      monthlyCache: true,
    },
    external_property_record: mergedRecord,
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

  if (site.recordKind !== 'permit') await patchSite(site.id, patch);
  return mergedRecord ? 'updated' : 'miss';
}

async function main() {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  if (!RENTCAST_KEY) {
    console.log('[monthly-enrich] RENTCAST_API_KEY not set; nothing to pull. Add it as a GitHub secret before running monthly enrichment.');
    return;
  }
  console.log(`[monthly-enrich] Guardrails: RentCast max ${MAX_RENTCAST_CALLS} call(s); ATTOM max ${MAX_ATTOM_CALLS} call(s); ${SITE_LIMIT} individual site record(s); AVM ${INCLUDE_SITE_AVM ? 'enabled' : 'disabled'}.`);

  let siteUpdated = 0;
  let siteMiss = 0;
  let schemaWarningShown = false;
  const sites = await fetchSitesForPropertyRecords().catch(err => {
    console.warn(`[monthly-enrich] Optional individual-site enrichment skipped: ${err.message}`);
    return [];
  });
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

  let marketRequests = 0;
  let rentalRows = 0;
  let saleRows = 0;
  let budgetWarningShown = false;
  const freshMarketCache = await fetchFreshMarketCache();
  const markets = await fetchMarkets();
  const seenZips = new Set();
  for (const hood of markets) {
    const zip = HOOD_ZIPS[hood];
    if (!zip || seenZips.has(zip)) continue;
    seenZips.add(zip);
    const saleCacheKey = `recent_sales|zip:${zip}`;
    if (freshMarketCache.has(saleCacheKey)) {
      console.log(`[monthly-enrich] ${hood} ${zip}: recent sales cache is still fresh; skipped paid request.`);
    } else if (rentcastCallCount < MAX_RENTCAST_CALLS) {
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

    const rentalCacheKey = `rental_listings|zip:${zip}`;
    if (freshMarketCache.has(rentalCacheKey)) {
      console.log(`[monthly-enrich] ${hood} ${zip}: rental cache is still fresh; skipped paid request.`);
    } else if (rentcastCallCount < MAX_RENTCAST_CALLS) {
      try {
        const count = await pullRentcastRentalListings(hood, zip);
        marketRequests++;
        rentalRows += count;
        console.log(`[monthly-enrich] ${hood} ${zip}: cached ${count} rental listing(s).`);
      } catch (err) {
        console.warn(`[monthly-enrich] Rental listings failed for ${hood} ${zip}: ${err.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    if (!budgetWarningShown && rentcastCallCount >= MAX_RENTCAST_CALLS) {
      console.warn(`[monthly-enrich] RentCast call budget reached; remaining stale market snapshots will wait for the next run.`);
      budgetWarningShown = true;
    }
  }

  console.log(`[monthly-enrich] Complete. RentCast API calls: ${rentcastCallCount}/${MAX_RENTCAST_CALLS}; ATTOM API calls: ${attomCallCount}/${MAX_ATTOM_CALLS}; successful market calls: ${marketRequests}; cached rentals: ${rentalRows}; cached recent sales: ${saleRows}; site records updated: ${siteUpdated}; site misses: ${siteMiss}.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[monthly-enrich] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  compactAttomMortgage,
  compactMortgageRecord,
  compactPropertyRecord,
  latestRentCastSale,
  nearestRentCastRecord,
  normalizeApns,
  ownerNameParts,
  rentCastMatchedRecords,
  rentCastSaleHistory,
};
