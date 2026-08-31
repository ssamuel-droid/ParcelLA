import { Router } from 'express';
import { optionalAuth, getUserAccess } from '../middleware/auth.js';

const router = Router();

const OWNER_LAYER_QUERY_URL = 'https://services9.arcgis.com/vt06TugX2cjEwSJJ/ArcGIS/rest/services/LACo_Assessor_Parcels_2023_DS04/FeatureServer/193/query';
const OWNER_SOURCE = 'LA County Assessor Parcels 2023 DS04 public owner feed';
const REGRID_SOURCE = 'Regrid Parcel API';
const REGRID_BASE = 'https://app.regrid.com/api/v2/parcels';
const REGRID_LA_PATH = '/us/ca/los-angeles';
const RENTCAST_SOURCE = 'RentCast property records';
const RENTCAST_BASE = 'https://api.rentcast.io/v1/properties';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const ownerCache = new Map();

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
  return text || null;
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

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: clean(a.AIN) || clean(a.AIN_1) || null,
    specialNameLegend: clean(a.Special_Name_Legend) || null,
    recordingDate: cleanDate(a.Recording_Date),
    lastSaleDate: cleanDate(a.Last_Sale_Date),
    lastSaleAmount: cleanMoney(a.Last_Sale_Amount),
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function rentcastKey() {
  return clean(process.env.RENTCAST_API_KEY);
}

function normalizeRentCastRecord(record) {
  const names = Array.isArray(record?.owner?.names)
    ? unique(record.owner.names.map(clean).filter(Boolean))
    : [];
  const ownerName = names.join(' / ');
  const mailing = record?.owner?.mailingAddress || {};
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
    apn: clean(record?.assessorID) || null,
    lastSaleDate: cleanDate(record?.lastSaleDate),
    recordingDate: cleanDate(record?.lastSaleDate),
    lastSaleAmount: cleanMoney(record?.lastSalePrice),
    source: RENTCAST_SOURCE,
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
  return normalized.ownerName || normalized.lastSaleDate || normalized.lastSaleAmount
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

function normalizeRegridFeature(feature) {
  const p = feature?.properties || {};
  const enhanced = p.enhanced_ownership || p.enhancedOwnership || {};
  const ownerName = first(
    p.owner,
    p.owner1,
    p.owner_1,
    p.owner_name,
    p.ownername,
    enhanced.owner,
    enhanced.owner_name,
    enhanced.ownerName,
    enhanced.owner_1
  );
  const saleDate = cleanDate(first(
    p.saledate,
    p.sale_date,
    p.last_sale_date,
    p.lastsaledate,
    p.recordingdate,
    p.recording_date
  ));
  const saleAmount = cleanMoney(first(
    p.saleprice,
    p.sale_price,
    p.last_sale_price,
    p.lastsaleprice,
    p.last_sale_amount,
    p.saleamt
  ));
  const situsAddress = first(
    p.address,
    p.situs_address,
    p.situsaddress,
    [p.saddno, p.saddstr, p.scity, p.state2, p.szip].filter(Boolean).join(' ')
  );
  const mailingAddress = first(
    p.mailadd,
    p.mail_address,
    p.mailing_address,
    p.owner_address
  );

  return {
    found: !!ownerName,
    ownerName: ownerName || null,
    mailingAddress: mailingAddress || null,
    situsAddress: situsAddress || null,
    apn: first(p.parcelnumb, p.parcel_number, p.apn, p.ain, p.alt_parcelnumb1) || null,
    lastSaleDate: saleDate,
    recordingDate: saleDate,
    lastSaleAmount: saleAmount,
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
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', token);
    attempts.push(u);
  }

  if (clean(params.apn)) {
    const u = new URL(`${REGRID_BASE}/query`);
    u.searchParams.set('fields[parcelnumb][eq]', clean(params.apn));
    u.searchParams.set('fields[path][ilike]', REGRID_LA_PATH);
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', token);
    attempts.push(u);
  }

  for (const url of attempts) {
    try {
      const data = await fetchJson(url.toString(), 9000);
      const feature = regridFeature(data);
      const normalized = normalizeRegridFeature(feature);
      if (normalized?.ownerName || normalized?.lastSaleDate || normalized?.lastSaleAmount) return normalized;
    } catch {
      // Fall back to the public assessor layer below.
    }
  }
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
  owner = await queryRegrid({ address, lat, lng, apn }).catch(() => null);

  if (!owner?.ownerName) {
    const rentcastOwner = await queryRentCast({ address, lat, lng, apn }).catch(() => null);
    owner = mergeOwnerResults(owner, rentcastOwner);
  }

  const ain = clean(apn).replace(/\D/g, '');
  if (!owner?.ownerName && ain) {
    const assessorOwner = await queryLayer({ where: `AIN='${ain}' OR AIN_1=${Number(ain) || 0}` }).catch(() => null);
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!owner?.ownerName && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const assessorOwner = await queryLayer({
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    }).catch(() => null);
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const parsed = parseAddress(address);
  if (!owner?.ownerName && parsed?.number && parsed.keyWord) {
    const assessorOwner = await queryLayer({
      where: `Situs_House_No=${parsed.number} AND Street_Name LIKE '%${sqlText(parsed.keyWord)}%'`,
    }).catch(() => null);
    owner = mergeOwnerResults(owner, assessorOwner);
  }

  const checkedSources = [
    regridToken() ? REGRID_SOURCE : null,
    rentcastKey() ? RENTCAST_SOURCE : null,
    OWNER_SOURCE,
  ].filter(Boolean);
  const value = owner || {
    found: false,
    ownerName: null,
    mailingAddress: null,
    situsAddress: clean(address) || null,
    apn: ain || null,
    source: OWNER_SOURCE,
    message: `No legal-owner match was returned for this parcel/address. Checked: ${checkedSources.join(', ')}.`,
  };

  ownerCache.set(cacheKey, { time: Date.now(), value });
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

export default router;
