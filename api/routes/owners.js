import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { optionalAuth, getUserAccess } from '../middleware/auth.js';

const router = Router();

const OWNER_LAYER_QUERY_URL = 'https://services9.arcgis.com/vt06TugX2cjEwSJJ/ArcGIS/rest/services/LACo_Assessor_Parcels_2023_DS04/FeatureServer/193/query';
const OWNER_SOURCE = 'LA County assessor DS04 VTC limited-area layer';
const REGRID_SOURCE = 'Regrid Parcel API';
const REGRID_BASE = 'https://app.regrid.com/api/v2/parcels';
const REGRID_LA_PATH = '/us/ca/los-angeles';
const RENTCAST_SOURCE = 'RentCast property records';
const ATTOM_SOURCE = 'ATTOM owner and mortgage records';
const MONTHLY_CACHE_SOURCE = 'Monthly property records cache';
const RENTCAST_BASE = 'https://api.rentcast.io/v1/properties';
const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detailmortgageowner';
const RENTCAST_SEARCH_RADIUS_MILES = 0.12;
const EXTERNAL_CACHE_DAYS = positiveInt(process.env.OWNER_DATA_CACHE_DAYS, 30);
const RENTCAST_DAILY_LIMIT = positiveInt(process.env.RENTCAST_OWNER_DAILY_LIMIT, 25);
const ATTOM_DAILY_LIMIT = positiveInt(process.env.ATTOM_MORTGAGE_DAILY_LIMIT, 10);
const RENTCAST_LIVE_OWNER_ENABLED = envEnabled('RENTCAST_LIVE_OWNER_LOOKUPS_ENABLED', true);
const ATTOM_LIVE_MORTGAGE_ENABLED = envEnabled('ATTOM_LIVE_MORTGAGE_LOOKUPS_ENABLED', true);
const CACHE_TTL = 24 * 60 * 60 * 1000;
const ownerCache = new Map();
const providerUsage = new Map();
let ownerDb = null;
let regridProbeCache = null;
let regridCredentialRejectedUntil = 0;

const OWNER_FIELDS = [
  'AIN',
  'AIN_1',
  'First_Owner_Name',
  'First_Owner_Name_Overflow',
  'Second_Owner_Name',
  'Special_Name_Assessee',
  'Special_Name_Legend',
  'Mail_House_No',
  'M_Direction',
  'M_Street_Name',
  'M_Unit',
  'M_City_State',
  'M_Zip',
  'Situs_House_No',
  'Direction',
  'Street_Name',
  'Unit_1',
  'City_State',
  'Zip',
  'Recording_Date',
  'Last_Sale_Verif_Key',
  'Last_Sale_Amount',
  'Last_Sale_Date',
  'Sale_Two_Verif_Key',
  'Sale_Two_Amount',
  'Sale_Two_Date',
  'Sale_Three_Verif_Key',
  'Sale_Three_Amount',
  'Sale_Three_Date',
  'Use_Code',
  'LUDesc',
  'Zoning_Code',
  'Land_Current_Value',
  'Imp_Current_Value',
  'BD1_Year_Built',
  'BD1_Units',
].join(',');

function clean(value) {
  const text = String(value ?? '').trim();
  return text && text !== '0' && text.toLowerCase() !== 'null' ? text : '';
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function envEnabled(name, fallback) {
  const value = clean(process.env[name]);
  if (!value) return fallback;
  return !/^(0|false|no|off)$/i.test(value);
}

function compact(values) {
  return values.map(clean).filter(Boolean);
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
    const name = clean(value);
    return name && name !== '[object Object]' ? [name] : [];
  }
  const named = unique([
    value.fullName,
    value.name,
    value.ownerName,
    value.companyName,
    value.organizationName,
    value.entityName,
  ].map(clean).filter(Boolean));
  if (named.length) return named;
  const person = [value.firstName, value.middleName, value.lastName].map(clean).filter(Boolean).join(' ');
  return person ? [person] : [];
}

function formatAddress(parts, cityState, zip) {
  const line1 = compact(parts).join(' ').replace(/\s+/g, ' ').trim();
  const line2 = compact([cityState, zip]).join(' ').replace(/\s+/g, ' ').trim();
  return compact([line1, line2]).join(', ');
}

function cleanMoney(value) {
  const n = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function cleanDate(value) {
  const text = clean(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text ? text.slice(0, 10) : null;
}

function first(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeOwnerFeature(feature) {
  const a = feature?.attributes || {};
  const ownerNames = unique(compact([
    a.First_Owner_Name,
    a.First_Owner_Name_Overflow,
    a.Second_Owner_Name,
    a.Special_Name_Assessee,
  ]));
  const ownerName = ownerNames.join(' / ');
  const mailingAddress = formatAddress([
    a.Mail_House_No,
    a.M_Direction,
    a.M_Street_Name,
    a.M_Unit,
  ], a.M_City_State, a.M_Zip);
  const situsAddress = formatAddress([
    a.Situs_House_No,
    a.Direction,
    a.Street_Name,
    a.Unit_1,
  ], a.City_State, a.Zip);
  const saleHistory = [
    [a.Last_Sale_Date, a.Last_Sale_Amount, a.Last_Sale_Verif_Key],
    [a.Sale_Two_Date, a.Sale_Two_Amount, a.Sale_Two_Verif_Key],
    [a.Sale_Three_Date, a.Sale_Three_Amount, a.Sale_Three_Verif_Key],
  ].map(([date, price, verification]) => ({
    date: cleanDate(date),
    price: cleanMoney(price),
    event: 'Sale',
    documentType: clean(verification) || null,
    source: OWNER_SOURCE,
  })).filter(row => row.date && row.price)
    .sort((left, right) => right.date.localeCompare(left.date));
  const latestSale = saleHistory[0] || null;
  const apns = normalizeApns(a.AIN, a.AIN_1);

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: apns[0] || null,
    apns,
    specialNameLegend: clean(a.Special_Name_Legend) || null,
    recordingDate: cleanDate(a.Recording_Date),
    lastSaleDate: latestSale?.date || null,
    lastSaleAmount: latestSale?.price || null,
    saleHistory,
    useCode: clean(a.Use_Code) || null,
    useDescription: clean(a.LUDesc) || null,
    zoning: clean(a.Zoning_Code) || null,
    landValue: cleanMoney(a.Land_Current_Value),
    improvementValue: cleanMoney(a.Imp_Current_Value),
    yearBuilt: clean(a.BD1_Year_Built) || null,
    assessedUnits: clean(a.BD1_Units) || null,
    source: OWNER_SOURCE,
  };
}

async function fetchJson(url, timeoutMs = 9000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...headers },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const detail = clean(data?.error || data?.message || data?.detail || text.slice(0, 160));
      const error = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      error.status = res.status;
      const retryAfter = Number.parseFloat(res.headers.get('retry-after') || '');
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter * 1000)
        : null;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url, timeoutMs, headers, options = {}) {
  const attempts = Math.max(1, Number.parseInt(options.attempts, 10) || 3);
  const baseDelayMs = Math.max(1, Number.parseInt(options.baseDelayMs, 10) || 1100);
  const retryStatuses = new Set(options.retryStatuses || [429, 500, 504]);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, timeoutMs, headers);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryStatuses.has(Number(error.status))) throw error;
      const delayMs = Math.max(error.retryAfterMs || 0, baseDelayMs * (2 ** (attempt - 1)));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function saleHistoryFromRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const candidates = [];
  if (record.history && typeof record.history === 'object' && !Array.isArray(record.history)) {
    for (const [date, row] of Object.entries(record.history)) {
      if (row && typeof row === 'object') candidates.push({ ...row, _dateHint: date });
    }
  }
  if (Array.isArray(record.saleHistory)) candidates.push(...record.saleHistory);
  if (Array.isArray(record.salesHistory)) candidates.push(...record.salesHistory);
  if (record.lastSaleDate || record.lastSalePrice) {
    candidates.push({ date: record.lastSaleDate, price: record.lastSalePrice, event: 'Sale' });
  }

  const deduped = new Map();
  for (const row of candidates) {
    if (!row || typeof row !== 'object' || (row.event && !/sale/i.test(String(row.event)))) continue;
    const date = cleanDate(row.date || row.saleDate || row.recordingDate || row._dateHint);
    const price = cleanMoney(row.price || row.salePrice || row.amount || row.saleAmount);
    if (!date || !price) continue;
    deduped.set(`${date}|${price}`, {
      date,
      price,
      event: clean(row.event) || 'Sale',
      documentType: clean(row.documentType || row.deedType || row.transactionType) || null,
      documentNumber: clean(row.documentNumber || row.documentNo || row.instrumentNumber) || null,
      buyer: clean(row.buyer || row.buyerName || row.grantee) || null,
      seller: clean(row.seller || row.sellerName || row.grantor) || null,
      source: clean(row.source) || RENTCAST_SOURCE,
    });
  }
  return [...deduped.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
}

function normalizeMortgageRecord(value, source = '') {
  if (!value || typeof value !== 'object') return null;
  const lender = value.lender && typeof value.lender === 'object' ? value.lender : {};
  const amount = cleanMoney(
    value.amount || value.loanAmount || value.originalLoanAmount || value.mortgageAmount || value.originalBalance
  );
  const date = cleanDate(
    value.date || value.mortgageDate || value.loanDate || value.originationDate || value.recordingDate
  );
  if (!amount && !date) return null;
  return {
    amount,
    date,
    lender: first(
      value.lenderName,
      typeof value.lender === 'string' ? value.lender : null,
      lender.companyName,
      lender.name,
      [lender.firstname || lender.firstName, lender.lastname || lender.lastName].map(clean).filter(Boolean).join(' ')
    ),
    interestRate: Number(value.interestRate ?? value.interestrate) || null,
    loanType: first(value.loanType, value.loanTypeCode, value.loantypecode),
    deedType: first(value.deedType, value.deedtype),
    termMonths: Number(value.termMonths ?? value.term) || null,
    dueDate: cleanDate(value.dueDate ?? value.duedate),
    documentNumber: first(value.documentNumber, value.documentNo, value.trustDeedDocumentNumber),
    source: first(value.source, source),
  };
}

function rentcastKey() {
  return clean(process.env.RENTCAST_API_KEY);
}

function rentCastPropertyUrl(params = {}) {
  const address = clean(params.address);
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const url = new URL(RENTCAST_BASE);
  if (hasCoordinates) {
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('radius', String(RENTCAST_SEARCH_RADIUS_MILES));
    url.searchParams.set('limit', '50');
    return url;
  }
  if (!address) return null;
  const zipCode = clean(params.zipCode).replace(/\D/g, '').slice(0, 5);
  url.searchParams.set('address', /\bCA\b|CALIFORNIA/i.test(address)
    ? address
    : `${address}, Los Angeles, CA${zipCode ? ` ${zipCode}` : ''}`);
  url.searchParams.set('limit', '1');
  return url;
}

function nearestRentCastRecord(records, params = {}) {
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return records[0] || null;
  const distance = record => {
    const recordLatitude = Number(record?.latitude ?? record?.lat);
    const recordLongitude = Number(record?.longitude ?? record?.lng);
    return Number.isFinite(recordLatitude) && Number.isFinite(recordLongitude)
      ? Math.hypot(recordLatitude - latitude, recordLongitude - longitude)
      : Number.POSITIVE_INFINITY;
  };
  return [...records].sort((left, right) => {
    return distance(left) - distance(right);
  })[0] || null;
}

function rentCastMatchedRecords(records, params = {}) {
  const candidates = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!candidates.length) return [];
  const targetApns = normalizeApns(params.apns, params.apn);
  const apnMatches = targetApns.length
    ? candidates.filter(record => normalizeApns(record?.assessorID, record?.assessorId, record?.apn)
      .some(apn => targetApns.includes(apn)))
    : [];
  if (apnMatches.length) return apnMatches;

  const addressValues = [
    params.address,
    ...(Array.isArray(params.addresses)
      ? params.addresses
      : clean(params.addresses).split('|')),
  ];
  const targetAddresses = new Set(addressValues.map(addressLine).filter(Boolean));
  const addressMatches = targetAddresses.size
    ? candidates.filter(record => targetAddresses.has(addressLine(record?.formattedAddress || record?.addressLine1)))
    : [];
  if (addressMatches.length) return addressMatches;

  const nearest = nearestRentCastRecord(candidates, params);
  return nearest ? [nearest] : [];
}

function attomKey() {
  return clean(process.env.ATTOM_API_KEY);
}

function normalizeRentCastRecord(record) {
  const names = unique([
    ...ownerNameParts(record?.owner?.names),
    ...ownerNameParts(record?.ownerName),
    ...ownerNameParts(record?.ownerNames),
  ]);
  const ownerName = names.join(' / ');
  const mailing = record?.owner?.mailingAddress || {};
  const saleHistory = saleHistoryFromRecord(record);
  const latestSale = saleHistory[0] || null;
  const apns = normalizeApns(record?.assessorID, record?.assessorId, record?.apn);
  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    ownerType: clean(record?.owner?.type || record?.ownerType) || null,
    ownerOccupied: typeof record?.ownerOccupied === 'boolean' ? record.ownerOccupied : null,
    mailingAddress: clean(record?.mailingAddress) || clean(mailing.formattedAddress) || formatAddress(
      [mailing.addressLine1, mailing.addressLine2],
      compact([mailing.city, mailing.state]).join(', '),
      mailing.zipCode
    ) || null,
    situsAddress: clean(record?.formattedAddress || record?.situsAddress) || null,
    apn: apns[0] || null,
    apns,
    lastSaleDate: cleanDate(record?.lastSaleDate) || latestSale?.date || null,
    recordingDate: cleanDate(record?.lastSaleDate) || latestSale?.date || null,
    lastSaleAmount: cleanMoney(record?.lastSalePrice) || latestSale?.price || null,
    saleHistory,
    originalMortgage: normalizeMortgageRecord(record?.originalMortgage, record?.originalMortgage?.source),
    source: clean(record?.source) || RENTCAST_SOURCE,
  };
}

function normalizeAttomRecord(payload) {
  const property = Array.isArray(payload?.property)
    ? payload.property[0]
    : Array.isArray(payload?.data?.property)
      ? payload.data.property[0]
      : payload?.property || payload?.data?.property || null;
  if (!property || typeof property !== 'object') return null;
  const owner = property.owner || {};
  const names = unique(['owner1', 'owner2', 'owner3', 'owner4'].flatMap(key => {
    const value = owner[key] || {};
    return ownerNameParts({
      firstName: value.firstnameandmi || value.firstName,
      lastName: value.lastname || value.lastName,
      companyName: value.companyName,
    });
  }));
  const mortgage = normalizeMortgageRecord(property.mortgage, ATTOM_SOURCE);
  const ownerName = names.join(' / ');
  if (!ownerName && !mortgage) return null;
  const apns = normalizeApns(property.identifier?.apn, property.identifier?.apnOrig);
  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    ownerType: first(owner.ownerrelationshiprightscode, owner.ownerrelationshiptype, owner.corporateindicator),
    ownerOccupied: /owner occupied/i.test(clean(property.summary?.absenteeInd))
      ? true
      : /absentee/i.test(clean(property.summary?.absenteeInd))
        ? false
        : null,
    mailingAddress: first(owner.mailingaddressoneline, owner.mailingAddressOneLine),
    situsAddress: first(property.address?.oneLine, property.address?.oneline),
    apn: apns[0] || null,
    apns,
    originalMortgage: mortgage,
    source: ATTOM_SOURCE,
  };
}

function monthlyDatabase() {
  if (ownerDb) return ownerDb;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  ownerDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return ownerDb;
}

function addressLine(value) {
  return clean(value)
    .split(',')[0]
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function queryMonthlyPropertyCache(params) {
  const db = monthlyDatabase();
  const line = addressLine(params.address);
  const apns = normalizeApns(params.apns, params.apn);
  const siteId = Number.parseInt(params.siteId, 10) || null;
  if (!db || (!line && !apns.length && !siteId)) return null;
  const safePrefix = line.replace(/[%_]/g, '');
  const emptyResult = Promise.resolve({ data: [], error: null });
  const soldCompQuery = (mode, includeRawRecord = true) => {
    let query = db
      .from('sold_comps')
      .select(`address,apn,sale_date,sale_price,source${includeRawRecord ? ',raw_record' : ''}`)
      .order('sale_date', { ascending: false })
      .limit(50);
    query = mode === 'apn' ? query.in('apn', apns) : query.ilike('address', `${safePrefix}%`);
    return query;
  };
  const cacheColumns = 'site_id,cache_key,address,provider,purpose,status,fetched_at,expires_at,normalized';
  let [addressCompResult, apnCompResult, addressCacheResult, siteCacheResult] = await Promise.all([
    line ? soldCompQuery('address') : emptyResult,
    apns.length ? soldCompQuery('apn') : emptyResult,
    line
      ? db
        .from('property_enrichment_cache')
        .select(cacheColumns)
        .in('purpose', ['property_record', 'mortgage_record'])
        .ilike('address', `${safePrefix}%`)
        .order('fetched_at', { ascending: false })
        .limit(50)
      : emptyResult,
    siteId
      ? db
        .from('property_enrichment_cache')
        .select(cacheColumns)
        .in('purpose', ['property_record', 'mortgage_record'])
        .eq('site_id', siteId)
        .order('fetched_at', { ascending: false })
        .limit(50)
      : emptyResult,
  ]);
  if (addressCompResult.error && /raw_record/i.test(clean(addressCompResult.error.message))) {
    addressCompResult = await soldCompQuery('address', false);
  }
  if (apnCompResult.error && /raw_record/i.test(clean(apnCompResult.error.message))) {
    apnCompResult = await soldCompQuery('apn', false);
  }
  const successfulCompResults = [addressCompResult, apnCompResult].filter(result => !result.error);
  if (!successfulCompResults.length && addressCacheResult.error && siteCacheResult.error) {
    throw addressCompResult.error || apnCompResult.error || addressCacheResult.error || siteCacheResult.error;
  }
  const matchesAddress = row => {
    if (!line) return false;
    const candidate = addressLine(row.address);
    return candidate === line || candidate.startsWith(`${line} `) || line.startsWith(`${candidate} `);
  };
  const compRows = [...new Map([
    ...(addressCompResult.data || []).filter(matchesAddress),
    ...(apnCompResult.data || []).filter(row => apns.includes(normalizeApns(row.apn)[0])),
  ].map(row => [`${row.apn || ''}|${row.address || ''}|${row.sale_date || ''}|${row.sale_price || ''}`, row])).values()];
  const cacheRows = [...new Map([
    ...(addressCacheResult.data || []).filter(row => row.status === 'ok' && matchesAddress(row)),
    ...(siteCacheResult.data || []).filter(row => row.status === 'ok'),
  ].map(row => [`${row.provider}|${row.purpose}|${row.cache_key}`, row])).values()];
  if (!compRows.length && !cacheRows.length) return null;

  const propertyCaches = cacheRows.filter(row => row.purpose === 'property_record' && row.normalized?.record);
  const propertyCache = propertyCaches[0] || null;
  const rentcastPropertyCache = propertyCaches.find(row => /^rentcast/i.test(clean(row.provider)));
  const rawProperties = propertyCaches.flatMap(row => {
    const record = row.normalized.record;
    return Array.isArray(record?.parcelRecords) && record.parcelRecords.length
      ? record.parcelRecords
      : [record];
  });
  const rawProperty = rawProperties[0] || compRows[0]?.raw_record || {};
  const primary = rawProperties.length
    ? rawProperties.map(normalizeRentCastRecord).reduce(mergeOwnerResults, null)
    : normalizeRentCastRecord(rawProperty);
  const saleHistory = saleHistoryFromRecord({
    saleHistory: [
      ...rawProperties.flatMap(record => Array.isArray(record.saleHistory) ? record.saleHistory : []),
      ...(!rawProperties.length && Array.isArray(rawProperty.saleHistory) ? rawProperty.saleHistory : []),
      ...compRows.flatMap(row => [
      ...(Array.isArray(row.raw_record?.saleHistory) ? row.raw_record.saleHistory : []),
      { date: row.sale_date, price: row.sale_price, event: 'Sale', source: row.source || MONTHLY_CACHE_SOURCE },
      ]),
    ],
  });
  const mortgageCache = cacheRows.find(row => row.purpose === 'mortgage_record' && row.normalized?.originalMortgage);
  const originalMortgage = normalizeMortgageRecord(
    mortgageCache?.normalized?.originalMortgage || primary.originalMortgage || rawProperty.originalMortgage,
    /^attom/i.test(clean(mortgageCache?.provider)) ? 'ATTOM monthly mortgage records' : MONTHLY_CACHE_SOURCE
  );
  const latestSale = saleHistory[0] || null;
  const source = unique([
    propertyCache ? MONTHLY_CACHE_SOURCE : null,
    ...compRows.map(row => clean(row.source)),
    originalMortgage?.source,
  ].filter(Boolean)).join(' + ') || MONTHLY_CACHE_SOURCE;
  return {
    ...primary,
    apn: primary.apn || apns[0] || normalizeApns(compRows.map(row => row.apn))[0] || null,
    apns: normalizeApns(apns, primary.apns, primary.apn, compRows.map(row => row.apn)),
    found: !!primary.ownerName,
    situsAddress: primary.situsAddress || cacheRows[0]?.address || compRows[0]?.address || clean(params.address) || null,
    lastSaleDate: latestSale?.date || primary.lastSaleDate || null,
    recordingDate: latestSale?.date || primary.recordingDate || null,
    lastSaleAmount: latestSale?.price || primary.lastSaleAmount || null,
    saleHistory,
    originalMortgage: originalMortgage || primary.originalMortgage || null,
    historyRefreshedAt: cacheRows[0]?.fetched_at || null,
    cacheStale: !rentcastPropertyCache || !rentcastPropertyCache.expires_at || new Date(rentcastPropertyCache.expires_at).getTime() <= Date.now(),
    mortgageCacheStale: !mortgageCache || !mortgageCache.expires_at || new Date(mortgageCache.expires_at).getTime() <= Date.now(),
    source,
  };
}

function lookupCacheKey(params) {
  const siteId = Number.parseInt(params.siteId, 10) || null;
  return siteId ? `site:${siteId}` : addressLine(params.address) || normalizeApns(params.apns, params.apn).join('-') || compact([params.lat, params.lng]).join(',');
}

function cacheExpiresAt() {
  return new Date(Date.now() + EXTERNAL_CACHE_DAYS * 86400000).toISOString();
}

async function dailyProviderCount(provider, purpose) {
  const date = new Date().toISOString().slice(0, 10);
  const memoryKey = `${date}|${provider}|${purpose}`;
  const memoryCount = providerUsage.get(memoryKey) || 0;
  const db = monthlyDatabase();
  if (!db) return { count: memoryCount, memoryKey };
  const result = await db
    .from('property_enrichment_cache')
    .select('id', { count: 'exact', head: true })
    .eq('provider', provider)
    .eq('purpose', purpose)
    .gte('fetched_at', `${date}T00:00:00.000Z`);
  if (result.error) {
    console.warn(`[owners] Could not read ${provider} daily usage: ${clean(result.error.message) || 'database error'}`);
    return { count: memoryCount, memoryKey };
  }
  return { count: Math.max(memoryCount, result.count || 0), memoryKey };
}

async function claimProviderLookup(provider, purpose, limit) {
  if (!limit) return false;
  const usage = await dailyProviderCount(provider, purpose);
  if (usage.count >= limit) return false;
  providerUsage.set(usage.memoryKey, usage.count + 1);
  return true;
}

async function persistProviderRecord(provider, purpose, params, normalized, status = 'ok') {
  const db = monthlyDatabase();
  const cacheKey = lookupCacheKey(params);
  if (!db || !cacheKey) return;
  const result = await db.from('property_enrichment_cache').upsert({
    site_id: Number.parseInt(params.siteId, 10) || null,
    provider,
    purpose,
    cache_key: `owner:${cacheKey}`,
    address: clean(params.address) || normalized?.situsAddress || null,
    lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
    lng: Number.isFinite(Number(params.lng)) ? Number(params.lng) : null,
    status,
    fetched_at: new Date().toISOString(),
    expires_at: cacheExpiresAt(),
    request_meta: {
      detailView: true,
      lookupStrategy: Number.isFinite(Number(params.lat)) && Number.isFinite(Number(params.lng)) ? 'coordinate_apn' : 'address',
      apns: normalizeApns(params.apns, params.apn),
    },
    payload: {},
    normalized: purpose === 'mortgage_record'
      ? { originalMortgage: normalized?.originalMortgage || null }
      : { record: normalized || null },
  }, { onConflict: 'provider,purpose,cache_key' });
  if (result.error) throw result.error;
}

async function queryRentCast(params) {
  const key = rentcastKey();
  const url = rentCastPropertyUrl(params);
  if (!key || !url) return null;
  const data = await fetchJsonWithRetry(url.toString(), 10000, { 'X-Api-Key': key });
  const records = Array.isArray(data) ? data : data?.properties || data?.data || [];
  const normalizedRecords = rentCastMatchedRecords(records, params)
    .map(normalizeRentCastRecord)
    .filter(record => record.ownerName || record.lastSaleDate || record.lastSaleAmount || record.originalMortgage);
  if (!normalizedRecords.length) return null;
  const merged = normalizedRecords.reduce(mergeOwnerResults, null);
  const latestSale = merged.saleHistory?.[0] || null;
  return {
    ...merged,
    lastSaleDate: latestSale?.date || merged.lastSaleDate || null,
    recordingDate: latestSale?.date || merged.recordingDate || null,
    lastSaleAmount: latestSale?.price || merged.lastSaleAmount || null,
    parcelRecords: normalizedRecords,
  };
}

async function queryRentCastOnDemand(params) {
  if (!await claimProviderLookup('rentcast_live', 'property_record', RENTCAST_DAILY_LIMIT)) {
    const error = new Error('Daily RentCast owner lookup limit reached');
    error.status = 429;
    throw error;
  }
  const normalized = await queryRentCast(params);
  await persistProviderRecord('rentcast_live', 'property_record', params, normalized, normalized ? 'ok' : 'miss').catch(error => {
    console.warn(`[owners] Could not cache RentCast record: ${clean(error.message) || 'database error'}`);
  });
  return normalized;
}

function attomAddressParts(address) {
  const parts = clean(address).split(',').map(clean).filter(Boolean);
  const locality = parts.slice(1).join(', ') || 'Los Angeles';
  return {
    address1: parts[0] || clean(address),
    address2: /\bCA\b|CALIFORNIA/i.test(locality) ? locality : `${locality}, CA`,
  };
}

async function queryAttomOnDemand(params) {
  const key = attomKey();
  const { address1, address2 } = attomAddressParts(params.address);
  if (!key || !address1) return null;
  if (!await claimProviderLookup('attom_live', 'mortgage_record', ATTOM_DAILY_LIMIT)) {
    const error = new Error('Daily ATTOM mortgage lookup limit reached');
    error.status = 429;
    throw error;
  }
  const url = new URL(ATTOM_BASE);
  url.searchParams.set('address1', address1);
  url.searchParams.set('address2', address2);
  const data = await fetchJson(url.toString(), 10000, { apikey: key });
  const normalized = normalizeAttomRecord(data);
  await Promise.all([
    persistProviderRecord('attom_live', 'mortgage_record', params, normalized, normalized?.originalMortgage ? 'ok' : 'miss'),
    persistProviderRecord('attom_live', 'property_record', params, normalized, normalized ? 'ok' : 'miss'),
  ]).catch(error => {
    console.warn(`[owners] Could not cache ATTOM record: ${clean(error.message) || 'database error'}`);
  });
  return normalized;
}

function mergeOwnerResults(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  const sources = unique([current.source, candidate.source].map(clean).filter(Boolean));
  const ownerNames = unique([
    ...(Array.isArray(current.ownerNames) ? current.ownerNames : clean(current.ownerName).split(/\s+\/\s+/)),
    ...(Array.isArray(candidate.ownerNames) ? candidate.ownerNames : clean(candidate.ownerName).split(/\s+\/\s+/)),
  ].map(clean).filter(Boolean));
  const apns = normalizeApns(current.apns, current.apn, candidate.apns, candidate.apn);
  const parcelRecords = [...new Map([
    ...(Array.isArray(current.parcelRecords) ? current.parcelRecords : []),
    ...(Array.isArray(candidate.parcelRecords) ? candidate.parcelRecords : []),
  ].map(record => [`${record.apn || ''}|${record.situsAddress || ''}|${record.ownerName || ''}`, record])).values()];
  return {
    ...candidate,
    ...current,
    found: ownerNames.length > 0,
    ownerName: ownerNames.join(' / ') || null,
    ownerNames,
    ownerType: current.ownerType || candidate.ownerType || null,
    ownerOccupied: current.ownerOccupied ?? candidate.ownerOccupied ?? null,
    mailingAddress: current.mailingAddress || candidate.mailingAddress || null,
    situsAddress: current.situsAddress || candidate.situsAddress || null,
    apn: apns[0] || null,
    apns,
    parcelRecords,
    lastSaleDate: current.lastSaleDate || candidate.lastSaleDate || null,
    recordingDate: current.recordingDate || candidate.recordingDate || null,
    lastSaleAmount: current.lastSaleAmount || candidate.lastSaleAmount || null,
    saleHistory: saleHistoryFromRecord({
      saleHistory: [
        ...(Array.isArray(current.saleHistory) ? current.saleHistory : []),
        ...(Array.isArray(candidate.saleHistory) ? candidate.saleHistory : []),
      ],
    }),
    originalMortgage: current.originalMortgage || candidate.originalMortgage || null,
    source: sources.join(' + '),
  };
}

async function queryLayer(params) {
  const url = new URL(OWNER_LAYER_QUERY_URL);
  url.searchParams.set('f', 'json');
  url.searchParams.set('outFields', OWNER_FIELDS);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '50');
  url.searchParams.set('where', '1=1');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const data = await fetchJson(url.toString());
  if (data?.error) throw new Error(data.error.message || 'Assessor owner lookup failed');
  const records = (Array.isArray(data?.features) ? data.features : [])
    .map(normalizeOwnerFeature)
    .filter(Boolean);
  if (!records.length) return null;
  const merged = records.reduce(mergeOwnerResults, null);
  return { ...merged, parcelRecords: records };
}

function regridToken() {
  return clean(process.env.REGRID_API_KEY || process.env.REGRID_TOKEN);
}

function regridFeature(data) {
  const features = data?.parcels?.features || data?.features || [];
  return Array.isArray(features) ? features[0] : null;
}

function enhancedOwnershipRows(properties = {}) {
  const value = properties.enhanced_ownership
    ?? properties.enhancedOwnership
    ?? properties.enhanced_owners
    ?? properties.enhancedOwners;
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (Object.keys(value).some(key => /^eo_/i.test(key)) ? [value] : Object.values(value))
      : [];
  return rows
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map(row => row.fields && typeof row.fields === 'object' ? { ...row.fields, ...row } : row);
}

function normalizeRegridFeature(feature) {
  const p = feature?.properties || {};
  const fields = p.fields && typeof p.fields === 'object' ? p.fields : p;
  const enhancedRows = enhancedOwnershipRows(p);
  const enhanced = enhancedRows[0] || {};
  const ownerName = unique(compact([
    fields.owner,
    fields.owner1,
    fields.owner_1,
    fields.owner_name,
    fields.ownername,
    fields.unmodified_owner,
    fields.owner2,
    fields.owner3,
    fields.owner4,
    [fields.ownfrst, fields.ownlast].map(clean).filter(Boolean).join(' '),
    ...enhancedRows.flatMap(row => [
      row.eo_owner,
      row.eo_owner2,
      row.eo_owner3,
      row.eo_owner4,
      row.eo_deedowner,
      row.eo_deedowner2,
      row.eo_deedowner3,
      row.eo_deedowner4,
      [row.eo_ownerfirst, row.eo_ownermiddle, row.eo_ownerlast].map(clean).filter(Boolean).join(' '),
      [row.eo_deedownerfirst, row.eo_deedownermiddle, row.eo_deedownerlast].map(clean).filter(Boolean).join(' '),
    ]),
  ])).join(' / ');
  const saleDate = cleanDate(first(
    fields.saledate,
    fields.sale_date,
    fields.last_sale_date,
    fields.lastsaledate,
    fields.recordingdate,
    fields.recording_date
  ));
  const saleAmount = cleanMoney(first(
    fields.saleprice,
    fields.sale_price,
    fields.last_sale_price,
    fields.lastsaleprice,
    fields.last_sale_amount,
    fields.saleamt
  ));
  const situsAddress = first(
    p.headline,
    fields.address,
    fields.situs_address,
    fields.situsaddress,
    [fields.saddno, fields.saddstr, fields.scity, fields.state2, fields.szip].filter(Boolean).join(' ')
  );
  const mailingAddress = first(
    enhanced.eo_mail_address && [
      enhanced.eo_mail_address,
      enhanced.eo_mail_city,
      enhanced.eo_mail_state2,
      enhanced.eo_mail_zip,
    ].filter(Boolean).join(', '),
    fields.mailadd,
    [
      fields.mail_addno,
      fields.mail_addpref,
      fields.mail_addstr,
      fields.mail_addsttyp,
      fields.mail_addstsuf,
      fields.mail_unit,
      fields.mail_city,
      fields.mail_state2,
      fields.mail_zip,
    ].map(clean).filter(Boolean).join(' '),
    fields.mail_address,
    fields.mailing_address,
    fields.owner_address
  );
  const originalMortgage = normalizeMortgageRecord({
    amount: first(fields.mortgage_amount, fields.loan_amount, fields.first_mortgage_amount, fields.mtg1amount),
    date: first(fields.mortgage_date, fields.loan_date, fields.first_mortgage_date, fields.mtg1date),
    lenderName: first(fields.lender_name, fields.mortgage_lender, fields.mtg1lender),
    loanType: first(fields.loan_type, fields.mortgage_type),
    documentNumber: first(fields.mortgage_document_number, fields.loan_document_number),
  }, REGRID_SOURCE);
  const apns = normalizeApns(
    fields.parcelnumb,
    fields.parcel_number,
    fields.apn,
    fields.ain,
    fields.alt_parcelnumb1,
    fields.alt_parcelnumb2,
    fields.alt_parcelnumb3
  );

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    ownerType: first(fields.owntype, fields.owner_type, fields.ownership_type, enhanced.eo_ownertype) || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: apns[0] || null,
    apns,
    lastSaleDate: saleDate,
    recordingDate: saleDate,
    lastSaleAmount: saleAmount,
    saleHistory: saleDate && saleAmount ? [{
      date: saleDate,
      price: saleAmount,
      event: 'Sale',
      source: REGRID_SOURCE,
    }] : [],
    originalMortgage,
    ownerRecordUpdatedAt: cleanDate(first(
      enhanced.eo_last_refresh,
      enhanced.eo_lastrefresh,
      fields.last_refresh,
      fields.updated_at
    )),
    source: REGRID_SOURCE,
  };
}

async function queryRegrid(params) {
  const token = regridToken();
  if (!token) return null;

  const attempts = [];
  const apns = normalizeApns(params.apns, params.apn);
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (!apns.length && Number.isFinite(lat) && Number.isFinite(lng)) {
    const u = new URL(`${REGRID_BASE}/point`);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('radius', '150');
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', token);
    attempts.push(u);
  }

  if (!apns.length && clean(params.address)) {
    const u = new URL(`${REGRID_BASE}/address`);
    u.searchParams.set('query', clean(params.address));
    u.searchParams.set('path', REGRID_LA_PATH);
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', token);
    attempts.push(u);
  }

  for (const apn of apns) {
    const u = new URL(`${REGRID_BASE}/apn`);
    u.searchParams.set('parcelnumb', apn);
    u.searchParams.set('path', REGRID_LA_PATH);
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', token);
    attempts.push(u);
  }

  let lastError = null;
  let requestCompleted = false;
  let merged = null;
  const parcelRecords = [];
  for (const url of attempts) {
    try {
      const data = await fetchJson(url.toString(), 9000);
      requestCompleted = true;
      const feature = regridFeature(data);
      const normalized = normalizeRegridFeature(feature);
      if (normalized?.ownerName || normalized?.lastSaleDate || normalized?.lastSaleAmount || normalized?.originalMortgage) {
        parcelRecords.push(normalized);
        merged = mergeOwnerResults(merged, normalized);
        if (apns.length <= 1) break;
      }
    } catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403) throw error;
    }
  }
  if (merged) return { ...merged, parcelRecords };
  if (lastError && !requestCompleted) throw lastError;
  return null;
}

function parseAddress(address) {
  const text = String(address || '').toUpperCase()
    .replace(/,.*$/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(/^(\d+)\s+(?:(N|S|E|W)\s+)?(.+)$/);
  if (!match) return null;
  const street = match[3]
    .replace(/\b(APT|UNIT|STE|SUITE|#)\b.*$/, '')
    .replace(/\b(AVE|AVENUE|ST|STREET|BLVD|BOULEVARD|DR|DRIVE|RD|ROAD|PL|PLACE|CT|COURT|WAY|LN|LANE)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const keyWord = street.split(' ').find(part => part.length > 2) || street;
  return { number: Number(match[1]), direction: match[2] || '', keyWord };
}

function sqlText(value) {
  return String(value || '').replace(/'/g, "''").replace(/[^A-Z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function lookupOwner({ address, addresses, lat, lng, apn, apns, siteId, zipCode }) {
  const parcelApns = normalizeApns(apns, apn);
  const primaryApn = parcelApns[0] || null;
  const providerParams = { address, addresses, lat, lng, apn: primaryApn, apns: parcelApns, siteId, zipCode };
  const cacheKey = JSON.stringify({
    address: clean(address).toUpperCase(),
    lat: clean(lat),
    lng: clean(lng),
    apns: parcelApns,
    siteId: Number.parseInt(siteId, 10) || null,
  });
  const cached = ownerCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.value;

  let owner = null;
  let rentcastAttempted = false;
  const diagnostics = [];
  const runProvider = async (provider, configured, lookup, note = '') => {
    if (!configured) {
      diagnostics.push({ provider, status: 'not_configured', note });
      return null;
    }
    try {
      const result = await lookup();
      diagnostics.push({ provider, status: result ? 'matched' : 'no_match', note });
      return result;
    } catch (error) {
      const status = Number(error.status) || null;
      if (provider === REGRID_SOURCE && (status === 401 || status === 403)) {
        regridCredentialRejectedUntil = Date.now() + 6 * 60 * 60 * 1000;
      }
      const message = status === 401 || status === 403
        ? `Credential rejected (HTTP ${status})`
        : clean(error.message).slice(0, 180) || 'Request failed';
      diagnostics.push({ provider, status: 'error', message, note });
      console.warn(`[owners] ${provider} lookup failed for ${clean(address) || primaryApn || 'parcel'}: ${message}`);
      return null;
    }
  };

  owner = await runProvider(
    MONTHLY_CACHE_SOURCE,
    !!monthlyDatabase(),
    () => queryMonthlyPropertyCache(providerParams),
    'Cached sale history is refreshed by the monthly property enrichment job.'
  );

  if (!owner?.ownerName || (parcelApns.length > 1 && normalizeApns(owner?.apns, owner?.apn).length < parcelApns.length)) {
    const regridOwner = await runProvider(
      REGRID_SOURCE,
      !!regridToken() && Date.now() >= regridCredentialRejectedUntil,
      () => queryRegrid(providerParams),
      regridCredentialRejectedUntil > Date.now() ? 'Credential was recently rejected; retry is paused for six hours.' : ''
    );
    owner = mergeOwnerResults(owner, regridOwner);
  }

  if (!owner?.ownerName) {
    if (RENTCAST_LIVE_OWNER_ENABLED) {
      rentcastAttempted = true;
      const rentcastOwner = await runProvider(RENTCAST_SOURCE, !!rentcastKey(), () => queryRentCastOnDemand(providerParams));
      owner = mergeOwnerResults(owner, rentcastOwner);
    } else {
      diagnostics.push({
        provider: RENTCAST_SOURCE,
        status: 'disabled',
        note: 'Live per-property RentCast calls are disabled. ParcelLA uses the capped monthly cache instead.',
      });
    }
  }

  const saleCount = Array.isArray(owner?.saleHistory) ? owner.saleHistory.length : 0;
  if (!rentcastAttempted && RENTCAST_LIVE_OWNER_ENABLED && rentcastKey() && (owner?.cacheStale || saleCount < 2)) {
    const rentcastOwner = await runProvider(RENTCAST_SOURCE, true, () => queryRentCastOnDemand(providerParams));
    owner = mergeOwnerResults(owner, rentcastOwner);
  }

  if (ATTOM_LIVE_MORTGAGE_ENABLED && (!owner?.originalMortgage || owner?.mortgageCacheStale)) {
    const attomOwner = await runProvider(ATTOM_SOURCE, !!attomKey(), () => queryAttomOnDemand(providerParams));
    owner = mergeOwnerResults(owner, attomOwner);
  }

  if ((!owner?.ownerName || parcelApns.length > 1) && parcelApns.length) {
    const apnWhere = parcelApns.flatMap(ain => [`AIN='${ain}'`, `AIN_1=${Number(ain) || 0}`]).join(' OR ');
    const assessorOwner = await runProvider(OWNER_SOURCE, true, () => queryLayer({
      where: apnWhere,
    }), 'This public layer covers only a small VTC study area, not all of Los Angeles County.');
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!owner?.ownerName && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const assessorOwner = await runProvider(OWNER_SOURCE, true, () => queryLayer({
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    }), 'This public layer covers only a small VTC study area, not all of Los Angeles County.');
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const parsed = parseAddress(address);
  if (!owner?.ownerName && parsed?.number && parsed.keyWord) {
    const assessorOwner = await runProvider(OWNER_SOURCE, true, () => queryLayer({
      where: `Situs_House_No=${parsed.number} AND Street_Name LIKE '%${sqlText(parsed.keyWord)}%'`,
    }), 'This public layer covers only a small VTC study area, not all of Los Angeles County.');
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const uniqueDiagnostics = [...new Map(diagnostics.map(item => [`${item.provider}|${item.status}`, item])).values()];
  const failed = uniqueDiagnostics.filter(item => item.status === 'error');
  const configuredCountywide = uniqueDiagnostics.filter(item => item.provider !== OWNER_SOURCE && !['not_configured', 'disabled'].includes(item.status));
  const message = failed.length
    ? `Owner lookup could not complete: ${failed.map(item => `${item.provider}: ${item.message}`).join('; ')}.`
    : configuredCountywide.length
      ? `No owner match was returned by ${configuredCountywide.map(item => item.provider).join(' or ')}. The free County layer is not countywide.`
      : 'No countywide ownership provider is working. Add a valid Regrid Parcel API token or a RentCast property-data key; the free County layer covers only a small study area.';
  const value = owner ? {
    ...owner,
    apn: normalizeApns(owner.apns, owner.apn, parcelApns)[0] || null,
    apns: normalizeApns(owner.apns, owner.apn, parcelApns),
    diagnostics: uniqueDiagnostics,
  } : {
    found: false,
    ownerName: null,
    mailingAddress: null,
    situsAddress: clean(address) || null,
    apn: primaryApn,
    apns: parcelApns,
    source: null,
    message,
    diagnostics: uniqueDiagnostics,
  };

  const providerFailed = uniqueDiagnostics.some(item => item.status === 'error');
  ownerCache.set(cacheKey, {
    time: providerFailed ? Date.now() - CACHE_TTL + 5 * 60 * 1000 : Date.now(),
    value,
  });
  return value;
}

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const access = await getUserAccess(req.user);
    if (!access.active) {
      return res.status(402).json({
        error: 'Sign in for a free 24-hour account to view owner and sale data.',
        access,
      });
    }
    const { address, addresses, lat, lng, apn, apns, siteId, zipCode } = req.query;
    const parcelApns = normalizeApns(apns, apn);
    if (!address && !parcelApns.length && (!lat || !lng)) {
      return res.status(400).json({ error: 'address, apn, or lat/lng is required' });
    }
    const owner = await lookupOwner({ address, addresses, lat, lng, apn: parcelApns[0], apns: parcelApns, siteId, zipCode });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(owner);
  } catch (err) {
    next(err);
  }
});

router.get('/provider-health', async (req, res) => {
  const now = Date.now();
  if (regridProbeCache && now - regridProbeCache.time < 6 * 60 * 60 * 1000) {
    return res.json(regridProbeCache.value);
  }
  if (!regridToken()) {
    return res.json({
      provider: REGRID_SOURCE,
      configured: false,
      credentialAccepted: false,
      ownerMapped: false,
      fallbacks: {
        rentcast: { configured: !!rentcastKey(), enabled: RENTCAST_LIVE_OWNER_ENABLED, dailyLimit: RENTCAST_DAILY_LIMIT },
        attom: { configured: !!attomKey(), enabled: ATTOM_LIVE_MORTGAGE_ENABLED, dailyLimit: ATTOM_DAILY_LIMIT },
      },
    });
  }
  try {
    const result = await queryRegrid({ address: '12500 Riverside Dr, Valley Village, CA 91607' });
    const value = {
      provider: REGRID_SOURCE,
      configured: true,
      credentialAccepted: true,
      ownerMapped: !!result?.ownerName,
      mailingAddressMapped: !!result?.mailingAddress,
      apnMapped: !!result?.apn,
      fallbacks: {
        rentcast: { configured: !!rentcastKey(), enabled: RENTCAST_LIVE_OWNER_ENABLED, dailyLimit: RENTCAST_DAILY_LIMIT },
        attom: { configured: !!attomKey(), enabled: ATTOM_LIVE_MORTGAGE_ENABLED, dailyLimit: ATTOM_DAILY_LIMIT },
      },
      checkedAt: new Date().toISOString(),
    };
    regridProbeCache = { time: now, value };
    return res.json(value);
  } catch (error) {
    const status = Number(error.status) || null;
    const value = {
      provider: REGRID_SOURCE,
      configured: true,
      credentialAccepted: ![401, 403].includes(status),
      ownerMapped: false,
      error: status ? `HTTP ${status}` : clean(error.message).slice(0, 120),
      fallbacks: {
        rentcast: { configured: !!rentcastKey(), enabled: RENTCAST_LIVE_OWNER_ENABLED, dailyLimit: RENTCAST_DAILY_LIMIT },
        attom: { configured: !!attomKey(), enabled: ATTOM_LIVE_MORTGAGE_ENABLED, dailyLimit: ATTOM_DAILY_LIMIT },
      },
      checkedAt: new Date().toISOString(),
    };
    regridProbeCache = { time: now, value };
    return res.status(503).json(value);
  }
});

export {
  enhancedOwnershipRows,
  fetchJsonWithRetry,
  normalizeAttomRecord,
  normalizeApns,
  normalizeMortgageRecord,
  normalizeOwnerFeature,
  normalizeRegridFeature,
  normalizeRentCastRecord,
  queryRegrid,
  rentCastMatchedRecords,
  rentCastPropertyUrl,
  saleHistoryFromRecord,
};
export default router;
