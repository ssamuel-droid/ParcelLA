import { Router } from 'express';

const router = Router();

const OWNER_LAYER_QUERY_URL = 'https://services9.arcgis.com/vt06TugX2cjEwSJJ/ArcGIS/rest/services/LACo_Assessor_Parcels_2023_DS04/FeatureServer/193/query';
const OWNER_SOURCE = 'LA County Assessor Parcels 2023 DS04 public owner feed';
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
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function cleanDate(value) {
  const text = clean(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text || null;
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

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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
  const ain = clean(apn).replace(/\D/g, '');
  if (ain) {
    owner = await queryLayer({ where: `AIN='${ain}' OR AIN_1=${Number(ain) || 0}` }).catch(() => null);
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!owner && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    owner = await queryLayer({
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    }).catch(() => null);
  }

  const parsed = parseAddress(address);
  if (!owner && parsed?.number && parsed.keyWord) {
    owner = await queryLayer({
      where: `Situs_House_No=${parsed.number} AND Street_Name LIKE '%${sqlText(parsed.keyWord)}%'`,
    }).catch(() => null);
  }

  const value = owner || {
    found: false,
    ownerName: null,
    mailingAddress: null,
    situsAddress: clean(address) || null,
    apn: ain || null,
    source: OWNER_SOURCE,
    message: 'No owner match returned by the assessor owner feed for this parcel/address.',
  };

  ownerCache.set(cacheKey, { time: Date.now(), value });
  return value;
}

router.get('/', async (req, res, next) => {
  try {
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
