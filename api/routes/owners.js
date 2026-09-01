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
const MONTHLY_CACHE_SOURCE = 'Monthly property records cache';
const RENTCAST_BASE = 'https://api.rentcast.io/v1/properties';
const RENTCAST_LIVE_OWNER_ENABLED = /^(1|true|yes)$/i.test(process.env.RENTCAST_LIVE_OWNER_LOOKUPS_ENABLED || '');
const CACHE_TTL = 24 * 60 * 60 * 1000;
const ownerCache = new Map();
let ownerDb = null;
let regridProbeCache = null;

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
  'Last_Sale_Amount',
  'Last_Sale_Date',
  'Use_Code',
  'Use_Code_Desc',
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

function compact(values) {
  return values.map(clean).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
  const lastSaleDate = cleanDate(a.Last_Sale_Date);
  const lastSaleAmount = cleanMoney(a.Last_Sale_Amount);

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: clean(a.AIN) || clean(a.AIN_1) || null,
    specialNameLegend: clean(a.Special_Name_Legend) || null,
    recordingDate: cleanDate(a.Recording_Date),
    lastSaleDate,
    lastSaleAmount,
    saleHistory: lastSaleDate && lastSaleAmount ? [{
      date: lastSaleDate,
      price: lastSaleAmount,
      event: 'Sale',
      source: OWNER_SOURCE,
    }] : [],
    useCode: clean(a.Use_Code) || null,
    useDescription: clean(a.Use_Code_Desc) || null,
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
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
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
  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    ownerType: clean(record?.owner?.type) || null,
    ownerOccupied: typeof record?.ownerOccupied === 'boolean' ? record.ownerOccupied : null,
    mailingAddress: clean(mailing.formattedAddress) || formatAddress(
      [mailing.addressLine1, mailing.addressLine2],
      compact([mailing.city, mailing.state]).join(', '),
      mailing.zipCode
    ) || null,
    situsAddress: clean(record?.formattedAddress) || null,
    apn: clean(record?.assessorID || record?.assessorId || record?.apn) || null,
    lastSaleDate: cleanDate(record?.lastSaleDate) || latestSale?.date || null,
    recordingDate: cleanDate(record?.lastSaleDate) || latestSale?.date || null,
    lastSaleAmount: cleanMoney(record?.lastSalePrice) || latestSale?.price || null,
    saleHistory,
    originalMortgage: normalizeMortgageRecord(record?.originalMortgage, record?.originalMortgage?.source),
    source: RENTCAST_SOURCE,
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
  if (!db || !line) return null;
  const safePrefix = line.replace(/[%_]/g, '');
  const [compResult, cacheResult] = await Promise.all([
    db
      .from('sold_comps')
      .select('address,sale_date,sale_price,source,raw_record')
      .ilike('address', `${safePrefix}%`)
      .order('sale_date', { ascending: false })
      .limit(12),
    db
      .from('property_enrichment_cache')
      .select('address,provider,purpose,status,fetched_at,normalized')
      .in('purpose', ['property_record', 'mortgage_record'])
      .ilike('address', `${safePrefix}%`)
      .order('fetched_at', { ascending: false })
      .limit(12),
  ]);
  if (compResult.error && cacheResult.error) throw compResult.error;
  const matchesAddress = row => {
    const candidate = addressLine(row.address);
    return candidate === line || candidate.startsWith(`${line} `) || line.startsWith(`${candidate} `);
  };
  const compRows = (compResult.data || []).filter(matchesAddress);
  const cacheRows = (cacheResult.data || []).filter(row => row.status === 'ok' && matchesAddress(row));
  if (!compRows.length && !cacheRows.length) return null;

  const propertyCache = cacheRows.find(row => row.purpose === 'property_record' && row.normalized?.record);
  const rawProperty = propertyCache?.normalized?.record || compRows[0]?.raw_record || {};
  const primary = normalizeRentCastRecord(rawProperty);
  const saleHistory = saleHistoryFromRecord({
    saleHistory: [
      ...(Array.isArray(rawProperty.saleHistory) ? rawProperty.saleHistory : []),
      ...compRows.flatMap(row => [
      ...(Array.isArray(row.raw_record?.saleHistory) ? row.raw_record.saleHistory : []),
      { date: row.sale_date, price: row.sale_price, event: 'Sale', source: row.source || MONTHLY_CACHE_SOURCE },
      ]),
    ],
  });
  const mortgageCache = cacheRows.find(row => row.purpose === 'mortgage_record' && row.normalized?.originalMortgage);
  const originalMortgage = normalizeMortgageRecord(
    mortgageCache?.normalized?.originalMortgage || rawProperty.originalMortgage,
    mortgageCache?.provider === 'attom' ? 'ATTOM monthly mortgage records' : MONTHLY_CACHE_SOURCE
  );
  const latestSale = saleHistory[0] || null;
  const source = unique([
    propertyCache ? MONTHLY_CACHE_SOURCE : null,
    ...compRows.map(row => clean(row.source)),
    originalMortgage?.source,
  ].filter(Boolean)).join(' + ') || MONTHLY_CACHE_SOURCE;
  return {
    ...primary,
    found: !!primary.ownerName,
    situsAddress: primary.situsAddress || cacheRows[0]?.address || compRows[0]?.address || clean(params.address) || null,
    lastSaleDate: latestSale?.date || primary.lastSaleDate || null,
    recordingDate: latestSale?.date || primary.recordingDate || null,
    lastSaleAmount: latestSale?.price || primary.lastSaleAmount || null,
    saleHistory,
    originalMortgage: originalMortgage || primary.originalMortgage || null,
    historyRefreshedAt: cacheRows[0]?.fetched_at || null,
    source,
  };
}

async function queryRentCast(params) {
  const key = rentcastKey();
  const address = clean(params.address);
  if (!key || !address) return null;

  const url = new URL(RENTCAST_BASE);
  url.searchParams.set('address', /\bCA\b|CALIFORNIA/i.test(address)
    ? address
    : `${address}, Los Angeles, CA`);
  url.searchParams.set('limit', '1');
  const data = await fetchJson(url.toString(), 10000, { 'X-Api-Key': key });
  const record = Array.isArray(data) ? data[0] : data?.properties?.[0] || data?.data?.[0];
  if (!record) return null;
  const normalized = normalizeRentCastRecord(record);
  return normalized.ownerName || normalized.lastSaleDate || normalized.lastSaleAmount || normalized.originalMortgage
    ? normalized
    : null;
}

function mergeOwnerResults(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  const sources = unique([current.source, candidate.source].map(clean).filter(Boolean));
  return {
    ...candidate,
    ...current,
    found: !!(current.ownerName || candidate.ownerName),
    ownerName: current.ownerName || candidate.ownerName || null,
    ownerType: current.ownerType || candidate.ownerType || null,
    ownerOccupied: current.ownerOccupied ?? candidate.ownerOccupied ?? null,
    mailingAddress: current.mailingAddress || candidate.mailingAddress || null,
    situsAddress: current.situsAddress || candidate.situsAddress || null,
    apn: current.apn || candidate.apn || null,
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
  url.searchParams.set('resultRecordCount', '5');
  url.searchParams.set('where', '1=1');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const data = await fetchJson(url.toString());
  if (data?.error) throw new Error(data.error.message || 'Assessor owner lookup failed');
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  return feature ? normalizeOwnerFeature(feature) : null;
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

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    ownerType: first(fields.owntype, fields.owner_type, fields.ownership_type, enhanced.eo_ownertype) || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: first(fields.parcelnumb, fields.parcel_number, fields.apn, fields.ain, fields.alt_parcelnumb1) || null,
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
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
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

  if (clean(params.address)) {
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

  if (clean(params.apn)) {
    const u = new URL(`${REGRID_BASE}/apn`);
    u.searchParams.set('parcelnumb', clean(params.apn));
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
  for (const url of attempts) {
    try {
      const data = await fetchJson(url.toString(), 9000);
      requestCompleted = true;
      const feature = regridFeature(data);
      const normalized = normalizeRegridFeature(feature);
      if (normalized?.ownerName || normalized?.lastSaleDate || normalized?.lastSaleAmount || normalized?.originalMortgage) return normalized;
    } catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403) throw error;
    }
  }
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

async function lookupOwner({ address, lat, lng, apn }) {
  const cacheKey = JSON.stringify({ address: clean(address).toUpperCase(), lat: clean(lat), lng: clean(lng), apn: clean(apn) });
  const cached = ownerCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.value;

  let owner = null;
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
      const message = status === 401 || status === 403
        ? `Credential rejected (HTTP ${status})`
        : clean(error.message).slice(0, 180) || 'Request failed';
      diagnostics.push({ provider, status: 'error', message, note });
      console.warn(`[owners] ${provider} lookup failed for ${clean(address) || clean(apn) || 'parcel'}: ${message}`);
      return null;
    }
  };

  owner = await runProvider(
    MONTHLY_CACHE_SOURCE,
    !!monthlyDatabase(),
    () => queryMonthlyPropertyCache({ address, lat, lng, apn }),
    'Cached sale history is refreshed by the monthly property enrichment job.'
  );

  if (!owner?.ownerName) {
    const regridOwner = await runProvider(REGRID_SOURCE, !!regridToken(), () => queryRegrid({ address, lat, lng, apn }));
    owner = mergeOwnerResults(owner, regridOwner);
  }

  if (!owner?.ownerName) {
    if (RENTCAST_LIVE_OWNER_ENABLED) {
      const rentcastOwner = await runProvider(RENTCAST_SOURCE, !!rentcastKey(), () => queryRentCast({ address, lat, lng, apn }));
      owner = mergeOwnerResults(owner, rentcastOwner);
    } else {
      diagnostics.push({
        provider: RENTCAST_SOURCE,
        status: 'disabled',
        note: 'Live per-property RentCast calls are disabled. ParcelLA uses the capped monthly cache instead.',
      });
    }
  }

  const ain = clean(apn).replace(/\D/g, '');
  if (!owner?.ownerName && ain) {
    const assessorOwner = await runProvider(OWNER_SOURCE, true, () => queryLayer({
      where: `AIN='${ain}' OR AIN_1=${Number(ain) || 0}`,
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
  const value = owner ? { ...owner, diagnostics: uniqueDiagnostics } : {
    found: false,
    ownerName: null,
    mailingAddress: null,
    situsAddress: clean(address) || null,
    apn: ain || null,
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
    const { address, lat, lng, apn } = req.query;
    if (!address && !apn && (!lat || !lng)) {
      return res.status(400).json({ error: 'address, apn, or lat/lng is required' });
    }
    const owner = await lookupOwner({ address, lat, lng, apn });
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
    return res.json({ provider: REGRID_SOURCE, configured: false, credentialAccepted: false, ownerMapped: false });
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
      checkedAt: new Date().toISOString(),
    };
    regridProbeCache = { time: now, value };
    return res.status(503).json(value);
  }
});

export {
  enhancedOwnershipRows,
  normalizeMortgageRecord,
  normalizeRegridFeature,
  normalizeRentCastRecord,
  queryRegrid,
  saleHistoryFromRecord,
};
export default router;
