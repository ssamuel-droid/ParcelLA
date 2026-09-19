import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { FEASIBILITY_USES, generateFeasibilityScenarios } from '../../src/feasibility/FeasibilityEngine.js';
import { RENTS, CAP_RATES } from '../../src/data/submarkets.js';

const router = Router();
const COUNTY_PARCEL_URL = 'https://cache.gis.lacounty.gov/cache/rest/services/LACounty_Cache/LACounty_Parcel/FeatureServer/0/query';
const LA_ZONING_URL = 'https://services5.arcgis.com/7nsPwEMP38bSkCjy/arcgis/rest/services/Zoning/FeatureServer/15/query';
const SANTA_ANA_PARCEL_URL = 'https://gis.santa-ana.org/server/rest/services/Accela/Accela_AP/MapServer/1/query';
const REQUEST_TIMEOUT_MS = 12000;

const CALIFORNIA_SOURCES = [
  { label: 'California HCD', url: 'https://www.hcd.ca.gov/planning-and-community-development/statutory-determinations', purpose: 'State Density Bonus, AB 2011, SB 35 and other state housing-law guidance' },
];

const LOS_ANGELES_SOURCES = [
  { label: 'ZIMAS', url: 'https://planning.lacity.gov/zoning/zoning-search', purpose: 'Parcel zoning, overlays and incentive-area verification' },
  { label: 'Los Angeles CHIP', url: 'https://planning.lacity.gov/plans-policies/citywide-housing-incentive-program', purpose: 'State Density Bonus, AHIP and MIIP procedures' },
  { label: 'Los Angeles housing policy', url: 'https://planning.lacity.gov/plans-policies/initiatives-policies/housing', purpose: 'ED1 and local housing programs' },
  { label: 'Los Angeles SB 79', url: 'https://planning.lacity.gov/resources/senate-bill-sb-79', purpose: 'Current SB 79 phased implementation and Low-Rise program' },
  ...CALIFORNIA_SOURCES,
];

const SANTA_ANA_SOURCES = [
  { label: 'Santa Ana parcel GIS', url: 'https://gis.santa-ana.org/server/rest/services/Accela/Accela_AP/MapServer/1', purpose: 'Official APN, lot area, General Plan, zoning and hazard attributes' },
  { label: 'Santa Ana zoning GIS', url: 'https://gis.santa-ana.org/server/rest/services/Public/PBA_ZoningClassifications/MapServer/0', purpose: 'Official zoning classifications and overlays' },
  { label: 'Santa Ana specific plans', url: 'https://gis.santa-ana.org/server/rest/services/Public/PBA_SpecificWorkingPlanAreas/FeatureServer', purpose: 'Specific-plan and special-development area verification' },
  { label: 'Santa Ana zoning code', url: 'https://library.municode.com/ca/santa_ana/codes/code_of_ordinances?nodeId=PTIITHCO_CH41ZO', purpose: 'Current local use and development standards' },
  ...CALIFORNIA_SOURCES,
];

const VERIFIED_PROJECTS = [
  {
    match: value => /\b12500\b.*\bRIVERSIDE\b/i.test(value),
    displayAddress: '12500-12532 W Riverside Dr, Los Angeles, CA 91607',
    geocodeAddress: '12500 W Riverside Dr, Los Angeles, CA 91607',
    lotSf: 56525,
    apns: ['2357-032-006', '2357-032-007', '2357-032-008'],
    zone: 'C2-1-RIO',
    zones: ['C2-1-RIO', '(Q)C1.5-1VL-RIO'],
    baseFar: 1.5,
    baseUnits: 142,
    sourceLabel: 'City Planning determination EAR-2024-5095-DB-VHCA',
    sourceUrl: 'https://planning.lacity.gov/pdiscaseinfo/document/MzQ50/82065561-f922-4efb-8b32-0e189f041683/pdd',
    approvedProject: {
      units: 219,
      grossSf: 170638,
      commercialSf: 2162,
      stories: 5,
      heightFt: 63,
      parkingSpaces: 254,
      description: 'Verified City Planning approval for a five-story, 219-unit mixed-use project on the three-lot 56,525 SF site.',
      requirements: ['Review EAR-2024-5095-DB-VHCA, its conditions and approved exhibits.', 'Confirm the current vesting and building-permit status.'],
      incentives: ['54% approved density bonus', 'Averaging across the project site', '3.18:1 FAR in lieu of 1.5:1', 'Height and transitional-height relief'],
    },
  },
];

function clean(value, max = 180) {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function number(value, fallback = null) {
  const raw = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (payload?.error) throw new Error(payload.error.message || 'Public-data query failed');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(address) {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const params = new URLSearchParams({ address, key: process.env.GOOGLE_MAPS_API_KEY, region: 'us' });
    const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const result = data?.results?.[0];
    if (data?.status === 'OK' && result) {
      const components = {};
      for (const part of result.address_components || []) for (const type of part.types || []) components[type] = part.long_name;
      return {
        formattedAddress: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        city: components.locality || components.sublocality || '',
        county: components.administrative_area_level_2 || '',
        zipCode: components.postal_code || '',
        jurisdiction: components.locality ? `${components.locality} city` : '',
        source: 'Google Geocoding',
      };
    }
  }

  const params = new URLSearchParams({ address, benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json' });
  const data = await fetchJson(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${params}`);
  const match = data?.result?.addressMatches?.[0];
  if (!match) throw Object.assign(new Error('No precise address match was found. Include street number, city and ZIP code.'), { status: 404 });
  const place = match.geographies?.['Incorporated Places']?.[0];
  const county = match.geographies?.Counties?.[0];
  return {
    formattedAddress: match.matchedAddress,
    lat: Number(match.coordinates?.y),
    lng: Number(match.coordinates?.x),
    city: match.addressComponents?.city || place?.BASENAME || '',
    county: county?.BASENAME || '',
    zipCode: match.addressComponents?.zip || '',
    jurisdiction: place?.NAME || (match.addressComponents?.city ? `${match.addressComponents.city} city` : ''),
    source: 'U.S. Census Geocoder',
  };
}

function countyAddressParts(value) {
  const suffix = { AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', STREET: 'ST', ROAD: 'RD', PLACE: 'PL', LANE: 'LN', COURT: 'CT', HIGHWAY: 'HWY', PARKWAY: 'PKWY', TERRACE: 'TER', CIRCLE: 'CIR' };
  const firstLine = String(value || '').toUpperCase().split(',')[0].replace(/\s+/g, ' ').trim();
  const match = firstLine.match(/^(\d+[A-Z]?)(?:-\d+[A-Z]?)?\s+(?:(N|S|E|W|NE|NW|SE|SW)\s+)?(.+)$/);
  if (!match) return null;
  const words = match[3].split(' ');
  if (suffix[words.at(-1)]) words[words.length - 1] = suffix[words.at(-1)];
  return { houseNo: match[1], direction: match[2] || '', street: words.join(' ') };
}

async function parcelLookup(address) {
  const parts = countyAddressParts(address);
  if (!parts) return [];
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const direction = parts.direction ? ` AND SitusDirection=${quote(parts.direction)}` : '';
  const body = new URLSearchParams({
    f: 'json', returnGeometry: 'false',
    where: `SitusHouseNo=${quote(parts.houseNo)} AND SitusStreet=${quote(parts.street)}${direction}`,
    outFields: 'AIN,APN,SitusFullAddress,SitusCity,SitusZIP,UseCode,UseType,UseDescription,YearBuilt1,Units1,SQFTmain1,Shape__Area,CENTER_LAT,CENTER_LON',
    resultRecordCount: '25',
  });
  const data = await fetchJson(COUNTY_PARCEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return (data?.features || []).map(feature => feature.attributes || {}).map(row => ({
    apn: clean(row.APN || row.AIN, 30),
    ain: clean(row.AIN, 20),
    address: clean(row.SitusFullAddress),
    lotSf: Math.round(number(row.Shape__Area, 0)),
    useCode: clean(row.UseCode, 30),
    useType: clean(row.UseType, 80),
    useDescription: clean(row.UseDescription, 120),
    yearBuilt: number(row.YearBuilt1),
    existingUnits: number(row.Units1),
    existingBuildingSf: number(row.SQFTmain1),
    lat: number(row.CENTER_LAT),
    lng: number(row.CENTER_LON),
    source: 'LA County Assessor parcel polygon',
  })).filter(row => row.lotSf >= 500);
}

async function parcelLookupByApns(apns = []) {
  const ains = apns.map(value => String(value).replace(/\D/g, '')).filter(value => value.length === 10);
  if (!ains.length) return [];
  const where = `AIN IN (${ains.map(value => `'${value}'`).join(',')})`;
  const params = new URLSearchParams({
    f: 'json', returnGeometry: 'false', where,
    outFields: 'AIN,APN,SitusFullAddress,SitusCity,SitusZIP,UseCode,UseType,UseDescription,YearBuilt1,Units1,SQFTmain1,Shape__Area,CENTER_LAT,CENTER_LON',
    resultRecordCount: '100',
  });
  const data = await fetchJson(`${COUNTY_PARCEL_URL}?${params}`, {}, 20000);
  return (data?.features || []).map(feature => feature.attributes || {}).map(row => ({
    apn: clean(row.APN || row.AIN, 30), ain: clean(row.AIN, 20), address: clean(row.SitusFullAddress),
    lotSf: Math.round(number(row.Shape__Area, 0)), useCode: clean(row.UseCode, 30), useType: clean(row.UseType, 80),
    useDescription: clean(row.UseDescription, 120), yearBuilt: number(row.YearBuilt1), existingUnits: number(row.Units1),
    existingBuildingSf: number(row.SQFTmain1), lat: number(row.CENTER_LAT), lng: number(row.CENTER_LON),
    source: 'LA County Assessor parcel polygon',
  })).filter(row => row.lotSf >= 500);
}

function santaAnaAddressLine(value) {
  return clean(value).toUpperCase().split(',')[0]
    .replace(/\s+(?:APT|UNIT|STE|SUITE)\s+.*$/, '')
    .replace(/\s+#.*$/, '')
    .trim();
}

async function santaAnaParcelLookup(address) {
  const addressLine = santaAnaAddressLine(address);
  if (!addressLine) return [];
  const addressSql = addressLine.replace(/'/g, "''");
  const quoted = `'${addressSql}'`;
  const body = new URLSearchParams({
    f: 'json',
    where: `SiteAddress=${quoted} OR SiteAddress LIKE '${addressSql} #%'`,
    outFields: 'SiteAddress,SiteCityState,SiteZip5,UNIQUE_PARCEL_APN,PARCEL_APN,LAND_SQFT,Neighborhood,HistoricDistrict,FloodZone,Liquefaction,GP_Designation,GP_Intensity,GP_Density,ZN_Class,ZN_Suffix,ZN_Overlay,ZN_UseSuffix,HeightExemptArea,ParkDeficientArea',
    returnGeometry: 'false',
    resultRecordCount: '500',
  });
  const data = await fetchJson(SANTA_ANA_PARCEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 20000);
  const byParentApn = new Map();
  for (const feature of data?.features || []) {
    const row = feature.attributes || {};
    const apn = clean(row.PARCEL_APN || row.UNIQUE_PARCEL_APN, 30);
    if (!apn || byParentApn.has(apn)) continue;
    const zoneParts = [row.ZN_Class, row.ZN_Suffix, row.ZN_Overlay, row.ZN_UseSuffix].map(value => clean(value, 30)).filter(Boolean);
    byParentApn.set(apn, {
      apn,
      address: clean(row.SiteAddress),
      lotSf: Math.round(number(row.LAND_SQFT, 0)),
      neighborhood: clean(row.Neighborhood, 80),
      zone: zoneParts.join('-'),
      generalPlan: clean(row.GP_Designation, 60),
      generalPlanDensity: number(row.GP_Density),
      generalPlanIntensity: number(row.GP_Intensity),
      historicDistrict: clean(row.HistoricDistrict, 80),
      floodZone: clean(row.FloodZone, 40),
      liquefaction: clean(row.Liquefaction, 5) === 'Y',
      heightExemptArea: clean(row.HeightExemptArea, 5) === 'Y',
      parkDeficientArea: clean(row.ParkDeficientArea, 5) === 'Y',
      source: 'City of Santa Ana parcel GIS',
    });
  }
  return [...byParentApn.values()].filter(row => row.lotSf >= 500);
}

function santaAnaZoneProfile(zone, parcel) {
  const base = clean(zone, 40).toUpperCase();
  const density = number(parcel?.generalPlanDensity);
  const far = number(parcel?.generalPlanIntensity) || (/^R1/.test(base) ? 0.45 : /^R2/.test(base) ? 0.6 : /^R3/.test(base) ? 1.5 : /^R4/.test(base) ? 2 : 1.5);
  const lotPerUnit = density ? 43560 / density : /^R1/.test(base) ? 6000 : /^R2/.test(base) ? 3000 : /^R3/.test(base) ? 1500 : /^R4/.test(base) ? 500 : null;
  const family = /^R1/.test(base) ? 'single' : /^R[234]/.test(base) ? 'multi' : /^M/.test(base) ? 'industrial' : /^(C|CR|SD|SP|TV)/.test(base) ? 'commercial' : 'unknown';
  const uses = family === 'single'
    ? ['single_family']
    : family === 'multi'
      ? ['apartment', 'townhome', 'condo', 'single_family']
      : family === 'industrial'
        ? ['industrial', 'light_manufacturing', 'office']
        : family === 'commercial'
          ? ['apartment', 'mixed_use', 'condo', 'office', 'retail', 'hotel']
          : [];
  return { family, far, height: /^R1|^R2/.test(base) ? 35 : 55, stories: /^R1|^R2/.test(base) ? 2 : 4, lotPerUnit, uses, recognized: family !== 'unknown' };
}

async function zoningLookup(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const params = new URLSearchParams({
    f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false',
  });
  const data = await fetchJson(`${LA_ZONING_URL}?${params}`);
  return [...new Set((data?.features || []).map(feature => clean(feature.attributes?.Zoning || feature.attributes?.ZONING, 80)).filter(Boolean))];
}

function normalizeComp(row) {
  return {
    address: clean(row.address || row.property_address),
    neighborhood: clean(row.neighborhood),
    type: clean(row.project_type || row.property_type),
    saleDate: row.sale_date || null,
    price: number(row.sale_price || row.price),
    units: number(row.units),
    buildingSf: number(row.building_sf || row.square_feet),
    pricePerUnit: number(row.price_per_unit),
    pricePerSf: number(row.price_per_sf),
    capRate: number(row.cap_rate),
    source: clean(row.source, 80),
  };
}

function normalizeRentComp(row) {
  return {
    address: clean(row.address), neighborhood: clean(row.neighborhood), bedrooms: number(row.bedrooms),
    monthlyRent: number(row.monthly_rent || row.rent), squareFeet: number(row.square_feet || row.sqft),
    rentPerSf: number(row.rent_per_sf), period: row.period || row.listed_date || null, source: clean(row.source, 80),
  };
}

async function compRows(table, neighborhood, dateColumn, limit, allowAreaFallback = true) {
  const local = await supabaseAdmin.from(table).select('*')
    .ilike('neighborhood', neighborhood).order(dateColumn, { ascending: false }).limit(limit);
  if (!local.error && local.data?.length) return { rows: local.data, scope: neighborhood };
  if (!allowAreaFallback) return { rows: [], scope: null };

  const fallback = await supabaseAdmin.from(table).select('*')
    .order(dateColumn, { ascending: false }).limit(limit);
  return {
    rows: fallback.error ? [] : (fallback.data || []),
    scope: fallback.error || !fallback.data?.length ? null : 'Los Angeles area',
  };
}

async function evidence(neighborhood, use, allowAreaFallback = true) {
  if (!neighborhood) return { sales: [], rents: [], salesScope: null, rentScope: null };
  const wantsRents = ['apartment', 'mixed_use'].includes(use);
  const [salesResult, rentsResult] = await Promise.allSettled([
    compRows('sold_comps', neighborhood, 'sale_date', 8, allowAreaFallback),
    wantsRents ? compRows('rent_comps', neighborhood, 'period', 10, allowAreaFallback) : Promise.resolve({ rows: [], scope: null }),
  ]);
  const salesValue = salesResult.status === 'fulfilled' ? salesResult.value : { rows: [], scope: null };
  const rentsValue = rentsResult.status === 'fulfilled' ? rentsResult.value : { rows: [], scope: null };
  return {
    sales: salesValue.rows.map(normalizeComp),
    rents: rentsValue.rows.map(normalizeRentComp),
    salesScope: salesValue.scope,
    rentScope: rentsValue.scope,
  };
}

async function existingSite(address) {
  const numberPart = clean(address).match(/^\d+/)?.[0];
  if (!numberPart) return null;
  const { data, error } = await supabaseAdmin.from('sites')
    .select('id,address,neighborhood,project_type,zoning,lot_sf,units,avg_unit_sf,lat,lng,price,status,permit_source_id')
    .ilike('address', `${numberPart}%`).limit(25);
  if (error) return null;
  const tokens = clean(address).toUpperCase().split(',')[0].split(/\W+/)
    .filter(token => token.length > 2 && !['STREET', 'AVENUE', 'BOULEVARD', 'DRIVE', 'ROAD'].includes(token));
  return (data || []).find(row => tokens.every(token => clean(row.address).toUpperCase().includes(token))) || null;
}

router.get('/uses', (req, res) => {
  res.json({ uses: Object.entries(FEASIBILITY_USES).map(([id, profile]) => ({ id, label: profile.label, group: profile.group })) });
});

router.post('/analyze', requireAuth, async (req, res, next) => {
  try {
    const address = clean(req.body?.address);
    const use = clean(req.body?.use, 40);
    if (address.length < 6) return res.status(400).json({ error: 'Enter a complete street address.' });
    if (!FEASIBILITY_USES[use]) return res.status(400).json({ error: 'Select a supported proposed use.' });

    const verifiedProject = VERIFIED_PROJECTS.find(project => project.match(address)) || null;
    let geo;
    try {
      geo = await geocode(verifiedProject?.geocodeAddress || verifiedProject?.displayAddress || address);
    } catch (error) {
      const hasLocality = address.split(',').length >= 2;
      if (verifiedProject || hasLocality) throw error;
      geo = await geocode(`${address}, Los Angeles, CA`);
    }
    const inLosAngelesCity = /los angeles city/i.test(geo.jurisdiction);
    const inSantaAna = /santa ana city/i.test(geo.jurisdiction) || /^santa ana$/i.test(geo.city);
    const jurisdictionSources = inSantaAna ? SANTA_ANA_SOURCES : LOS_ANGELES_SOURCES;
    const [parcelResult, siteResult] = await Promise.allSettled([
      verifiedProject
        ? parcelLookupByApns(verifiedProject.apns)
        : inSantaAna
          ? santaAnaParcelLookup(geo.formattedAddress || address)
          : parcelLookup(geo.formattedAddress || address),
      inSantaAna ? Promise.resolve(null) : existingSite(address),
    ]);
    const parcels = parcelResult.status === 'fulfilled' ? parcelResult.value : [];
    const matchedSite = siteResult.status === 'fulfilled' ? siteResult.value : null;
    const userLotSf = number(req.body?.lotSf);
    const parcelLotSf = parcels.reduce((sum, parcel) => sum + (parcel.lotSf || 0), 0);
    const lotSf = userLotSf || number(verifiedProject?.lotSf) || parcelLotSf || number(matchedSite?.lot_sf) || 7500;
    const zoningPoints = inLosAngelesCity ? [
      ...parcels.map(parcel => ({ lat: parcel.lat, lng: parcel.lng })),
      { lat: geo.lat, lng: geo.lng },
    ].filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)) : [];
    const zoningResults = await Promise.allSettled(zoningPoints.map(point => zoningLookup(point.lat, point.lng)));
    const zoningValues = inSantaAna
      ? [...new Set(parcels.map(parcel => parcel.zone).filter(Boolean))]
      : [...new Set(zoningResults.flatMap(result => result.status === 'fulfilled' ? result.value : []))];
    const zone = clean(req.body?.zone || verifiedProject?.zone || zoningValues[0] || matchedSite?.zoning || '', 80);
    const santaAnaParcel = inSantaAna ? parcels[0] : null;
    const neighborhood = clean(req.body?.neighborhood || santaAnaParcel?.neighborhood || matchedSite?.neighborhood || geo.city || 'Los Angeles', 80);
    const acquisitionPrice = number(req.body?.acquisitionPrice) || number(matchedSite?.price) || 0;
    const marketRents = RENTS[neighborhood] || RENTS.Koreatown;
    const oneBedRentPsf = inSantaAna ? 3.25 : marketRents?.one ? marketRents.one / 750 : 4;
    const market = ['apartment', 'mixed_use'].includes(use) ? {
      rentPsfMo: Number(oneBedRentPsf.toFixed(2)),
      capRate: CAP_RATES[neighborhood] || 0.0525,
    } : {};
    const assumptions = {
      landCost: acquisitionPrice,
      hardCostPsf: number(req.body?.hardCostPsf) || undefined,
      softCostPct: number(req.body?.softCostPct) != null ? number(req.body.softCostPct) / 100 : undefined,
      interestRate: number(req.body?.interestRate) != null ? number(req.body.interestRate) / 100 : undefined,
      ltc: number(req.body?.ltc) != null ? number(req.body.ltc) / 100 : undefined,
      avgUnitSf: number(req.body?.avgUnitSf) || undefined,
      market,
    };
    const santaAnaProfile = inSantaAna ? santaAnaZoneProfile(zone, santaAnaParcel) : null;
    const santaAnaBaseUnits = !userLotSf && santaAnaParcel?.generalPlanDensity
      ? Math.max(1, Math.floor(lotSf * santaAnaParcel.generalPlanDensity / 43560))
      : undefined;
    const engine = generateFeasibilityScenarios({
      address: verifiedProject?.displayAddress || geo.formattedAddress, use, lotSf, zone, jurisdiction: geo.jurisdiction,
      inLosAngelesCity, inSantaAna, inCalifornia: /CA\b|california/i.test(geo.formattedAddress), assumptions, sources: jurisdictionSources,
      zoneProfile: santaAnaProfile,
      baseFar: verifiedProject?.baseFar || santaAnaParcel?.generalPlanIntensity || santaAnaProfile?.far,
      baseUnits: userLotSf ? undefined : verifiedProject?.baseUnits || santaAnaBaseUnits,
      baseUnitsVerified: Boolean(verifiedProject?.baseUnits),
      approvedProject: verifiedProject?.approvedProject,
    });
    const comps = await evidence(neighborhood, use, !inSantaAna);
    const warnings = [
      !parcels.length && !verifiedProject ? 'Parcel geometry and APN were not returned automatically; confirm lot area before relying on capacity.' : null,
      !zone ? `Zoning was not returned automatically; enter the ${inSantaAna ? 'Santa Ana' : 'ZIMAS'} base zone to improve the screen.` : null,
      inSantaAna && /^(SD|SP)/i.test(zone) ? `${zone} is a special-development or specific-plan zone. The controlling adopted plan must be reviewed before relying on setbacks, height, FAR or permitted uses.` : null,
      inSantaAna && santaAnaParcel?.historicDistrict ? `Historic district: ${santaAnaParcel.historicDistrict}. Historic-resource review may constrain demolition or design.` : null,
      inSantaAna && santaAnaParcel?.liquefaction ? 'The City parcel record flags a liquefaction area; confirm geotechnical and seismic requirements.' : null,
      inSantaAna && !comps.sales.length && !comps.rents.length ? 'No Santa Ana market comps are stored yet; underwriting uses screening market assumptions until local monthly comp coverage is added.' : null,
      !inLosAngelesCity && !inSantaAna ? `${geo.jurisdiction || geo.city || 'This address'} is outside the currently supported Los Angeles and Santa Ana jurisdictions.` : null,
      !acquisitionPrice ? 'No acquisition price was entered, so land cost is shown as $0 and returns are not decision-ready.' : null,
      'Capacity is a preliminary screening estimate, not a zoning determination, entitlement opinion, appraisal, engineering study or offer to lend.',
    ].filter(Boolean);

    res.set('Cache-Control', 'private, no-store');
    res.json({
      generatedAt: new Date().toISOString(), address: verifiedProject?.displayAddress || geo.formattedAddress, geocode: geo,
      jurisdiction: { name: geo.jurisdiction || geo.city, inLosAngelesCity, inSantaAna },
      parcel: {
        lotSf,
        lotSfSource: userLotSf ? 'User override' : verifiedProject ? verifiedProject.sourceLabel : inSantaAna && parcels.length ? 'City of Santa Ana parcel GIS' : parcels.length ? 'LA County parcel polygon' : matchedSite?.lot_sf ? 'ParcelLA site record' : 'Screening default',
        apns: verifiedProject?.apns || parcels.map(row => row.apn).filter(Boolean),
        generalPlan: santaAnaParcel ? { designation: santaAnaParcel.generalPlan, density: santaAnaParcel.generalPlanDensity, intensity: santaAnaParcel.generalPlanIntensity } : null,
        hazards: santaAnaParcel ? { historicDistrict: santaAnaParcel.historicDistrict || null, floodZone: santaAnaParcel.floodZone || null, liquefaction: santaAnaParcel.liquefaction } : null,
        parcels,
      },
      zoning: {
        value: verifiedProject?.zones?.join(' / ') || zone || null,
        values: zoningValues,
        source: inSantaAna && zoningValues.length ? 'City of Santa Ana parcel and zoning GIS' : zoningValues.length ? 'Los Angeles City Planning zoning GIS' : verifiedProject?.sourceLabel || null,
        needsVerification: !verifiedProject,
      },
      neighborhood, matchedSite, verifiedProject: verifiedProject ? { displayAddress: verifiedProject.displayAddress, sourceLabel: verifiedProject.sourceLabel, sourceUrl: verifiedProject.sourceUrl } : null,
      ...engine, comps,
      sources: verifiedProject ? [{ label: verifiedProject.sourceLabel, url: verifiedProject.sourceUrl, purpose: 'Verified site area, zoning, base density and approved project' }, ...jurisdictionSources] : jurisdictionSources,
      warnings,
    });
  } catch (error) {
    if (error.name === 'AbortError') error.message = 'A public parcel or zoning service timed out. Please retry.';
    next(error);
  }
});

export default router;
export { santaAnaParcelLookup, santaAnaZoneProfile };
