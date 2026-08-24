/**
 * ParceLLA — Sites Router
 * GET  /api/sites              — list with filters + pre-underwriting
 * GET  /api/sites/:id          — single site + full model
 * GET  /api/sites/:id/enrich   — run LA open data enrichment
 * GET  /api/sites/:id/demand   — demand score
 * POST /api/sites/:id/save     — save to user's list (auth required)
 * DELETE /api/sites/:id/save   — unsave (auth required)
 */

import { Router } from 'express';
import { SITES, normalizeSite } from '../../src/data/sites.js';
import { runModel, runScenarios } from '../../src/model/financialModel.js';
import { RENTS } from '../../src/data/submarkets.js';
import { enrichSite }    from '../../src/data/laOpenData.js';
import { scoreSiteDemand, SUBMARKET_CENSUS_ESTIMATES } from '../../src/scoring/DemandScore.js';
import { requireAuth, optionalAuth, getUserAccessFast } from '../middleware/auth.js';
import { validateSiteFilters, validateModelOverrides } from '../middleware/middleware.js';
import { supabase } from '../../src/data/supabase.js';
import {
  LAND_COMP_RECENCY_DAYS,
  buildLandCompBenchmarks,
  estimateLandBasisFromComps,
} from '../../src/data/landValue.js';

const router = Router();

// Cache computed model results (refreshed every 5 min)
let _siteCache = null;
let _cacheTime = 0;
const _modelCache = new Map();
let _landCompCache = null;
let _landCompCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SITE_LOAD_PAGE_SIZE = 1000;
const MODEL_CACHE_LIMIT = 12;
const DEFAULT_MARKET_LAND_PER_DOOR = 100000;
const SITE_LIST_SELECT = [
  'id',
  'address',
  'neighborhood',
  'project_type',
  'zoning',
  'lot_sf',
  'units',
  'avg_unit_sf',
  'rti',
  'is_comp',
  'price',
  'status',
  'has_demo',
  'lat',
  'lng',
  'permit_source_id',
  'total_cost',
  'hard_costs',
  'soft_costs',
  'carry_cost',
  'noi',
  'exit_value',
  'net_profit',
  'irr_v',
  'cap_on_cost',
  'dev_spread_pct',
  'entry_cap_rate',
  'owner_name',
  'owner_last_sale_date',
  'owner_last_sale_amount',
  'owner_source',
  'underwritten_at',
  'raw_permit_data',
].join(',');
const SITE_SEARCH_SELECT = SITE_LIST_SELECT
  .split(',')
  .filter(column => column !== 'raw_permit_data')
  .join(',');

const NEIGHBORHOOD_BOXES = [
  {h:'Silver Lake',lat0:34.070,lat1:34.105,lng0:-118.290,lng1:-118.250},
  {h:'Echo Park',lat0:34.060,lat1:34.085,lng0:-118.280,lng1:-118.248},
  {h:'Los Feliz',lat0:34.095,lat1:34.125,lng0:-118.310,lng1:-118.270},
  {h:'Highland Park',lat0:34.095,lat1:34.135,lng0:-118.235,lng1:-118.175},
  {h:'Koreatown',lat0:34.045,lat1:34.075,lng0:-118.325,lng1:-118.285},
  {h:'Mid-Wilshire',lat0:34.055,lat1:34.075,lng0:-118.365,lng1:-118.325},
  {h:'Hollywood',lat0:34.085,lat1:34.110,lng0:-118.340,lng1:-118.300},
  {h:'West Adams',lat0:34.000,lat1:34.035,lng0:-118.355,lng1:-118.315},
  {h:'Culver City',lat0:33.995,lat1:34.030,lng0:-118.420,lng1:-118.375},
  {h:'Mar Vista',lat0:33.982,lat1:34.010,lng0:-118.455,lng1:-118.415},
  {h:'Venice',lat0:33.975,lat1:34.005,lng0:-118.480,lng1:-118.445},
  {h:'West LA',lat0:34.030,lat1:34.060,lng0:-118.455,lng1:-118.420},
  {h:'Brentwood',lat0:34.040,lat1:34.075,lng0:-118.490,lng1:-118.450},
  {h:'Pacific Palisades',lat0:34.030,lat1:34.080,lng0:-118.545,lng1:-118.490},
  {h:'Studio City',lat0:34.130,lat1:34.162,lng0:-118.430,lng1:-118.370},
  {h:'Sherman Oaks',lat0:34.140,lat1:34.178,lng0:-118.480,lng1:-118.415},
  {h:'Encino',lat0:34.145,lat1:34.180,lng0:-118.530,lng1:-118.480},
  {h:'Van Nuys',lat0:34.175,lat1:34.215,lng0:-118.465,lng1:-118.415},
  {h:'North Hollywood',lat0:34.155,lat1:34.195,lng0:-118.390,lng1:-118.350},
  {h:'Woodland Hills',lat0:34.155,lat1:34.200,lng0:-118.640,lng1:-118.580},
  {h:'Reseda',lat0:34.190,lat1:34.225,lng0:-118.545,lng1:-118.500},
  {h:'Northridge',lat0:34.220,lat1:34.260,lng0:-118.555,lng1:-118.500},
];

function hoodFromCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const match = NEIGHBORHOOD_BOXES.find(b => la >= b.lat0 && la <= b.lat1 && ln >= b.lng0 && ln <= b.lng1);
  return match?.h || null;
}

function normalizedNeighborhood(s = {}) {
  const raw = String(s.neighborhood ?? s.hood ?? '').trim();
  const inferred = hoodFromCoords(s.lat, s.lng);
  if (!raw) return inferred;
  if (raw === 'Koreatown' && inferred && inferred !== 'Koreatown') return inferred;
  return raw;
}

function normalizedLotSf(s = {}) {
  const lot = Number(s.lot_sf ?? s.lot ?? 0);
  if (!Number.isFinite(lot) || lot <= 0) return null;
  const likelyDefault = lot === 5000 && (
    String(s.status || '').toLowerCase().includes('off') ||
    s.permit_source_id ||
    s.raw_permit_data?.permit_number
  );
  return likelyDefault ? null : lot;
}

// Guess project type from permit data
function guessType(permitType, subType, units) {
  const pt = (permitType || '').toLowerCase();
  const st = (subType || '').toLowerCase();
  if (st.includes('adu') || st.includes('accessory') || st.includes('addition')) return null;
  if (st.includes('single') || (st.includes('1 or 2') && (units || 0) <= 1) || (units || 0) === 1) return 'New House';
  if (st.includes('condo') || st.includes('townhouse')) return 'Condo/TH';
  if (st.includes('commercial') || st.includes('mixed')) return 'Mixed-Use';
  if (units >= 5) return 'Multifamily';
  if (units >= 2) return 'Multifamily';
  return 'New House';
}

// Guess neighborhood from LA address
function guessHood(address, zone) {
  if (!address) return 'Koreatown';
  const addr = address.toUpperCase();
  if (addr.includes('SILVER LAKE') || addr.includes('SILVERLAKE')) return 'Silver Lake';
  if (addr.includes('ECHO PARK')) return 'Echo Park';
  if (addr.includes('HIGHLAND PARK')) return 'Highland Park';
  if (addr.includes('LOS FELIZ')) return 'Los Feliz';
  if (addr.includes('CULVER')) return 'Culver City';
  if (addr.includes('MAR VISTA')) return 'Mar Vista';
  if (addr.includes('PACIFIC PALISADES') || addr.includes('PALISADES')) return 'Pacific Palisades';
  if (addr.includes('BRENTWOOD')) return 'Brentwood';
  if (addr.includes('VENICE')) return 'Venice';
  if (addr.includes('WEST ADAMS')) return 'West Adams';
  if (addr.includes('BOYLE')) return 'Boyle Heights';
  if (addr.includes('MID-WILSHIRE') || addr.includes('WILSHIRE')) return 'Mid-Wilshire';
  // Guess by zip or street
  return 'Koreatown';  // default fallback
}

function perDoorLandBasis(type, units) {
  if (!['Multifamily', 'Mixed-Use'].includes(type) || !Number(units || 0)) return null;
  const perDoor = DEFAULT_MARKET_LAND_PER_DOOR;
  return {
    value: Math.round(perDoor * Number(units || 0)),
    source: 'default_market_per_door',
    metricLabel: 'price per door',
    metricValue: perDoor,
    basisQuantity: Number(units || 0),
    compCount: 0,
    matchLabel: 'market-rate default',
    recencyDays: LAND_COMP_RECENCY_DAYS,
    comps: [],
  };
}

const DEFAULT_UNIT_MIX = { studio: 0.25, one: 0.50, two: 0.20, three: 0.05 };

function normalizeUnitMix(mix = {}) {
  const values = {
    studio: Number(mix.studio ?? mix.s ?? 0),
    one: Number(mix.one ?? mix.o ?? 0),
    two: Number(mix.two ?? mix.t ?? 0),
    three: Number(mix.three ?? mix.th ?? 0),
  };
  const sum = values.studio + values.one + values.two + values.three;
  if (!Number.isFinite(sum) || sum <= 0) return { ...DEFAULT_UNIT_MIX };
  return {
    studio: values.studio / sum,
    one: values.one / sum,
    two: values.two / sum,
    three: values.three / sum,
  };
}

function addUnitMixMatches(text, key, patterns, counts) {
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(String(match[1] || '').replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) counts[key] += value;
    }
  }
}

function parseUnitMixFromText(...values) {
  const text = values.map(value => String(value || '').toLowerCase()).join(' ');
  if (!text.trim()) return null;
  const counts = { studio: 0, one: 0, two: 0, three: 0 };
  addUnitMixMatches(text, 'studio', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:studio|studios|efficiency|efficiencies|bachelor|bachelors|sro|sros)\b/g,
    /(?:studio|studios|efficiency|efficiencies|bachelor|bachelors|sro|sros)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 'one', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 'two', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 'three', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  const parsedTotal = counts.studio + counts.one + counts.two + counts.three;
  return parsedTotal > 0 ? { counts, mix: normalizeUnitMix(counts), parsedTotal } : null;
}

function unitMixForSite(raw = {}, site = {}, type = site.project_type ?? site.type) {
  if (type === 'New House') {
    return { mix: { studio: 0, one: 0, two: 0, three: 1 }, counts: null, parsedTotal: 0, source: 'New house assumption' };
  }
  if (raw.unit_mix && typeof raw.unit_mix === 'object') {
    return {
      mix: normalizeUnitMix(raw.unit_mix),
      counts: raw.unit_mix_counts || null,
      parsedTotal: Number(raw.unit_mix_parsed_total || 0),
      source: raw.unit_mix_source || 'Stored unit mix',
    };
  }
  const parsed = parseUnitMixFromText(
    raw.unit_mix_text,
    raw.work_description,
    raw.project_description,
    raw.use_desc,
    raw.scope,
    site.description
  );
  if (parsed) return { ...parsed, source: 'Parsed from permit text' };
  return { mix: { ...DEFAULT_UNIT_MIX }, counts: null, parsedTotal: 0, source: 'Default market mix' };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text !== '0' && text.toLowerCase() !== 'null') return text;
  }
  return null;
}

function ownerInfoFromRaw(raw = {}, site = {}) {
  const stored = raw.owner_info && typeof raw.owner_info === 'object' ? raw.owner_info : {};
  const ownerName = firstText(
    stored.owner_name,
    stored.ownerName,
    raw.owner_name,
    raw.ownerName,
    raw.owner,
    raw.ownername,
    raw.property_owner,
    raw.first_owner_name,
    raw.First_Owner_Name,
    raw.firstOwnerName,
    site.owner_name,
    site.ownerName
  );
  const applicantName = firstText(
    stored.applicant_name,
    stored.applicantName,
    raw.applicant_name,
    raw.applicantName,
    raw.applicant,
    raw.contact_name,
    raw.contractor_name
  );
  const mailingAddress = firstText(
    stored.owner_mailing_address,
    stored.mailingAddress,
    raw.owner_mailing_address,
    raw.mailing_address,
    raw.mail_address,
    raw.owner_address
  );
  const apn = firstText(stored.apn, raw.apn, raw.ain, raw.AIN, raw.parcel_number, site.apn);
  if (!ownerName && !applicantName && !mailingAddress && !apn) return {};
  return {
    ownerName: ownerName || applicantName || null,
    ownerApplicantName: applicantName,
    ownerMailingAddress: mailingAddress,
    ownerSitusAddress: firstText(stored.situs_address, stored.situsAddress, raw.situs_address, raw.site_address, site.address, site.addr),
    ownerApn: apn,
    ownerLastSaleDate: firstText(stored.last_sale_date, stored.lastSaleDate, raw.last_sale_date, raw.lastSaleDate, raw.sale_date, site.owner_last_sale_date),
    ownerLastSaleAmount: firstText(stored.last_sale_amount, stored.lastSaleAmount, raw.last_sale_amount, raw.lastSaleAmount, raw.sale_price, site.owner_last_sale_amount),
    ownerSource: stored.source || raw.owner_source || site.owner_source || 'Permit/source record',
  };
}

// ── Shared underwriting defaults ───────────────────────────────────────────────
const DEFAULT_GLOBALS = {
  exitCapSpread: 0.0025,
  hcpsf:         null,     // falls back to RSMeans by type
  sc:            18,
  vac:           0.05,
  opex:          0.35,
  ltc:           0.65,
  rate:          0.065,
  months:        18,
  hold:          5,
  app:           0.03,
  ppu:           150000,
  psf:           185,
  method:        'ppu',
};

function buildOverrides(query) {
  const ov = {};
  if (query.exitCap)  ov.exitCap  = +query.exitCap;
  if (query.hcpsf) { ov.hcpsf = +query.hcpsf; ov.hardCostPerSF = +query.hcpsf; }
  if (query.rate) { const rate = +query.rate; ov.rate = rate > 1 ? rate / 100 : rate; ov.interestRate = ov.rate; }
  if (query.sc)       ov.sc       = +query.sc;
  if (query.ppu)      ov.ppu      = +query.ppu;
  if (query.psf)      ov.psf      = +query.psf;
  if (query.method)   ov.method   = query.method;
  return ov;
}

async function getLandCompBenchmarks() {
  const now = Date.now();
  if (_landCompCache && now - _landCompCacheTime < CACHE_TTL) return _landCompCache;
  if (!process.env.SUPABASE_URL) return null;

  const cutoff = new Date(Date.now() - LAND_COMP_RECENCY_DAYS * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('sold_comps')
    .select('address,neighborhood,project_type,units,avg_unit_sf,sale_price,sale_date,price_per_unit,price_per_sf,source,recorder_document_number')
    .gte('sale_date', cutoff)
    .order('sale_date', { ascending: false })
    .limit(5000);

  if (error) {
    console.warn('[sites] Land comp benchmarks unavailable:', error.message);
    return null;
  }

  _landCompCache = buildLandCompBenchmarks(data || [], { recencyDays: LAND_COMP_RECENCY_DAYS });
  _landCompCacheTime = now;
  return _landCompCache;
}

function modelFromSupabaseSite(s, landCompBenchmarks = null) {
  const rawPermit = s.raw_permit_data || {};
  const totalCost = s.total_cost || 0;
  const price = s.price || 0;
  const interestCarryPct = 0.65 * 0.065 * 1.5; // 65% LTC, 6.5%, 18 months
  const preCarryCost = totalCost > 0 ? totalCost / (1 + interestCarryPct) : 0;
  const type = s.project_type ?? s.type ?? 'Multifamily';
  const units = Number(s.units || 0);
  const avgUnitSf = Number(s.avg_unit_sf || s.usf || 800);
  const neighborhood = normalizedNeighborhood(s) || 'Koreatown';
  const unitMix = unitMixForSite(rawPermit, s, type);
  const rents = RENTS[neighborhood] || RENTS.Koreatown;
  const blendedRent = (
    unitMix.mix.studio * (rents.studio || 0) +
    unitMix.mix.one * (rents.one || 0) +
    unitMix.mix.two * (rents.two || 0) +
    unitMix.mix.three * (rents.three || 0)
  );
  const grossPotentialRent = Math.round(blendedRent * 12 * units);
  const totalSf = units * avgUnitSf;
  const hardPsf = { 'Multifamily':285, 'Mixed-Use':320, 'Condo/TH':340, 'New House':275 }[type] || 285;
  let hardFallback = totalSf > 0 ? hardPsf * totalSf : Math.max(0, preCarryCost - price) / 1.18;
  if (totalSf > 100000) hardFallback *= 0.93;
  else if (totalSf > 50000) hardFallback *= 0.95;
  hardFallback = Math.round(hardFallback);
  const softFallback = Math.round(hardFallback * 0.18);
  const carryFallback = Math.max(0, totalCost - preCarryCost);
  const hardCosts = s.hard_costs ?? s.hardCosts ?? hardFallback;
  const softCosts = s.soft_costs ?? s.softCosts ?? softFallback;
  const carryCost = s.carry_cost ?? s.carryCost ?? carryFallback;
  const fallbackLandCost = Math.max(0, Math.round(preCarryCost - hardCosts - softCosts));
  const offMarket = /off|not for sale/i.test(String(s.status || ''));
  const doorLand = offMarket ? perDoorLandBasis(type, units) : null;
  const compLand = offMarket ? estimateLandBasisFromComps({
    neighborhood,
    project_type: type,
    units,
    avg_unit_sf: avgUnitSf,
    lot_sf: normalizedLotSf(s),
    totalSF: totalSf,
    lat: s.lat,
    lng: s.lng,
  }, landCompBenchmarks) : null;
  const landCost = offMarket
    ? (doorLand?.value || compLand?.value || price || fallbackLandCost)
    : (price || fallbackLandCost);
  const usedDynamicLand = offMarket && !!(doorLand?.value || (compLand?.value && !price));
  const landMeta = doorLand || compLand || {};
  const recastCarry = usedDynamicLand ? Math.round((landCost + hardCosts + softCosts) * interestCarryPct) : carryCost;
  const recastTotalCost = usedDynamicLand ? landCost + hardCosts + softCosts + recastCarry : totalCost;
  const exitValue = s.exit_value || 0;
  const noi = unitMix.source === 'Parsed from permit text'
    ? Math.round(((grossPotentialRent * 0.95) + (units * 600)) * 0.65)
    : (s.noi || 0);
  const netProfit = usedDynamicLand && exitValue ? exitValue - recastTotalCost : (s.net_profit || 0);

  return {
    noi,
    totalCost: recastTotalCost,
    landCost,
    landValueSource: landMeta.source || rawPermit.land_value_source || (offMarket ? 'permit_valuation_fallback' : 'asking_price'),
    landValueMetric: landMeta.metricLabel || rawPermit.land_value_metric || null,
    landValueMetricValue: landMeta.metricValue || rawPermit.land_value_metric_value || null,
    landValueBasisQuantity: landMeta.basisQuantity || rawPermit.land_value_basis_quantity || null,
    landValueCompCount: landMeta.compCount || rawPermit.land_value_comp_count || 0,
    landValueMatch: landMeta.matchLabel || rawPermit.land_value_match || null,
    landValueRecencyDays: landMeta.recencyDays || rawPermit.land_value_recency_days || LAND_COMP_RECENCY_DAYS,
    landValueComps: landMeta.comps || rawPermit.land_value_comps || [],
    exitValue,
    exitProceeds:  netProfit,
    netProfit,
    grossPotentialRent: unitMix.source === 'Parsed from permit text' ? grossPotentialRent : undefined,
    leveragedIRR:  s.irr_v        || 0,
    capRateOnCost: recastTotalCost ? noi / recastTotalCost : (s.cap_on_cost || 0) / 100,
    devSpreadPct:  recastTotalCost ? (exitValue - recastTotalCost) / recastTotalCost : (s.dev_spread_pct || 0) / 100,
    marketCapRate: 0.0500,
    price,
    hardCosts,
    softCosts,
    carryCost: recastCarry,
    loanAmount:    recastTotalCost * 0.65,
    equity:        recastTotalCost * 0.35,
    equityMultiple: recastTotalCost > 0 ? (exitValue / (recastTotalCost * 0.35)) : 0,
  };
}

function mapSupabaseSite(s, i = 0, landCompBenchmarks = null) {
  const rawPermit = s.raw_permit_data || {};
  const addressAliases = Array.isArray(rawPermit.address_aliases) ? rawPermit.address_aliases : [];
  const status = s.status || 'active';
  const offMarket = /off|not for sale/i.test(status);
  const neighborhood = normalizedNeighborhood(s) || 'Neighborhood TBD';
  const lotSf = normalizedLotSf(s);
  const model = modelFromSupabaseSite(s, landCompBenchmarks);
  const unitMix = unitMixForSite(rawPermit, s, s.project_type ?? s.type);
  const ownerInfo = ownerInfoFromRaw(rawPermit, s);
  return {
    id:           s.id || (50000 + i),
    addr:         s.address ?? s.addr,
    hood:         neighborhood,
    type:         s.project_type ?? s.type ?? 'Multifamily',
    zone:         s.zoning ?? s.zone ?? null,
    lot:          lotSf,
    units:        s.units ?? null,
    usf:          s.avg_unit_sf ?? s.usf ?? 800,
    rti:          s.rti ?? false,
    status,
    listingStatus: offMarket ? 'Off-market / not for sale' : 'For sale',
    forSale:      !offMarket,
    isComp:       s.is_comp ?? false,
    price:        s.price ?? model.landCost ?? null,
    demo:         s.has_demo ?? false,
    lat:          s.lat,
    lng:          s.lng,
    permitSourceId: s.permit_source_id,
    permitNumber: rawPermit.permit_number || null,
    permitStatus: rawPermit.permit_status || rawPermit.status || null,
    developmentStatus: rawPermit.development_status || null,
    workDescription: rawPermit.work_description || rawPermit.project_description || null,
    addressAliases,
    ...ownerInfo,
    unitMixSource: unitMix.source,
    unitMixCounts: unitMix.counts,
    unitMixParsedTotal: unitMix.parsedTotal,
    underwrittenAt: s.underwritten_at,
    _precomputed: true,
    _m: model,
    ms: unitMix.mix.studio,
    mo: unitMix.mix.one,
    mt: unitMix.mix.two,
    mth: unitMix.mix.three,
  };
}

async function fetchAllUnderwrittenSites() {
  const now = Date.now();
  if (_siteCache && now - _cacheTime < CACHE_TTL) return { data: _siteCache, error: null };

  const all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('sites')
      .select('*')
      .in('status', ['active', 'off-market'])
      .not('net_profit', 'is', null)
      .order('irr_v', { ascending: false })
      .range(offset, offset + SITE_LOAD_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const page = data || [];
    all.push(...page);
    if (page.length < SITE_LOAD_PAGE_SIZE) break;
    offset += SITE_LOAD_PAGE_SIZE;
  }

  _siteCache = all;
  _cacheTime = now;
  _modelCache.clear();
  return { data: all, error: null };
}

// ── GET /api/sites ─────────────────────────────────────────────────────────────
function modelCacheKey(overrides, siteCount) {
  return `${_cacheTime}:${siteCount}:${JSON.stringify(overrides || {})}`;
}

function getModelledSites(sites, overrides) {
  const key = modelCacheKey(overrides, sites.length);
  if (_modelCache.has(key)) return _modelCache.get(key);

  const modelled = sites.map(s => {
    const baseModel = s._m || {};
    const model = runModel(normalizeSite(s), overrides);
    return {
      ...s,
      _m: {
        ...baseModel,
        ...model,
        landCost: baseModel.landCost ?? model.price ?? s.price ?? null,
      },
    };
  });

  _modelCache.set(key, modelled);
  if (_modelCache.size > MODEL_CACHE_LIMIT) {
    const oldest = _modelCache.keys().next().value;
    _modelCache.delete(oldest);
  }
  return modelled;
}

function redactSiteResult(site, hasAccess) {
  if (hasAccess) return { ...site, locked: false, accessRequired: false };

  const protectedLabel = `Protected site #${site.id}`;
  return {
    ...site,
    locked: true,
    accessRequired: true,
    addr: protectedLabel,
    displayAddress: protectedLabel,
    hood: 'Members only',
    neighborhood: 'Members only',
    zone: null,
    lot: null,
    permitStatus: null,
    permitNumber: null,
    workDescription: null,
    addressAliases: [],
    ownerName: null,
    ownerApplicantName: null,
    ownerMailingAddress: null,
    ownerSitusAddress: null,
    ownerApn: null,
    ownerLastSaleDate: null,
    ownerLastSaleAmount: null,
    ownerSource: null,
    lat: null,
    lng: null,
    landValueMatch: null,
    landValueComps: [],
  };
}

function listParam(value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function hasModelOverrideParams(query) {
  return ['exitCap', 'hcpsf', 'rate', 'sc', 'ppu', 'psf', 'method'].some(key => query[key] !== undefined);
}

const PICO_6075_6099_ALIASES = [
  '6075 W PICO BLVD', '6077 W PICO BLVD', '6079 W PICO BLVD', '6081 W PICO BLVD',
  '6083 W PICO BLVD', '6085 W PICO BLVD', '6087 W PICO BLVD', '6089 W PICO BLVD',
  '6091 W PICO BLVD', '6093 W PICO BLVD', '6095 W PICO BLVD', '6097 W PICO BLVD',
  '6099 W PICO BLVD',
];

function cleanSearchTerm(value) {
  return String(value || '').replace(/[,%()'"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function searchTokens(value) {
  return cleanSearchTerm(value)
    .toUpperCase()
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

function orderedTokenMatch(haystack, value) {
  const tokens = searchTokens(value);
  if (tokens.length < 2) return false;
  let cursor = 0;
  for (const token of tokens) {
    const idx = haystack.indexOf(token, cursor);
    if (idx < 0) return false;
    cursor = idx + token.length;
  }
  return true;
}

function addressWildcardVariant(value) {
  const term = cleanSearchTerm(value);
  const match = term.match(/^(\d{3,})\s+(.+)$/);
  if (!match) return null;
  const streetTokens = match[2]
    .split(/\s+/)
    .filter(token => !/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)$/i.test(token));
  if (!streetTokens.length) return null;
  return [match[1], ...streetTokens].join('%');
}

function searchVariants(value) {
  const term = cleanSearchTerm(value);
  if (!term) return [];
  const variants = [term];
  const upper = term.toUpperCase();
  const looksLikePicoAlias = PICO_6075_6099_ALIASES.some(addr => {
    const number = addr.split(' ')[0];
    return upper.includes(addr) || upper === number || (upper.includes(number) && upper.includes('PICO'));
  });
  if (looksLikePicoAlias) variants.push('6091 W PICO');
  return [...new Set(variants)];
}

function searchDbVariants(value) {
  const term = cleanSearchTerm(value);
  if (!term) return [];
  const parts = String(value || '')
    .split(/[,\n;]+/)
    .map(cleanSearchTerm)
    .filter(Boolean);
  const hasNumericPart = parts.some(part => /^\d{3,}\b/.test(part));
  const variants = [];

  for (const part of parts) {
    const isNumber = /^\d{3,}\b/.test(part);
    const isSpecificText = part.length >= 6;
    if (isNumber || isSpecificText || (!hasNumericPart && parts.length === 1)) variants.push(part);
    const wildcard = addressWildcardVariant(part);
    if (wildcard) variants.push(wildcard);
  }

  if (hasNumericPart && parts.some(part => /pico/i.test(part))) variants.push('6091 W PICO');
  if (!variants.length) variants.push(...searchVariants(term));

  return [...new Set(variants.filter(v => v.length >= 3 || /^\d{3,}$/.test(v)))];
}

function siteSearchHaystack(s) {
  const aliases = Array.isArray(s.addressAliases) ? s.addressAliases : [];
  const knownAliases = String(s.addr || '').toUpperCase() === '6091 W PICO BLVD' && Number(s.units || 0) === 138
    ? PICO_6075_6099_ALIASES
    : [];
  return [
    s.addr,
    s.hood,
    s.type,
    s.zone,
    s.permitNumber,
    s.permitStatus,
    s.developmentStatus,
    s.workDescription,
    ...aliases,
    ...knownAliases,
  ].map(v => String(v || '').toUpperCase()).join(' ');
}

function siteMatchesSearch(s, value) {
  const term = cleanSearchTerm(value).toUpperCase();
  if (!term) return true;
  const haystack = siteSearchHaystack(s);
  return haystack.includes(term) ||
    orderedTokenMatch(haystack, value) ||
    searchVariants(value).some(v => haystack.includes(v.toUpperCase()));
}

function numericFilterPass(value, min, max) {
  const n = Number(value || 0);
  if (min && n && n < Number(min)) return false;
  if (max && n && n > Number(max)) return false;
  return true;
}

function normalizeZone(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^\[[^\]]+\]/, '')
    .replace(/^\([^\)]+\)/, '');
}

function zoneBase(value) {
  const z = normalizeZone(value);
  const match = z.match(/^(RAS[0-9]|RD[0-9.]+|R[0-9]|C[0-9]|CM|M[0-9]|PF|OS|A[0-9])/);
  return match ? match[1] : z.split(/[-,]/)[0];
}

function zoneMatches(siteZone, selectedZone) {
  const selected = normalizeZone(selectedZone);
  if (!selected) return true;
  const actual = normalizeZone(siteZone);
  if (!actual) return false;
  return actual === selected || actual.startsWith(selected) || zoneBase(actual) === zoneBase(selected);
}

function isOffMarketSiteRow(s) {
  const status = String(s?.status || s?.listingStatus || '').toLowerCase();
  return !!(s?.isComp || s?.offMarket || status.includes('off') || status.includes('not for sale'));
}

function listingCategory(s) {
  if (isOffMarketSiteRow(s)) return 'off_market';
  if (s?.rti) return 'rti';
  return 'for_sale';
}

function developmentStatusKey(s) {
  const explicit = String(s?.developmentStatus || '').trim();
  const explicitKey = explicit.toLowerCase().replace(/[\s/-]+/g, '_');
  const explicitAliases = {
    submitted: 'submitted',
    plan_check: 'plan_check',
    city_approved_not_started: 'city_approved_not_started',
    approved_not_started: 'city_approved_not_started',
    rti: 'city_approved_not_started',
    permit_issued: 'permit_issued',
    issued: 'permit_issued',
    started_unknown: 'possibly_started_unknown',
    possibly_started_unknown: 'possibly_started_unknown',
  };
  if (explicitAliases[explicitKey]) return explicitAliases[explicitKey];
  const raw = [
    s?.permitStatus,
    s?.permit_status,
    s?.workDescription,
    s?.permitNumber,
  ].map(v => String(v || '').toLowerCase()).join(' ');
  if (raw.includes('not ready')) return 'plan_check';
  if (raw.includes('issued')) return 'permit_issued';
  if (s?.rti || raw.includes('ready') || raw.includes('approved')) return 'city_approved_not_started';
  if (raw.includes('plan') || raw.includes('pc ') || raw.includes('pc_') || raw.includes('pcis') || raw.includes('under review') || raw.includes('check') || raw.includes('correction') || raw.includes('verification') || raw.includes('quality review') || raw.includes('reviewed by supervisor') || raw.includes('review') || raw.includes('hold') || raw.includes('resubmittal')) return 'plan_check';
  if (raw.includes('submit') || raw.includes('submittal') || raw.includes('filed') || raw.includes('application') || raw.includes('intake') || raw.includes('pre-screen') || raw.includes('created')) return 'submitted';
  return 'possibly_started_unknown';
}

function sitePassesQueryFilters(s, queryParams) {
  const m = s._m || {};
  if (!siteMatchesSearch(s, queryParams.q || queryParams.search)) return false;

  const typeList = listParam(queryParams.types || queryParams.type);
  if (typeList.length && !typeList.includes(s.type)) return false;
  if (queryParams.hood && s.hood !== queryParams.hood) return false;
  if (queryParams.zone && !zoneMatches(s.zone, queryParams.zone)) return false;

  const listings = listParam(queryParams.listing);
  if (listings.length && !listings.includes(listingCategory(s))) return false;

  const devStatuses = listParam(queryParams.devStatus);
  const devKey = developmentStatusKey(s);
  if (devStatuses.length && !(devStatuses.includes(devKey) || (devStatuses.includes('city_approved_not_started') && s.rti))) return false;

  if (queryParams.rti !== undefined && s.rti !== (queryParams.rti === 'true')) return false;
  if (queryParams.isComp !== undefined && s.isComp !== (queryParams.isComp === 'true')) return false;
  if (queryParams.minUnits && Number(s.units || 0) < Number(queryParams.minUnits)) return false;
  if (queryParams.maxUnits && Number(s.units || 0) > Number(queryParams.maxUnits)) return false;
  if (queryParams.minLot && Number(s.lot || 0) < Number(queryParams.minLot)) return false;
  if (queryParams.maxLot && Number(s.lot || 0) > Number(queryParams.maxLot)) return false;

  const landBasis = Number(s.price ?? m.landCost ?? 0);
  if (!numericFilterPass(landBasis, queryParams.minPrice, queryParams.maxPrice)) return false;
  if (queryParams.minCost && Number(m.totalCost || 0) < Number(queryParams.minCost)) return false;
  if (queryParams.maxCost && Number(m.totalCost || Infinity) > Number(queryParams.maxCost)) return false;
  if (queryParams.minIRR && Number(m.leveragedIRR || 0) < Number(queryParams.minIRR)) return false;
  if (queryParams.minProfit && Number(m.netProfit || 0) < Number(queryParams.minProfit)) return false;
  const spreadPct = Math.abs(Number(m.devSpreadPct || 0)) <= 1 ? Number(m.devSpreadPct || 0) * 100 : Number(m.devSpreadPct || 0);
  const capOnCostPct = Math.abs(Number(m.capRateOnCost || 0)) <= 1 ? Number(m.capRateOnCost || 0) * 100 : Number(m.capRateOnCost || 0);
  if (queryParams.minSpread && spreadPct < Number(queryParams.minSpread)) return false;
  if (queryParams.minCapoc && capOnCostPct < Number(queryParams.minCapoc)) return false;
  return true;
}

async function fetchSupabaseSitePage(queryParams, requestedLimit, requestedOffset) {
  if (
    !process.env.SUPABASE_URL
  ) return null;

  const search = cleanSearchTerm(queryParams.q || queryParams.search);
  const needsPostFilter = Boolean(
    search ||
    queryParams.hood ||
    queryParams.listing ||
    queryParams.devStatus ||
    queryParams.minPrice ||
    queryParams.maxPrice
  );
  const usesSelectiveFilters = !!(
    search ||
    queryParams.hood ||
    queryParams.listing ||
    queryParams.devStatus ||
    queryParams.zone ||
    queryParams.minUnits ||
    queryParams.maxUnits ||
    queryParams.minPrice ||
    queryParams.maxPrice ||
    queryParams.minCost ||
    queryParams.maxCost ||
    queryParams.minProfit ||
    queryParams.minIRR ||
    queryParams.minSpread ||
    queryParams.minCapoc ||
    hasModelOverrideParams(queryParams)
  );

  const selectColumns = search && !queryParams.devStatus ? SITE_SEARCH_SELECT : SITE_LIST_SELECT;
  let query = supabase
    .from('sites')
    .select(selectColumns, usesSelectiveFilters ? undefined : { count: 'estimated' })
    .in('status', ['active', 'off-market'])
    .not('net_profit', 'is', null);

  const types = listParam(queryParams.types || queryParams.type);
  if (types.length) query = query.in('project_type', types);
  if (queryParams.zone) query = query.eq('zoning', queryParams.zone);
  if (queryParams.minUnits) query = query.gte('units', Number(queryParams.minUnits));
  if (queryParams.maxUnits) query = query.lte('units', Number(queryParams.maxUnits));
  if (queryParams.minCost) query = query.gte('total_cost', Number(queryParams.minCost));
  if (queryParams.maxCost) query = query.lte('total_cost', Number(queryParams.maxCost));
  if (queryParams.minProfit) query = query.gte('net_profit', Number(queryParams.minProfit));
  if (queryParams.minIRR) query = query.gte('irr_v', Number(queryParams.minIRR));
  if (queryParams.minSpread) query = query.gte('dev_spread_pct', Number(queryParams.minSpread));
  if (queryParams.minCapoc) query = query.gte('cap_on_cost', Number(queryParams.minCapoc));

  if (search) {
    const clauses = [];
    for (const variant of searchDbVariants(queryParams.q || queryParams.search)) {
      clauses.push(`address.ilike.%${variant}%`);
      clauses.push(`permit_source_id.ilike.%${variant}%`);
    }
    if (clauses.length) query = query.or(clauses.join(','));
  }

  const listings = listParam(queryParams.listing);
  if (listings.length) {
    const clauses = [];
    if (listings.includes('for_sale')) clauses.push('status.eq.active');
    if (listings.includes('rti')) clauses.push('rti.eq.true');
    if (listings.includes('off_market')) clauses.push('status.eq.off-market');
    if (clauses.length) query = query.or(clauses.join(','));
  }

  const sort = queryParams.sort || 'profit';
  const sortColumns = {
    profit: 'net_profit',
    irr: 'irr_v',
    spread: 'dev_spread_pct',
    capoc: 'cap_on_cost',
    'price-a': 'price',
    'price-d': 'price',
    units: 'units',
  };
  const sortColumn = sortColumns[sort] || 'net_profit';
  if (!search) query = query.order(sortColumn, { ascending: sort === 'price-a', nullsFirst: false });
  const dbOffset = needsPostFilter ? 0 : requestedOffset;
  const dbLimit = needsPostFilter
    ? Math.min(5000, Math.max(requestedOffset + requestedLimit * 20, requestedLimit))
    : requestedLimit;
  query = query.range(dbOffset, dbOffset + dbLimit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data || [];
  let mapped = rows.map((row, i) => mapSupabaseSite(row, i + dbOffset, null));
  if (needsPostFilter) {
    const matches = mapped.filter(site => sitePassesQueryFilters(site, queryParams));
    const page = matches.slice(requestedOffset, requestedOffset + requestedLimit);
    const hasMoreRawRows = rows.length === dbLimit;
    const total = hasMoreRawRows
      ? Math.max(matches.length, requestedOffset + page.length + requestedLimit)
      : matches.length;
    return { sites: page, total };
  }
  const rollingTotal = requestedOffset + rows.length + (rows.length === requestedLimit ? requestedLimit : 0);
  return { sites: mapped, total: count ?? rollingTotal };
}
router.get('/', validateSiteFilters, optionalAuth, async (req, res, next) => {
  try {
    const {
      type, hood, zone, rti, isComp,
      minUnits, maxUnits, minLot, maxLot,
      minPrice, maxPrice,
      minCost, maxCost,
      minIRR, minProfit, minSpread, minCapoc,
      sort = 'profit',
      limit = 50, offset = 0,
    } = req.query;

    const overrides = buildOverrides(req.query);
    const requestedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);
    const requestedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    // Primary source: real LADBS permits from Supabase (36,000+ records)
    // Fallback: 27 mock sites if permits table is empty
    let sites = [];
    let fastTotal = null;
    let usedFastPage = false;

    if (process.env.SUPABASE_URL) {
      try {
        const fastPage = await fetchSupabaseSitePage(req.query, requestedLimit, requestedOffset);
        if (fastPage) {
          sites = fastPage.sites;
          fastTotal = fastPage.total;
          usedFastPage = true;
          console.log(`[sites] Loaded fast page ${sites.length}/${fastTotal} from Supabase`);
        }
      } catch (e) {
        console.log('[sites] Fast Supabase page failed - falling back:', e.message);
      }
    }

    if (!usedFastPage && process.env.SUPABASE_URL) {
      try {
        // Load pre-underwritten sites from Supabase (populated by GitHub Action)
        const { data: sbSites, error: sbErr } = await fetchAllUnderwrittenSites();

        if (!sbErr && sbSites?.length > 0) {
          sites = sbSites.map((row, i) => mapSupabaseSite(row, i, null));
          console.log(`[sites] Loaded ${sites.length} pre-underwritten sites from Supabase`);
        } else {
          console.log('[sites] No pre-underwritten sites found - using mock sites');
          sites = [...SITES];
        }
      } catch (e) {
        console.log('[sites] Supabase failed - using mock sites:', e.message);
        sites = [...SITES];
      }
    }

    // Re-run the current model for dashboard rows so valuation, income statement,
    // and user hard-cost overrides are consistent with the latest app logic.
    // Cache the result because the frontend loads multiple pages in sequence.
    const modelled = usedFastPage ? sites : getModelledSites(sites, overrides);

    // Filter
    let filtered = usedFastPage ? modelled : modelled.filter(s => {
      const m = s._m;
      if (!siteMatchesSearch(s, req.query.q || req.query.search)) return false;
      const typeList = listParam(req.query.types || type);
      if (typeList.length && !typeList.includes(s.type)) return false;
      if (hood    && s.hood  !== hood)               return false;
      if (zone    && !zoneMatches(s.zone, zone))     return false;
      const listings = listParam(req.query.listing);
      if (listings.length && !listings.includes(listingCategory(s))) return false;
      const devStatuses = listParam(req.query.devStatus);
      const devKey = developmentStatusKey(s);
      if (devStatuses.length && !(devStatuses.includes(devKey) || (devStatuses.includes('city_approved_not_started') && s.rti))) return false;
      if (rti     !== undefined && s.rti !== (rti === 'true'))  return false;
      if (isComp  !== undefined && s.isComp !== (isComp === 'true')) return false;
      if (minUnits && s.units < +minUnits)            return false;
      if (maxUnits && s.units > +maxUnits)            return false;
      if (minLot  && s.lot   < +minLot)              return false;
      if (maxLot  && s.lot   > +maxLot)              return false;
      const landBasis = Number(s.price ?? m.landCost ?? 0);
      if (minPrice && landBasis && landBasis < +minPrice) return false;
      if (maxPrice && landBasis && landBasis > +maxPrice) return false;
      if (minCost && (m.totalCost ?? 0) < +minCost) return false;
      if (maxCost && (m.totalCost ?? Infinity) > +maxCost) return false;
      if (minIRR   && m.leveragedIRR    < +minIRR)           return false;
      if (minProfit && m.netProfit < +minProfit)         return false;
      if (minSpread && m.devSpreadPct < +minSpread)   return false;
      if (minCapoc  && m.capRateOnCost < +minCapoc)       return false;
      return true;
    });

    // Sort
    const SORTS = {
      profit:   (a,b) => b._m.netProfit   - a._m.netProfit,
      irr:      (a,b) => b._m.leveragedIRR        - a._m.leveragedIRR,
      spread:   (a,b) => b._m.devSpreadPct - a._m.devSpreadPct,
      capoc:    (a,b) => b._m.capRateOnCost   - a._m.capRateOnCost,
      'price-a':(a,b) => (a.price??a._m.landCost) - (b.price??b._m.landCost),
      'price-d':(a,b) => (b.price??b._m.landCost) - (a.price??a._m.landCost),
      units:    (a,b) => b.units - a.units,
    };
    if (!usedFastPage && SORTS[sort]) filtered.sort(SORTS[sort]);

    const total = usedFastPage ? fastTotal : filtered.length;
    const paginated = usedFastPage ? filtered : filtered.slice(requestedOffset, requestedOffset + requestedLimit);

    const access = await getUserAccessFast(req.user);

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json({
      total,
      limit:   +limit,
      offset:  +offset,
      access,
      results: paginated.map(s => redactSiteResult({
        id:           s.id,
        addr:         s.addr ?? s.address,
        hood:         s.hood ?? s.neighborhood,
        type:         s.type ?? s.project_type,
        zone:         s.zone ?? s.zoning,
        lot:          s.lot  ?? s.lot_sf,
        units:        s.units,
        usf:          s.usf  ?? s.avg_unit_sf,
        rti:          s.rti,
        permitStatus: s.permitStatus,
        developmentStatus: s.developmentStatus,
        permitNumber:  s.permitNumber,
        workDescription: s.workDescription,
        addressAliases: s.addressAliases || [],
        ownerName:    s.ownerName,
        ownerApplicantName: s.ownerApplicantName,
        ownerMailingAddress: s.ownerMailingAddress,
        ownerSitusAddress: s.ownerSitusAddress,
        ownerApn:     s.ownerApn,
        ownerLastSaleDate: s.ownerLastSaleDate,
        ownerLastSaleAmount: s.ownerLastSaleAmount,
        ownerSource:  s.ownerSource,
        ms:           s.ms,
        mo:           s.mo,
        mt:           s.mt,
        mth:          s.mth,
        unitMixSource: s.unitMixSource,
        unitMixCounts: s.unitMixCounts,
        unitMixParsedTotal: s.unitMixParsedTotal,
        status:       s.status,
        listingStatus: s.listingStatus,
        isComp:       s.isComp ?? s.is_comp ?? false,
        lat:          s.lat,
        lng:          s.lng,
        askPrice:     s.price ?? s.askPrice ?? s._m.price ?? null,
        // Pre-underwritten metrics
        totalCost:    s._m.totalCost,
        hardCosts:    s._m.hardCosts,
        softCosts:    s._m.softCosts,
        carryCost:    s._m.carryCost,
        loanAmount:   s._m.loanAmount,
        equity:       s._m.equity,
        grossPotentialRent: s._m.grossPotentialRent,
        vacancyLoss:        s._m.vacancyLoss,
        otherIncome:        s._m.otherIncome,
        effectiveGrossIncome: s._m.effectiveGrossIncome,
        operatingExpenses:  s._m.operatingExpenses,
        expenseDetail:      s._m.expenseDetail,
        noi:          s._m.noi,
        year5Noi:     s._m.year5Noi,
        exitValue:    s._m.exitValue,
        netProfit:    s._m.netProfit,
        irrV:         s._m.leveragedIRR,
        capOnCost:    Math.round(s._m.capRateOnCost * 10000) / 100,
        devSpreadPct: s._m.devSpreadPct,
        landCost:     s._m.landCost ?? s._m.price ?? s.price ?? s.askPrice ?? null,
        landValueSource: s._m.landValueSource,
        landValueMetric: s._m.landValueMetric,
        landValueMetricValue: s._m.landValueMetricValue,
        landValueBasisQuantity: s._m.landValueBasisQuantity,
        landValueCompCount: s._m.landValueCompCount,
        landValueMatch: s._m.landValueMatch,
        landValueRecencyDays: s._m.landValueRecencyDays,
        landValueComps: s._m.landValueComps,
        entryCap:     s._m.marketCapRate,
        exitCap:      s._m.exitCapRate ?? (s._m.marketCapRate + 0.0025),
        debtService:  s._m.debtService,
        cfbt:         s._m.cfbt,
        coc:          s._m.cocReturn,
        eqMult:       s._m.equityMultiple,
      }, access.active)),
    });
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id ─────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = +req.params.id;
    const overrides = buildOverrides(req.query);
    let site = SITES.find(s => s.id === id);
    let model = null;
    let scenarios = null;

    if (site) {
      const normalized = normalizeSite(site);
      model = runModel(normalized, overrides);
      scenarios = runScenarios(normalized, overrides);
    } else if (process.env.SUPABASE_URL) {
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        site = mapSupabaseSite(data);
        model = runModel(normalizeSite(site), overrides);
        scenarios = runScenarios(normalizeSite(site), overrides);
      }
    }

    if (!site) return res.status(404).json({ error: 'Site not found' });

    const access = await getUserAccessFast(req.user);
    if (!access.active) {
      return res.json({
        site: redactSiteResult({
          id: site.id,
          addr: site.addr ?? site.address,
          type: site.type ?? site.project_type,
          units: site.units,
          status: site.status,
          listingStatus: site.listingStatus,
          isComp: site.isComp ?? site.is_comp ?? false,
        }, false),
        model: null,
        scenarios: null,
        isSaved: false,
        userOverrides: {},
        access,
      });
    }

    // If user is logged in, check if they've saved this site
    let isSaved = false;
    let userOverrides = {};
    if (req.user) {
      try {
        const { data: saved } = await supabase
          .from('saved_sites').select('site_id').match({ user_id: req.user.id, site_id: id }).maybeSingle();
        isSaved = !!saved;
        const { data: ov } = await supabase
          .from('model_overrides').select('overrides').match({ user_id: req.user.id, site_id: id }).maybeSingle();
        if (ov) userOverrides = ov.overrides;
      } catch (e) {
        console.warn('[sites] Supabase query failed:', e.message);
      }
    }

    res.json({ site, model, scenarios, isSaved, userOverrides, access });
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id/enrich ──────────────────────────────────────────────────
router.get('/:id/enrich', async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const enriched = await enrichSite(site);
    res.json(enriched);
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id/demand ──────────────────────────────────────────────────
router.get('/:id/demand', async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Use submarket fallback if no coordinates yet
    const siteWithCoords = {
      ...site,
      demographics: SUBMARKET_CENSUS_ESTIMATES[site.hood],
    };

    const demand = await scoreSiteDemand(siteWithCoords);
    res.json(demand);
  } catch (err) { next(err); }
});

// ── POST /api/sites/:id/save ───────────────────────────────────────────────────
router.post('/:id/save', requireAuth, async (req, res, next) => {
  try {
    const siteId = +req.params.id;
    const { notes = '' } = req.body;

    const { error } = await supabase
      .from('saved_sites')
      .upsert({ user_id: req.user.id, site_id: siteId, notes });

    if (error) throw error;
    res.json({ saved: true, siteId });
  } catch (err) { next(err); }
});

// ── DELETE /api/sites/:id/save ────────────────────────────────────────────────
router.delete('/:id/save', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('saved_sites')
      .delete()
      .match({ user_id: req.user.id, site_id: +req.params.id });

    if (error) throw error;
    res.json({ saved: false, siteId: +req.params.id });
  } catch (err) { next(err); }
});

export default router;
