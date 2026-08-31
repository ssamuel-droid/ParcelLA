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
import { createClient } from '@supabase/supabase-js';
import { SITES, normalizeSite } from '../../src/data/sites.js';
import { runModel, runScenarios } from '../../src/model/financialModel.js';
import { RENTS } from '../../src/data/submarkets.js';
import affordableRents from '../../src/data/affordableRents.cjs';
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

const { resolveEd1Affordability, rentsForSite: underwritingRentsForSite } = affordableRents;

const router = Router();
const planningDb = process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : supabase;

// Cache computed model results (refreshed every 5 min)
let _siteCache = null;
let _cacheTime = 0;
const _modelCache = new Map();
const _landCompCache = new Map();
const _housePageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const HOUSE_PAGE_CACHE_TTL = 5 * 60 * 1000;
const SITE_PAGE_QUERY_TIMEOUT_MS = 8 * 1000;
const SITE_PAGE_RETRY_DELAY_MS = 150;
const SITE_LOAD_PAGE_SIZE = 1000;
const MODEL_CACHE_LIMIT = 12;
const DEFAULT_MARKET_LAND_PER_DOOR = 100000;
const DEFAULT_HOUSE_LAND_PER_LOT_SF = 100;
const HOUSE_RESALE_PSF = {
  'Pacific Palisades': 1150, 'Brentwood': 1050, 'Venice': 1000, 'West LA': 900,
  'Culver City': 875, 'Mar Vista': 825, 'Silver Lake': 825, 'Los Feliz': 850,
  'Hollywood Hills': 950, 'Studio City': 775, 'Sherman Oaks': 725, 'Encino': 675,
  'Highland Park': 700, 'Eagle Rock': 725, 'Koreatown': 650, 'Mid-Wilshire': 725,
  'West Adams': 625, 'North Hollywood': 575, 'Woodland Hills': 600, 'Northridge': 525,
  'Reseda': 500, 'Van Nuys': 500, 'Canoga Park': 500, 'Granada Hills': 550,
  'Chatsworth': 550, 'Boyle Heights': 525, 'El Sereno': 550, 'Lincoln Heights': 575,
};
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
  'noi',
  'exit_value',
  'net_profit',
  'irr_v',
  'cap_on_cost',
  'dev_spread_pct',
  'owner_name',
  'owner_last_sale_date',
  'owner_last_sale_amount',
  'owner_source',
  'owner_enriched_at',
  'underwritten_at',
  'external_enriched_at',
  'external_data_sources',
  'external_property_record',
  'external_rent_estimate',
  'external_value_estimate',
  'external_rent_comps',
  'external_sale_comps',
  'data_quality',
  'rentcast_enriched_at',
  'regrid_enriched_at',
  'raw_permit_data',
].join(',');
const SITE_PREVIEW_SELECT = [
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
  'lat',
  'lng',
  'permit_source_id',
  'total_cost',
  'noi',
  'exit_value',
  'net_profit',
  'irr_v',
  'cap_on_cost',
  'dev_spread_pct',
].join(',');
const SITE_SEARCH_SELECT = [
  SITE_PREVIEW_SELECT,
  'owner_name',
  'owner_last_sale_date',
  'owner_last_sale_amount',
  'owner_source',
  'raw_permit_data',
].join(',');
const PERMIT_HOUSE_SELECT = [
  'id',
  'permit_number',
  'address',
  'zone',
  'units',
  'valuation',
  'is_rti',
  'status',
  'permit_type',
  'permit_subtype',
  'work_description',
  'raw_data',
  'lat',
  'lng',
  'issued_date',
  'synced_at',
].join(',');

const PERMIT_HOUSE_INDEXED_SELECT = [
  'id',
  'permit_number',
  'address',
  'zone',
  'units',
  'valuation',
  'is_rti',
  'status',
  'permit_type',
  'permit_subtype',
  'work_description',
  'lat',
  'lng',
  'issued_date',
  'synced_at',
  'building_sf',
  'building_sf_source',
  'building_sf_parsed',
  'lot_sf',
  'lot_sf_source',
  'stories',
  'contractor_name',
  'contractor_address',
  'contractor_city',
  'contractor_state',
  'applicant_name',
  'applicant_business_name',
  'project_detail_complete',
].join(',');

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
  const source = String(s.lot_sf_source || s.raw_permit_data?.lot_sf_source || '').trim();
  const hasRealSource = source && !/default|model|assum/i.test(source);
  const likelyDefault = lot === 5000 && !hasRealSource && (
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

function houseLotLandBasis(type, lotSf) {
  const lot = Number(lotSf || 0);
  if (type !== 'New House' || !Number.isFinite(lot) || lot < 1000) return null;
  return {
    value: Math.round(DEFAULT_HOUSE_LAND_PER_LOT_SF * lot),
    source: 'default_house_land_per_lot_sf',
    metricLabel: 'price per lot SF',
    metricValue: DEFAULT_HOUSE_LAND_PER_LOT_SF,
    basisQuantity: Math.round(lot),
    compCount: 0,
    matchLabel: 'user-adjustable house default',
    recencyDays: 0,
    comps: [],
  };
}

function hasPermitValuationDerivedHouseSize(site = {}, rawPermit = site.raw_permit_data || {}, model = {}) {
  const type = String(site.project_type ?? site.type ?? '').trim().toLowerCase();
  if (type !== 'new house') return false;
  const valuation = numberFromValue(rawPermit.permit_valuation ?? site.permitValuation ?? site.valuation) || 0;
  const buildingSf = numberFromValue(
    rawPermit.building_sf ??
    site.buildingSf ??
    site.building_sf ??
    model.buildingSf
  ) || 0;
  const buildingSfSource = String(
    rawPermit.building_sf_source ||
    site.buildingSfSource ||
    model.buildingSfSource ||
    ''
  ).toLowerCase();
  return valuation > 0
    && buildingSf >= 900
    && buildingSf <= 25000
    && buildingSfSource.includes('permit valuation-derived');
}

function isNewHousePermitPlaceholder(site = {}, rawPermit = {}) {
  const type = String(site.project_type ?? site.type ?? '').trim().toLowerCase();
  if (type !== 'new house') return false;
  const source = String(rawPermit.land_value_source || site.landValueSource || '').toLowerCase();
  const metric = String(rawPermit.land_value_metric || site.landValueMetric || '').toLowerCase();
  const price = numberFromValue(site.price ?? site.askPrice ?? site.landCost) || 0;
  const hasValuationEstimate = hasPermitValuationDerivedHouseSize(site, rawPermit);
  return (
    (source.includes('recent_sales_comps') && !metric.includes('lot')) ||
    source.includes('permit_valuation_fallback') ||
    (source.includes('permit_valuation_estimate') && hasValuationEstimate) ||
    source.includes('land_comp_needed') ||
    source.includes('hard cost percentage fallback') ||
    source.includes('asking_price') ||
    (price > 0 && price <= 150000)
  );
}

function needsLandCompForHouse(site = {}, rawPermit = {}, compLand = null, doorLand = null) {
  const type = String(site.project_type ?? site.type ?? '').trim().toLowerCase();
  if (type !== 'new house') return false;
  if (doorLand?.value || compLand?.value) return false;
  const price = numberFromValue(site.price ?? site.askPrice ?? site.landCost) || 0;
  return isNewHousePermitPlaceholder(site, rawPermit) || (isOffMarketSiteRow(site) && price <= 150000);
}

function isNewHouseSite(site = {}) {
  return String(site.project_type ?? site.type ?? '').trim().toLowerCase() === 'new house';
}

function isPrimaryNewHouseWorkDescription(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return false;
  if (/\b(?:adu|accessory dwelling|second dwelling|second unit|addition|alteration|remodel|greenhouse|swimming pool|detached garage|garage only)\b/i.test(text)) {
    return false;
  }
  return /\b(?:single[- ]family(?: dwelling)?|sfd|one[- ]family(?: dwelling)?|dwelling)\b/i.test(text);
}

function realPermitWorkDescription(site = {}, rawPermit = {}) {
  const text = firstText(
    rawPermit.work_description,
    rawPermit.work_desc,
    rawPermit.workdescription,
    rawPermit.project_description,
    rawPermit.description,
    site.workDescription,
    site.description
  );
  if (!text) return null;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length < 12) return null;
  if (/^(?:new house|single family|sfd|residential)$/i.test(clean)) return null;
  return clean;
}

function storyCountFromPermit(site = {}, rawPermit = {}) {
  const direct = numberFromValue(
    rawPermit.stories ??
    rawPermit.of_stories ??
    rawPermit.number_of_stories ??
    rawPermit.story_count ??
    site.stories
  );
  if (direct > 0) return direct;
  const workDescription = realPermitWorkDescription(site, rawPermit) || '';
  const numeric = workDescription.match(/\b(\d+(?:\.\d+)?)\s*[- ]?\s*stor(?:y|ies)\b/i);
  if (numeric) return numberFromValue(numeric[1]);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const word = workDescription.match(/\b(one|two|three|four|five)\s*[- ]?\s*stor(?:y|ies)\b/i);
  return word ? words[word[1].toLowerCase()] : 0;
}

function contractorOrApplicantFromPermit(site = {}, rawPermit = {}) {
  const contractor = firstText(
    rawPermit.contractor_name,
    rawPermit.contractors_business_name,
    rawPermit.contractor_business_name,
    rawPermit.contractor,
    site.contractorName
  );
  const applicant = firstText(
    rawPermit.applicant_name,
    rawPermit.applicantName,
    rawPermit.applicant,
    rawPermit.applicant_business_name,
    [rawPermit.applicant_first_name, rawPermit.applicant_last_name].filter(Boolean).join(' '),
    site.applicantName
  );
  return { contractor, applicant };
}

function newHousePermitDetail(site = {}, model = site._m || {}) {
  if (!isNewHouseSite(site)) return { isUsable: true, missing: [] };
  const rawPermit = site.raw_permit_data || {};
  const buildingSf = numberFromValue(
    rawPermit.building_sf ??
    rawPermit.floor_area_l_a_building_code_definition ??
    rawPermit.floor_area_l_a_zoning_code_definition ??
    rawPermit.floor_area ??
    rawPermit.floorarea ??
    rawPermit.building_area ??
    rawPermit.total_floor_area ??
    rawPermit.new_floor_area ??
    rawPermit.proposed_floor_area ??
    rawPermit.project_floor_area ??
    rawPermit.square_footage ??
    rawPermit.sqft ??
    rawPermit.gross_floor_area ??
    rawPermit.gross_building_area ??
    rawPermit.residential_floor_area ??
    site.buildingSf ??
    site.building_sf ??
    model.buildingSf
  ) || 0;
  const buildingSfSource = String(
    rawPermit.building_sf_source ||
    site.buildingSfSource ||
    model.buildingSfSource ||
    ''
  ).toLowerCase();
  const buildingSfParsed = rawPermit.building_sf_parsed ?? site.buildingSfParsed ?? model.buildingSfParsed;
  const hasRealBuildingSize = buildingSf > 0
    && buildingSf !== 800
    && (
      buildingSfParsed === true ||
      buildingSfSource.includes('permit work description') ||
      buildingSfSource.includes('permit source field') ||
      !!(rawPermit.floor_area_l_a_building_code_definition || rawPermit.floor_area_l_a_zoning_code_definition)
    );
  const workDescription = realPermitWorkDescription(site, rawPermit);
  const permitValuation = numberFromValue(
    rawPermit.permit_valuation ??
    rawPermit.valuation ??
    site.permitValuation ??
    site.valuation ??
    model.permitValuation
  ) || 0;
  const units = numberFromValue(
    rawPermit.permit_units ??
    rawPermit.raw_units ??
    rawPermit.of_residential_dwelling_units ??
    rawPermit.number_of_units ??
    site.units
  ) || 0;
  const hasRealUnitCount = units > 0 || /\b(?:single[- ]family|sfd|one[- ]family|1\s*(?:dwelling|unit))\b/i.test(workDescription || '');
  const stories = storyCountFromPermit(site, rawPermit);
  const hasRealStories = stories > 0;
  const contacts = contractorOrApplicantFromPermit(site, rawPermit);

  const missing = [];
  if (!hasRealBuildingSize) missing.push('real floor area');
  if (!workDescription) missing.push('work description');
  if (!permitValuation) missing.push('permit valuation');
  if (!hasRealUnitCount) missing.push('unit count');
  if (!hasRealStories) missing.push('stories');

  return {
    isUsable: !missing.length,
    missing,
    buildingSf,
    buildingSfSource,
    buildingSfParsed,
    workDescription,
    permitValuation,
    units,
    stories,
    contractorName: contacts.contractor,
    applicantName: contacts.applicant,
  };
}

function hasUsableNewHousePlanData(site = {}, model = site._m || {}) {
  if (!isNewHouseSite(site)) return true;
  return newHousePermitDetail(site, model).isUsable;
}

function sitePassesDataQualityGate(site = {}, queryParams = {}) {
  if (String(queryParams.includePermitLeads || '').toLowerCase() === 'true') return true;
  return hasUsableNewHousePlanData(site, site._m || {});
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
    ownerName: ownerName || null,
    ownerApplicantName: applicantName,
    ownerMailingAddress: mailingAddress,
    ownerSitusAddress: firstText(stored.situs_address, stored.situsAddress, raw.situs_address, raw.site_address, site.address, site.addr),
    ownerApn: apn,
    ownerLastSaleDate: firstText(stored.last_sale_date, stored.lastSaleDate, raw.last_sale_date, raw.lastSaleDate, raw.sale_date, site.owner_last_sale_date),
    ownerLastSaleAmount: firstText(stored.last_sale_amount, stored.lastSaleAmount, raw.last_sale_amount, raw.lastSaleAmount, raw.sale_price, site.owner_last_sale_amount),
    ownerSource: stored.source || raw.owner_source || site.owner_source || 'Permit/source record',
    ownerEnrichedAt: firstText(stored.enriched_at, stored.owner_enriched_at, raw.owner_enriched_at, site.owner_enriched_at),
  };
}

function houseResalePsf(hood) {
  return HOUSE_RESALE_PSF[hood] || HOUSE_RESALE_PSF.Koreatown || 650;
}

function numberFromValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function textAreaMatches(values, { lotOnly = false } = {}) {
  const text = values.map(value => String(value || '')).filter(Boolean).join(' ');
  if (!text.trim()) return [];
  const matches = [];
  const areaPattern = /(\d[\d,]{2,})\s*(?:sq\.?\s*ft|square\s*feet|s\.?f\.?|sf)\b/gi;
  for (const match of text.matchAll(areaPattern)) {
    const value = numberFromValue(match[1]);
    if (!value || value < 300 || value > 5000000) continue;
    const start = Math.max(0, match.index - 55);
    const end = Math.min(text.length, match.index + match[0].length + 75);
    const context = text.slice(start, end).toLowerCase();
    const lotContext = /\b(lot|site area|parcel|land area|property area)\b/.test(context);
    const buildingContext = /\b(building|floor|dwelling|residential|apartment|house|sfd|mixed[- ]use|habitable|living)\b/.test(context);
    if (lotOnly && !lotContext) continue;
    if (!lotOnly && lotContext && !buildingContext) continue;
    matches.push({ value, context });
  }
  return matches;
}

function externalValueAmount(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'object') {
    for (const key of ['value', 'price', 'estimate', 'estimatedValue', 'valueEstimate', 'valuation']) {
      const n = numberFromValue(value[key]);
      if (n && n > 0) return n;
    }
  }
  return numberFromValue(value);
}

function irr(cfs) {
  let r = 0.15;
  for (let i = 0; i < 60; i++) {
    let n = 0;
    let d = 0;
    for (let t = 0; t < cfs.length; t++) {
      n += cfs[t] / Math.pow(1 + r, t);
      d -= t * cfs[t] / Math.pow(1 + r, t + 1);
    }
    if (!Number.isFinite(n) || !Number.isFinite(d) || Math.abs(d) < 0.000001) break;
    const delta = n / d;
    r -= delta;
    if (!Number.isFinite(r)) return 0;
    if (Math.abs(delta) < 0.00001) break;
  }
  return Math.round(r * 1000) / 10;
}

function houseExitEstimate(site = {}, rawPermit = {}, hood = '') {
  const type = site.project_type ?? site.type;
  if (type !== 'New House') return null;
  const external = externalValueAmount(site.external_value_estimate || site.externalValueEstimate);
  if (external) {
    return {
      value: Math.round(external),
      source: 'external_value_estimate',
      metric: 'third-party value estimate',
      metricValue: Math.round(external),
      basisQuantity: 1,
    };
  }

  const buildingSf = Number(rawPermit.building_sf || site.buildingSf || 0)
    || (Number(site.units || 0) * Number(site.avg_unit_sf || site.usf || 0));
  if (!buildingSf) return null;
  const psf = houseResalePsf(hood);
  return {
    value: Math.round(buildingSf * psf),
    source: 'house_resale_psf_assumption',
    metric: 'estimated resale price per SF',
    metricValue: psf,
    basisQuantity: Math.round(buildingSf),
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

async function getLandCompBenchmarks(neighborhoods = []) {
  const now = Date.now();
  const hoodList = [...new Set((Array.isArray(neighborhoods) ? neighborhoods : [neighborhoods])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const cacheKey = hoodList.length ? hoodList.join('|') : '*';
  const cached = _landCompCache.get(cacheKey);
  if (cached && now - cached.createdAt < CACHE_TTL) return cached.value;
  if (!process.env.SUPABASE_URL) return null;

  const cutoff = new Date(Date.now() - LAND_COMP_RECENCY_DAYS * 86400000).toISOString().slice(0, 10);
  let query = supabase
    .from('sold_comps')
    .select('address,neighborhood,project_type,units,avg_unit_sf,sale_price,sale_date,price_per_unit,price_per_sf,source,raw_record')
    .gte('sale_date', cutoff)
    .eq('project_type', 'Land')
    .order('sale_date', { ascending: false })
    .limit(hoodList.length === 1 ? 750 : 2500);

  if (hoodList.length) query = query.in('neighborhood', hoodList);
  const { data, error } = await query;

  if (error) {
    console.warn('[sites] Land comp benchmarks unavailable:', error.message);
    return null;
  }

  const benchmarks = buildLandCompBenchmarks(data || [], { recencyDays: LAND_COMP_RECENCY_DAYS });
  _landCompCache.set(cacheKey, { createdAt: now, value: benchmarks });
  while (_landCompCache.size > 50) _landCompCache.delete(_landCompCache.keys().next().value);
  return benchmarks;
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
  const buildingSf = Number(
    rawPermit.building_sf ||
    rawPermit.floor_area_l_a_building_code_definition ||
    rawPermit.floor_area_l_a_zoning_code_definition ||
    rawPermit.floor_area ||
    rawPermit.floorarea ||
    rawPermit.building_area ||
    rawPermit.total_floor_area ||
    rawPermit.new_floor_area ||
    rawPermit.proposed_floor_area ||
    rawPermit.project_floor_area ||
    rawPermit.square_footage ||
    rawPermit.sqft ||
    rawPermit.gross_floor_area ||
    rawPermit.gross_building_area ||
    rawPermit.residential_floor_area ||
    0
  ) || (units * avgUnitSf);
  const permitValuation = numberFromValue(rawPermit.permit_valuation ?? s.valuation) || null;
  const hasPermitValuationEstimate = hasPermitValuationDerivedHouseSize(s, rawPermit, {
    buildingSf,
    buildingSfSource: rawPermit.building_sf_source || rawPermit.avg_unit_sf_source,
    buildingSfParsed: rawPermit.building_sf_parsed,
  });
  const neighborhood = normalizedNeighborhood(s) || 'Koreatown';
  const unitMix = unitMixForSite(rawPermit, s, type);
  const ed1Affordability = resolveEd1Affordability({
    ...s,
    isEd1: isEd1Project(s, rawPermit),
    workDescription: rawPermit.work_description || rawPermit.project_description,
  });
  const rents = underwritingRentsForSite({ ...s, isEd1: !!ed1Affordability, ed1Affordability }, RENTS[neighborhood] || RENTS.Koreatown);
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
  const offMarket = /off|not for sale/i.test(String(s.status || '')) || isNewHousePermitPlaceholder(s, rawPermit);
  const doorLand = offMarket ? perDoorLandBasis(type, units) : null;
  const houseLotLand = offMarket ? houseLotLandBasis(type, normalizedLotSf(s)) : null;
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
  const needsLandComp = needsLandCompForHouse(s, rawPermit, houseLotLand || compLand, doorLand);
  const landCost = offMarket
    ? (needsLandComp ? null : (doorLand?.value || houseLotLand?.value || compLand?.value || price || fallbackLandCost))
    : (price || fallbackLandCost);
  const usedDynamicLand = offMarket && !needsLandComp && !!(doorLand?.value || houseLotLand?.value || (compLand?.value && !price));
  const landMeta = doorLand || houseLotLand || compLand || {};
  const recastCarry = usedDynamicLand ? Math.round((landCost + hardCosts + softCosts) * interestCarryPct) : carryCost;
  const recastTotalCost = usedDynamicLand ? landCost + hardCosts + softCosts + recastCarry : totalCost;
  const houseExit = houseExitEstimate(s, rawPermit, neighborhood);
  const exitValue = houseExit?.value || s.exit_value || 0;
  const recastIncome = unitMix.source === 'Parsed from permit text' || !!ed1Affordability;
  const noi = type === 'New House' ? 0 : (recastIncome
    ? Math.round(((grossPotentialRent * 0.95) + (units * 600)) * 0.65)
    : (s.noi || 0));
  const netProfit = needsLandComp ? null : (usedDynamicLand && exitValue ? exitValue - recastTotalCost : (s.net_profit || 0));
  const loanAmount = recastTotalCost * 0.65;
  const equity = recastTotalCost * 0.35;
  const storedIrr = Number(s.irr_v || 0);
  const recastIrr = needsLandComp ? null : (type === 'New House' && equity > 500 && exitValue
    ? Math.min(Math.max(irr([-equity, -loanAmount * 0.065, -loanAmount * 0.065, -loanAmount * 0.065, -loanAmount * 0.065, exitValue - loanAmount]), -50), 100)
    : storedIrr);
  const rawLandValueSource = landMeta.source || rawPermit.land_value_source || (offMarket ? 'permit_valuation_fallback' : 'asking_price');
  const landValueSource = rawLandValueSource === 'permit_valuation_fallback' && hasPermitValuationEstimate
    ? 'permit_valuation_estimate'
    : rawLandValueSource;

  return {
    needsLandComp,
    landBasisReliable: !needsLandComp,
    ed1Affordability,
    noi,
    totalCost: recastTotalCost,
    landCost,
    landValueSource: needsLandComp ? 'land_comp_needed' : landValueSource,
    landValueMetric: landMeta.metricLabel || rawPermit.land_value_metric || null,
    landValueMetricValue: landMeta.metricValue || rawPermit.land_value_metric_value || null,
    landValueBasisQuantity: landMeta.basisQuantity || rawPermit.land_value_basis_quantity || null,
    landValueCompCount: landMeta.compCount || rawPermit.land_value_comp_count || 0,
    landValueMatch: landMeta.matchLabel || rawPermit.land_value_match || null,
    landValueRecencyDays: landMeta.recencyDays || rawPermit.land_value_recency_days || LAND_COMP_RECENCY_DAYS,
    landValueComps: landMeta.comps || rawPermit.land_value_comps || [],
    exitValue,
    exitValueSource: houseExit?.source || rawPermit.exit_value_source || 'income_cap_rate',
    exitValueMetric: houseExit?.metric || rawPermit.exit_value_metric || null,
    exitValueMetricValue: houseExit?.metricValue || rawPermit.exit_value_metric_value || null,
    exitValueBasisQuantity: houseExit?.basisQuantity || rawPermit.exit_value_basis_quantity || null,
    exitProceeds:  netProfit,
    netProfit,
    grossPotentialRent: recastIncome ? grossPotentialRent : undefined,
    leveragedIRR:  recastIrr,
    capRateOnCost: recastTotalCost ? noi / recastTotalCost : (s.cap_on_cost || 0) / 100,
    devSpreadPct:  recastTotalCost ? (exitValue - recastTotalCost) / recastTotalCost : (s.dev_spread_pct || 0) / 100,
    marketCapRate: 0.0500,
    price,
    hardCosts,
    softCosts,
    carryCost: recastCarry,
    loanAmount,
    equity,
    equityMultiple: equity > 0 ? (exitValue / equity) : 0,
    buildingSf,
    buildingSfSource: rawPermit.building_sf_source || rawPermit.avg_unit_sf_source || null,
    buildingSfParsed: rawPermit.building_sf_parsed ?? null,
    permitValuation,
    lotSfSource: rawPermit.lot_sf_source || null,
  };
}

const OFFICIAL_PLANNING_DOCUMENTS = [
  {
    addressPattern: /\b125(?:00|32)\b.*\bRIVERSIDE\b/i,
    documents: [
      {
        id: 'ear-2024-5095-determination-and-exhibit-a',
        title: 'Determination and Architectural Plans',
        caseNumber: 'EAR-2024-5095-DB-VHCA',
        source: 'Los Angeles City Planning',
        determinationDate: '2025-05-07',
        planSetDate: '2024-12-05',
        determinationPage: 1,
        plansPage: 15,
        url: 'https://planning.lacity.gov/pdiscaseinfo/document/MzQ50/82065561-f922-4efb-8b32-0e189f041683/pdd',
      },
    ],
  },
];

const PLANNING_CASE_REPORTS_URL = 'https://planning.lacity.gov/resources/case-reports';
const ZIMAS_URL = 'https://planning.lacity.gov/zoning/zoning-search';
const LADBS_RECORDS_URL = 'https://dbs.lacity.gov/services/search-online-building-records';
const LADBS_RECORDS_REQUEST_URL = 'https://www.ladbs.org/docs/default-source/forms/administrative/research-request-form-ad-form-01.pdf';
const PDIS_BASE_URL = 'https://planning.lacity.gov/pdiscaseinfo';
const PDIS_ON_DEMAND_TIMEOUT_MS = 7000;
const PDIS_PROFILE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const PDIS_ON_DEMAND_CASE_LIMIT = 8;

function planningCaseUrl(caseNumber) {
  return `https://planning.lacity.gov/pdiscaseinfo/search/casenumber/${encodeURIComponent(caseNumber)}`;
}

function uniquePlanningDocuments(documents) {
  const seen = new Set();
  return documents.filter(document => {
    const key = `${document.caseNumber || ''}|${document.id || document.url || ''}|${document.section || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planningDocumentsForSite(site) {
  const rawPermit = site.raw_permit_data || {};
  const aliases = Array.isArray(rawPermit.address_aliases) ? rawPermit.address_aliases : [];
  const searchableAddresses = [site.address, site.addr, ...aliases]
    .filter(Boolean)
    .map(value => String(value).replace(/[^a-z0-9]+/gi, ' ').trim());

  const match = OFFICIAL_PLANNING_DOCUMENTS.find(entry =>
    searchableAddresses.some(address => entry.addressPattern.test(address))
  );
  const stored = [
    ...(Array.isArray(site.planning_documents) ? site.planning_documents : []),
    ...(Array.isArray(rawPermit.planning_documents) ? rawPermit.planning_documents : []),
  ];
  const manual = match ? match.documents.map(document => ({ ...document })) : [];
  return uniquePlanningDocuments([...stored, ...manual]);
}

function planningDocumentFromRow(document) {
  return {
    id: document.provider_document_id || document.id,
    title: document.title || 'Planning document',
    caseNumber: document.case_number,
    source: 'Los Angeles City Planning PDIS',
    documentType: document.document_type || 'other',
    category: document.document_category || null,
    section: document.section || null,
    documentDate: document.document_date || null,
    comments: document.comments || null,
    isApprovedPlan: document.is_approved_plan,
    url: document.url,
  };
}

function decodePlanningText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdisProfileValue(html, label) {
  const safeLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(new RegExp(
    `<div[^>]*class=["'][^"']*title[^"']*["'][^>]*>\\s*${safeLabel}:?\\s*</div>\\s*<div[^>]*class=["'][^"']*data[^"']*["'][^>]*>([\\s\\S]*?)</div>`,
    'i'
  ));
  return decodePlanningText(match?.[1]);
}

function parsePdisProfile(html) {
  const caseId = Number(String(html || '').match(/window\.caseIdentifier\s*=\s*(\d+)/i)?.[1]) || null;
  return {
    caseId,
    projectDescription: pdisProfileValue(html, 'Project Description') || null,
    requestedEntitlement: pdisProfileValue(html, 'Requested Entitlement') || null,
    applicant: pdisProfileValue(html, 'Applicant') || null,
    representative: pdisProfileValue(html, 'Representative') || null,
  };
}

function planningDocumentType(record) {
  const text = [record?.DocType, record?.DocumentCategory, record?.OriginalZaCardNumber, record?.Comments]
    .filter(Boolean).join(' ').toLowerCase();
  if (/determination|decision|letter of determination|findings/.test(text)) return 'determination';
  if (/cover sheet|title sheet|cover page/.test(text)) return 'cover_sheet';
  if (/floor plan/.test(text)) return 'floor_plan';
  if (/elevation/.test(text)) return 'elevation';
  if (/site plan/.test(text)) return 'site_plan';
  if (/architectural|project plan|approved plan|plan set|parcel map|plot plan/.test(text)) return 'project_plans';
  if (/application/.test(text)) return 'application';
  return 'other';
}

function planningDocumentDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function pdisDocumentRow(record, section, fallbackCaseNumber) {
  const providerId = String(record?.Id || record?.TpId || record?.EncodedId || '').trim();
  const caseNumber = String(record?.CaseNumber || record?.MeetingId || fallbackCaseNumber || '').trim().toUpperCase();
  const url = String(record?.ExternalUrl || '').trim();
  if (!providerId || !caseNumber || !/^https:\/\//i.test(url)) return null;
  const comments = decodePlanningText(record?.Comments);
  const baseTitle = decodePlanningText(record?.DocType || record?.OriginalZaCardNumber || record?.DocumentCategory) || 'Planning document';
  return {
    case_number: caseNumber,
    provider_document_id: providerId,
    title: comments && comments.length <= 120 ? `${baseTitle}: ${comments}` : baseTitle,
    document_type: planningDocumentType(record),
    document_category: decodePlanningText(record?.DocumentCategory) || null,
    section,
    document_date: planningDocumentDate(record?.ScanDate || record?.DateModified),
    url,
    comments: comments || null,
    is_approved_plan: record?.IsApprovedPlan ? /^yes$/i.test(String(record.IsApprovedPlan).trim()) : null,
    source_record: record,
    synced_at: new Date().toISOString(),
  };
}

async function fetchPdis(url, responseType = 'json') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDIS_ON_DEMAND_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: responseType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
        'User-Agent': 'ParcelLA/3.0 planning document lookup',
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`PDIS HTTP ${response.status}`);
    return responseType === 'json' ? parsePlanningPayload(text) : text;
  } finally {
    clearTimeout(timeout);
  }
}

function parsePlanningPayload(value, depth = 0) {
  if (depth > 3 || typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return parsePlanningPayload(JSON.parse(text), depth + 1);
  } catch {
    return value;
  }
}

function planningArray(value) {
  const decoded = parsePlanningPayload(value);
  if (Array.isArray(decoded)) return decoded;
  if (Array.isArray(decoded?.data)) return decoded.data;
  if (Array.isArray(decoded?.results)) return decoded.results;
  return [];
}

async function refreshPlanningCaseFromPdis(planningCase) {
  const caseNumber = planningCase.case_number;
  const pageUrl = planningCase.pdis_url || planningCaseUrl(caseNumber);
  const approvedUrl = `${PDIS_BASE_URL}/api/Service/GetPddData?caseNumbers=${encodeURIComponent(caseNumber)}`;
  const [pageResult, approvedResult] = await Promise.allSettled([
    fetchPdis(pageUrl, 'html'),
    fetchPdis(approvedUrl),
  ]);
  if (pageResult.status === 'rejected' && approvedResult.status === 'rejected') {
    throw new Error(`PDIS profile and document requests failed for ${caseNumber}`);
  }
  const profile = pageResult.status === 'fulfilled' ? parsePdisProfile(pageResult.value) : {};
  const caseId = planningCase.case_id || profile.caseId || null;
  const additional = caseId ? await Promise.allSettled([
    fetchPdis(`${PDIS_BASE_URL}/api/Service/GetEsubmitData/${encodeURIComponent(caseId)}`),
    fetchPdis(`${PDIS_BASE_URL}/api/Service/relatedcases/${encodeURIComponent(caseId)}`),
    fetchPdis(`${PDIS_BASE_URL}/api/Service/addresses/${encodeURIComponent(caseId)}`),
  ]) : [];
  const initial = additional[0]?.status === 'fulfilled' ? planningArray(additional[0].value) : [];
  const related = additional[1]?.status === 'fulfilled' ? planningArray(additional[1].value) : [];
  const addresses = additional[2]?.status === 'fulfilled' ? planningArray(additional[2].value) : [];
  const documents = [
    ...planningArray(approvedResult.status === 'fulfilled' ? approvedResult.value : []).map(row => pdisDocumentRow(row, 'approved', caseNumber)),
    ...initial.map(row => pdisDocumentRow(row, 'initial_submittal', caseNumber)),
  ].filter(Boolean);
  const relatedCaseNumbers = [...new Set(related
    .map(row => String(row?.caseNumber || row?.CaseNumber || '').trim().toUpperCase())
    .filter(Boolean))];
  const zimasPin = String(addresses.find(row => row?.pin)?.pin || planningCase.zimas_pin || '').trim() || null;
  const checkedAt = new Date().toISOString();
  const sourceRecord = {
    ...(planningCase.source_record || {}),
    pdis: {
      applicant: profile.applicant || null,
      representative: profile.representative || null,
      projectDescription: profile.projectDescription || null,
      requestedEntitlement: profile.requestedEntitlement || null,
      checkedAt,
    },
  };
  const caseUpdate = {
    case_id: caseId,
    project_description: profile.projectDescription || planningCase.project_description,
    request_type: profile.requestedEntitlement || planningCase.request_type,
    documents_checked_at: checkedAt,
    related_case_numbers: relatedCaseNumbers.length ? relatedCaseNumbers : (planningCase.related_case_numbers || []),
    case_addresses: addresses.length ? addresses : (planningCase.case_addresses || []),
    zimas_pin: zimasPin,
    zimas_url: zimasPin ? `https://zimas.lacity.org?pin=${encodeURIComponent(zimasPin)}` : planningCase.zimas_url,
    source_record: sourceRecord,
  };

  if (documents.length) {
    const { error } = await planningDb.from('planning_documents').upsert(documents, {
      onConflict: 'case_number,provider_document_id,section',
    });
    if (error) console.warn(`[planning] Could not cache PDIS documents for ${caseNumber}: ${error.message}`);
  }
  const { error: caseError } = await planningDb.from('planning_cases').update(caseUpdate).eq('case_number', caseNumber);
  if (caseError) console.warn(`[planning] Could not cache PDIS profile for ${caseNumber}: ${caseError.message}`);
  return { planningCase: { ...planningCase, ...caseUpdate }, documents };
}

function planningCaseFromRow(planningCase, match, documents) {
  const caseDocuments = documents.filter(document => document.case_number === planningCase.case_number);
  const pdisProfile = planningCase.source_record?.pdis || {};
  return {
    caseNumber: planningCase.case_number,
    caseId: planningCase.case_id,
    apn: planningCase.apn,
    address: planningCase.address,
    neighborhoodCouncil: planningCase.neighborhood_council,
    communityPlanArea: planningCase.community_plan_area,
    councilDistrict: planningCase.council_district,
    projectDescription: planningCase.project_description,
    requestType: planningCase.request_type,
    applicant: pdisProfile.applicant || null,
    representative: pdisProfile.representative || null,
    applicationDate: planningCase.application_date,
    completionDate: planningCase.completion_date,
    status: planningCase.case_status,
    pdisUrl: planningCase.pdis_url || planningCaseUrl(planningCase.case_number),
    zimasPin: planningCase.zimas_pin || null,
    zimasUrl: planningCase.zimas_url || null,
    caseAddresses: Array.isArray(planningCase.case_addresses) ? planningCase.case_addresses : [],
    relatedCaseNumbers: Array.isArray(planningCase.related_case_numbers) ? planningCase.related_case_numbers : [],
    matchMethod: match?.match_method || null,
    matchConfidence: match?.match_confidence || null,
    isPrimary: match?.is_primary || false,
    documents: caseDocuments.map(planningDocumentFromRow),
  };
}

function normalizePlanningAddress(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\bLOS ANGELES\b|\bCALIFORNIA\b/g, ' ')
    .replace(/\bCA\b/g, ' ')
    .replace(/\b9\d{4}(?:-\d{4})?\b/g, ' ')
    .replace(/\bSTREET\b/g, ' ST ')
    .replace(/\bAVENUE\b/g, ' AVE ')
    .replace(/\bBOULEVARD\b/g, ' BLVD ')
    .replace(/\bDRIVE\b/g, ' DR ')
    .replace(/\bROAD\b/g, ' RD ')
    .replace(/\bPLACE\b/g, ' PL ')
    .replace(/\bLANE\b/g, ' LN ')
    .replace(/\bCOURT\b/g, ' CT ')
    .replace(/\bPARKWAY\b/g, ' PKWY ')
    .replace(/\bHIGHWAY\b/g, ' HWY ')
    .replace(/\bNORTH\b/g, ' N ')
    .replace(/\bSOUTH\b/g, ' S ')
    .replace(/\bEAST\b/g, ' E ')
    .replace(/\bWEST\b/g, ' W ')
    .replace(/\b(?:UNIT|STE|SUITE|APT|APARTMENT)\s+[A-Z0-9-]+.*$/g, ' ')
    .replace(/[^A-Z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function planningAddressKeys(value) {
  const normalized = normalizePlanningAddress(value);
  if (!normalized) return [];
  const keys = new Set([normalized]);
  const range = normalized.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (range) {
    keys.add(`${range[1]} ${range[3]}`);
    keys.add(`${range[2]} ${range[3]}`);
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end >= start && end - start <= 500) {
      for (let number = start; number <= end; number += 1) keys.add(`${number} ${range[3]}`);
    }
  }
  return [...keys];
}

function planningAddressSpan(value) {
  const normalized = normalizePlanningAddress(value);
  const range = normalized.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (range) return { start: Number(range[1]), end: Number(range[2]), street: range[3] };
  const single = normalized.match(/^(\d+)\s+(.+)$/);
  return single ? { start: Number(single[1]), end: Number(single[1]), street: single[2] } : null;
}

function planningAddressSpansOverlap(left, right) {
  return !!left && !!right && left.street === right.street && left.start <= right.end && right.start <= left.end;
}

function planningApn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : '';
}

async function recoverPlanningMatches(site, siteId) {
  const apn = planningApn(site?.ownerApn || site?.apn || site?.externalPropertyRecord?.apn);
  const addressKeys = [...new Set([
    site?.addr,
    site?.address,
    ...(Array.isArray(site?.addressAliases) ? site.addressAliases : []),
  ].flatMap(planningAddressKeys).filter(Boolean))];
  const siteAddressSpans = [...new Map([
    site?.addr,
    site?.address,
    ...(Array.isArray(site?.addressAliases) ? site.addressAliases : []),
  ].map(planningAddressSpan).filter(Boolean).map(span => [`${span.start}|${span.end}|${span.street}`, span])).values()];
  const queries = [];
  if (apn) {
    queries.push(planningDb.from('planning_cases').select('*').eq('apn', apn).then(result => ({ ...result, method: 'apn', confidence: 1 })));
  }
  if (addressKeys.length) {
    queries.push(planningDb.from('planning_cases').select('*').in('address_normalized', addressKeys).then(result => ({ ...result, method: 'address_alias', confidence: 0.98 })));
  }
  for (const street of [...new Set(siteAddressSpans.map(span => span.street))]) {
    queries.push(planningDb.from('planning_cases').select('*').ilike('address_normalized', `%${street}%`).limit(250).then(result => ({
      ...result,
      data: (result.data || []).filter(row => siteAddressSpans.some(siteSpan => planningAddressSpansOverlap(siteSpan, planningAddressSpan(row.address_normalized || row.address)))),
      method: 'address_range',
      confidence: 0.96,
    })));
  }
  if (!queries.length) return { matches: [], cases: [] };

  const results = await Promise.all(queries);
  const rowsByCase = new Map();
  const matchByCase = new Map();
  for (const result of results) {
    if (result.error) throw result.error;
    for (const row of result.data || []) {
      rowsByCase.set(row.case_number, row);
      const previous = matchByCase.get(row.case_number);
      if (!previous || result.confidence > previous.match_confidence) {
        matchByCase.set(row.case_number, {
          site_id: siteId,
          case_number: row.case_number,
          match_method: result.method,
          match_confidence: result.confidence,
          is_primary: false,
          matched_at: new Date().toISOString(),
        });
      }
    }
  }

  const matches = [...matchByCase.values()];
  if (matches.length) {
    matches.sort((left, right) => String(rowsByCase.get(right.case_number)?.completion_date || rowsByCase.get(right.case_number)?.application_date || '')
      .localeCompare(String(rowsByCase.get(left.case_number)?.completion_date || rowsByCase.get(left.case_number)?.application_date || '')));
    matches[0].is_primary = true;
    const { error } = await planningDb.from('site_planning_cases').upsert(matches, { onConflict: 'site_id,case_number' });
    if (error) console.warn(`[planning] Could not persist recovered matches for site ${siteId}: ${error.message}`);
  }
  return { matches, cases: [...rowsByCase.values()] };
}

async function attachPlanningDiscovery(site, siteId) {
  const manualDocuments = planningDocumentsForSite(site);
  const manualCaseNumbers = [...new Set(manualDocuments.map(document => document.caseNumber).filter(Boolean))];
  try {
    const [{ data: syncState, error: stateError }, { data: storedMatches, error: matchError }, { data: indexProbe, error: indexError }] = await Promise.all([
      planningDb.from('planning_sync_state').select('*').eq('id', 1).maybeSingle(),
      planningDb.from('site_planning_cases').select('*').eq('site_id', siteId),
      planningDb.from('planning_cases').select('case_number').limit(1),
    ]);
    if (stateError) throw stateError;
    if (matchError) throw matchError;
    if (indexError) throw indexError;

    let matches = storedMatches || [];
    let recoveredCaseRows = [];
    if (!matches.length) {
      const recovered = await recoverPlanningMatches(site, siteId);
      matches = recovered.matches;
      recoveredCaseRows = recovered.cases;
    }

    const caseNumbers = [...new Set([...(matches || []).map(match => match.case_number), ...manualCaseNumbers])];
    let caseRows = [];
    let documentRows = [];
    if (caseNumbers.length) {
      const [{ data: cases, error: casesError }, { data: documents, error: documentsError }] = await Promise.all([
        planningDb.from('planning_cases').select('*').in('case_number', caseNumbers),
        planningDb.from('planning_documents').select('*').in('case_number', caseNumbers).order('document_date', { ascending: false }),
      ]);
      if (casesError) throw casesError;
      if (documentsError) throw documentsError;
      const fetchedCases = cases || [];
      caseRows = [...new Map([...recoveredCaseRows, ...fetchedCases].map(row => [row.case_number, row])).values()];
      documentRows = documents || [];

      const documentCaseNumbers = new Set(documentRows.map(document => document.case_number));
      const staleBefore = Date.now() - PDIS_PROFILE_STALE_MS;
      const refreshCandidates = caseRows.filter(row => {
        const profileCheckedAt = row.source_record?.pdis?.checkedAt;
        const profileIsStale = !profileCheckedAt || new Date(profileCheckedAt).getTime() < staleBefore;
        return !documentCaseNumbers.has(row.case_number) || profileIsStale;
      }).slice(0, PDIS_ON_DEMAND_CASE_LIMIT);
      if (refreshCandidates.length) {
        const refreshResults = await Promise.allSettled(refreshCandidates.map(refreshPlanningCaseFromPdis));
        const caseMap = new Map(caseRows.map(row => [row.case_number, row]));
        const documentMap = new Map(documentRows.map(row => [
          `${row.case_number}|${row.provider_document_id}|${row.section}`,
          row,
        ]));
        for (const result of refreshResults) {
          if (result.status !== 'fulfilled') {
            console.warn(`[planning] On-demand PDIS refresh failed for site ${siteId}: ${result.reason?.message || result.reason}`);
            continue;
          }
          caseMap.set(result.value.planningCase.case_number, result.value.planningCase);
          for (const document of result.value.documents) {
            documentMap.set(`${document.case_number}|${document.provider_document_id}|${document.section}`, document);
          }
        }
        caseRows = [...caseMap.values()];
        documentRows = [...documentMap.values()].sort((left, right) => String(right.document_date || '').localeCompare(String(left.document_date || '')));
      }
    }

    const matchesByCase = new Map((matches || []).map(match => [match.case_number, match]));
    const cases = caseRows.map(row => planningCaseFromRow(row, matchesByCase.get(row.case_number), documentRows));
    for (const caseNumber of manualCaseNumbers) {
      if (!cases.some(planningCase => planningCase.caseNumber === caseNumber)) {
        cases.push({
          caseNumber,
          status: 'verified_manual',
          pdisUrl: planningCaseUrl(caseNumber),
          relatedCaseNumbers: [],
          documents: manualDocuments.filter(document => document.caseNumber === caseNumber),
          matchMethod: 'verified_manual',
          matchConfidence: 1,
          isPrimary: cases.length === 0,
        });
      }
    }

    const discoveredDocuments = cases.flatMap(planningCase => planningCase.documents || []);
    const planningDocuments = uniquePlanningDocuments([...discoveredDocuments, ...manualDocuments]);
    const syncComplete = syncState?.status === 'complete' || (indexProbe || []).length > 0;
    const status = cases.length
      ? 'cases_found'
      : (syncComplete ? 'no_discretionary_case_found' : 'index_pending');
    return {
      ...site,
      hasPlanningDocuments: planningDocuments.length > 0,
      planningCases: cases,
      planningDocuments,
      planningDiscovery: {
        status,
        checkedAt: syncState?.completed_at || syncState?.updated_at || null,
        caseReportsUrl: PLANNING_CASE_REPORTS_URL,
        zimasUrl: ZIMAS_URL,
        ladbsRecordsUrl: LADBS_RECORDS_URL,
        ladbsRecordsRequestUrl: LADBS_RECORDS_REQUEST_URL,
        message: cases.length
          ? `${cases.length} related discretionary planning case${cases.length === 1 ? '' : 's'} found.`
          : (syncComplete
            ? 'The imported City Planning case reports contain no matching discretionary case or direct PDF for this address/APN.'
            : 'Planning PDF discovery has not completed its first sync.'),
      },
    };
  } catch (error) {
    console.warn(`[planning] Discovery unavailable for site ${siteId}: ${error.message}`);
    const manualCases = manualCaseNumbers.map((caseNumber, index) => ({
      caseNumber,
      status: 'verified_manual',
      pdisUrl: planningCaseUrl(caseNumber),
      relatedCaseNumbers: [],
      documents: manualDocuments.filter(document => document.caseNumber === caseNumber),
      matchMethod: 'verified_manual',
      matchConfidence: 1,
      isPrimary: index === 0,
    }));
    return {
      ...site,
      hasPlanningDocuments: manualDocuments.length > 0,
      planningCases: manualCases,
      planningDocuments: manualDocuments,
      planningDiscovery: {
        status: manualCases.length ? 'cases_found' : 'index_unavailable',
        checkedAt: null,
        caseReportsUrl: PLANNING_CASE_REPORTS_URL,
        zimasUrl: ZIMAS_URL,
        ladbsRecordsUrl: LADBS_RECORDS_URL,
        ladbsRecordsRequestUrl: LADBS_RECORDS_REQUEST_URL,
        message: manualCases.length
          ? `${manualCases.length} verified planning case${manualCases.length === 1 ? '' : 's'} found.`
          : 'Planning PDF discovery is temporarily unavailable.',
      },
    };
  }
}

function mapSupabaseSite(s, i = 0, landCompBenchmarks = null) {
  const rawPermit = s.raw_permit_data || {};
  const addressAliases = Array.isArray(rawPermit.address_aliases) ? rawPermit.address_aliases : [];
  const neighborhood = normalizedNeighborhood(s) || 'Neighborhood TBD';
  const lotSf = normalizedLotSf(s);
  const model = modelFromSupabaseSite(s, landCompBenchmarks);
  const permitDetail = newHousePermitDetail(s, model);
  const status = model.needsLandComp ? 'off-market' : (s.status || 'active');
  const offMarket = model.needsLandComp || /off|not for sale/i.test(status);
  const unitMix = unitMixForSite(rawPermit, s, s.project_type ?? s.type);
  const ownerInfo = ownerInfoFromRaw(rawPermit, s);
  const externalSources = Array.isArray(s.external_data_sources) ? s.external_data_sources : [];
  const planningDocuments = planningDocumentsForSite(s);
  const planningCases = Array.isArray(rawPermit.planning_cases) ? rawPermit.planning_cases : [];
  return {
    id:           s.id || (50000 + i),
    addr:         s.address ?? s.addr,
    hood:         neighborhood,
    type:         canonicalProjectType(s.project_type ?? s.type) || 'Multifamily',
    zone:         s.zoning ?? s.zone ?? null,
    lot:          lotSf,
    units:        s.units ?? null,
    usf:          s.avg_unit_sf ?? s.usf ?? 800,
    buildingSf:   rawPermit.building_sf ||
      rawPermit.floor_area_l_a_building_code_definition ||
      rawPermit.floor_area_l_a_zoning_code_definition ||
      model.buildingSf ||
      null,
    buildingSfSource: rawPermit.building_sf_source || rawPermit.avg_unit_sf_source || null,
    buildingSfParsed: rawPermit.building_sf_parsed ?? null,
    permitValuation: rawPermit.permit_valuation || model.permitValuation || null,
    lotSfSource:  rawPermit.lot_sf_source || null,
    isEd1:        isEd1Project(s, rawPermit),
    ed1Affordability: model.ed1Affordability || resolveEd1Affordability({ ...s, raw_permit_data: rawPermit }),
    stories:      rawPermit.stories || rawPermit.of_stories || rawPermit.number_of_stories || permitDetail.stories || null,
    exitValueSource: rawPermit.exit_value_source || model.exitValueSource || null,
    exitValueMetric: rawPermit.exit_value_metric || model.exitValueMetric || null,
    exitValueMetricValue: rawPermit.exit_value_metric_value || model.exitValueMetricValue || null,
    exitValueBasisQuantity: rawPermit.exit_value_basis_quantity || model.exitValueBasisQuantity || null,
    rti:          s.rti ?? false,
    status,
    listingStatus: offMarket ? 'Off-market / not for sale' : 'For sale',
    forSale:      !offMarket,
    isComp:       s.is_comp ?? false,
    price:        model.needsLandComp ? null : (s.price ?? model.landCost ?? null),
    demo:         s.has_demo ?? false,
    lat:          s.lat,
    lng:          s.lng,
    permitSourceId: s.permit_source_id,
    permitNumber: rawPermit.permit_number || null,
    permitStatus: rawPermit.permit_status || rawPermit.status || null,
    developmentStatus: rawPermit.development_status || null,
    inspectionCheck: rawPermit.inspection_check || null,
    workDescription: permitDetail.workDescription || rawPermit.work_description || rawPermit.project_description || null,
    projectDetailStatus: permitDetail.isUsable ? 'available' : 'not_available',
    projectDetailUnavailableReason: permitDetail.missing || [],
    contractorName: rawPermit.contractor_name || rawPermit.contractors_business_name || rawPermit.contractor_business_name || permitDetail.contractorName || null,
    contractorAddress: rawPermit.contractor_address || null,
    contractorCity: rawPermit.contractor_city || null,
    contractorState: rawPermit.contractor_state || null,
    applicantName: rawPermit.applicant_name || permitDetail.applicantName || null,
    applicantBusinessName: rawPermit.applicant_business_name || null,
    addressAliases,
    externalEnrichedAt: s.external_enriched_at || null,
    externalDataSources: externalSources,
    dataQuality: s.data_quality || null,
    rentcastEnrichedAt: s.rentcast_enriched_at || null,
    regridEnrichedAt: s.regrid_enriched_at || null,
    externalPropertyRecord: s.external_property_record || null,
    externalRentEstimate: s.external_rent_estimate || null,
    externalValueEstimate: s.external_value_estimate || null,
    externalRentComps: Array.isArray(s.external_rent_comps) ? s.external_rent_comps : [],
    externalSaleComps: Array.isArray(s.external_sale_comps) ? s.external_sale_comps : [],
    hasPlanningDocuments: planningDocuments.length > 0,
    planningCases,
    planningDocuments,
    planningDiscovery: rawPermit.planning_discovery || null,
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
    projectDetailStatus: null,
    projectDetailUnavailableReason: [],
    stories: null,
    contractorName: null,
    contractorAddress: null,
    contractorCity: null,
    contractorState: null,
    applicantName: null,
    applicantBusinessName: null,
    addressAliases: [],
    hasPlanningDocuments: false,
    planningCases: [],
    planningDocuments: [],
    planningDiscovery: null,
    ownerName: null,
    ownerApplicantName: null,
    ownerMailingAddress: null,
    ownerSitusAddress: null,
    ownerApn: null,
    ownerLastSaleDate: null,
    ownerLastSaleAmount: null,
    ownerSource: null,
    ownerEnrichedAt: null,
    externalEnrichedAt: null,
    externalDataSources: [],
    dataQuality: null,
    rentcastEnrichedAt: null,
    regridEnrichedAt: null,
    externalPropertyRecord: null,
    externalRentEstimate: null,
    externalValueEstimate: null,
    externalRentComps: [],
    externalSaleComps: [],
    lat: null,
    lng: null,
    landValueMatch: null,
    landValueComps: [],
    planningDocuments: [],
  };
}

function listParam(value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function canonicalProjectType(value) {
  const raw = String(value || '').trim();
  const compact = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/');
  if (!compact) return '';
  if (compact === 'mixed-use' || compact === 'mixed use') return 'Mixed-Use';
  if (compact === 'condo/th' || compact.includes('townhouse')) return 'Condo/TH';
  if (compact === 'new house' || compact === 'single family' || compact === 'sfd') return 'New House';
  if (compact === 'multifamily' || compact === 'multi-family' || compact === 'multi family') return 'Multifamily';
  return raw;
}

function isEd1Project(site = {}, raw = site.raw_permit_data || {}) {
  if (site.isEd1 === true || site.is_ed1 === true || raw.is_ed1 === true) return true;
  const text = [
    site.workDescription,
    site.work_description,
    site.program,
    raw.work_description,
    raw.project_description,
    raw.description,
    raw.program,
    raw.case_number,
    raw.case_no,
    raw.planning_case,
    raw.entitlement_case,
  ].filter(Boolean).join(' ');
  return /(^|[^a-z0-9])ed[- ]?1([^a-z0-9]|$)|executive directive\s*(?:no\.?\s*)?1/i.test(text);
}

function dbProjectTypeVariants(value) {
  const type = canonicalProjectType(value);
  const variants = {
    'Multifamily': ['Multifamily', 'Multi-Family', 'Multi Family'],
    'Mixed-Use': ['Mixed-Use', 'Mixed-use', 'Mixed Use'],
    'Condo/TH': ['Condo/TH', 'Condo / TH', 'Condo', 'Townhouse'],
    'New House': ['New House', 'Single Family', 'SFD'],
  };
  return variants[type] || (type ? [type] : []);
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

function searchParts(value) {
  const parts = String(value || '')
    .split(/[,\n;]+/)
    .map(cleanSearchTerm)
    .filter(Boolean);
  return parts.length ? parts : [cleanSearchTerm(value)].filter(Boolean);
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

function permitSearchDbClauses(value) {
  const clauses = [];
  for (const variant of searchDbVariants(value)) {
    const normalized = cleanSearchTerm(variant);
    if (!normalized) continue;

    if (/^\d{3,6}$/.test(normalized)) {
      clauses.push(`address.like.${normalized}%`);
      continue;
    }

    if (/^\d{3,6}\s+/.test(normalized)) {
      clauses.push(`address.ilike.${normalized.replace(/\s+/g, '%')}%`);
      continue;
    }

    clauses.push(`address.ilike.%${normalized}%`);
    if (/^\d{2,}-\d{2,}(?:-|$)/.test(normalized)) {
      clauses.push(`permit_number.ilike.${normalized}%`);
    }
  }
  return [...new Set(clauses)];
}

function siteSearchDbClauses(value) {
  const clauses = [];
  for (const variant of searchDbVariants(value)) {
    const normalized = cleanSearchTerm(variant);
    if (!normalized) continue;

    if (/^\d{3,6}$/.test(normalized)) {
      clauses.push(`address.like.${normalized}%`);
      continue;
    }

    if (/^\d{3,6}\s+/.test(normalized)) {
      clauses.push(`address.ilike.${normalized.replace(/\s+/g, '%')}%`);
      continue;
    }

    clauses.push(`address.ilike.%${normalized}%`);
    if (/^\d{2,}-\d{2,}(?:-|$)/.test(normalized)) {
      clauses.push(`permit_source_id.ilike.${normalized}%`);
    }
  }
  return [...new Set(clauses)];
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
    s.buildingSf,
    s.totalBuildingSf,
    s._m?.buildingSf,
    ...aliases,
    ...knownAliases,
  ].map(v => String(v || '').toUpperCase()).join(' ');
}

function searchHaystackMatches(haystack, value) {
  return searchParts(value).some(part => {
    const term = cleanSearchTerm(part).toUpperCase();
    return haystack.includes(term) ||
      orderedTokenMatch(haystack, part) ||
      searchVariants(part).some(variant => haystack.includes(variant.toUpperCase()));
  });
}

function siteMatchesSearch(s, value) {
  if (!cleanSearchTerm(value)) return true;
  return searchHaystackMatches(siteSearchHaystack(s), value);
}

function permitSearchHaystack(p = {}) {
  const raw = p.raw_data || {};
  return [
    p.address,
    p.permit_number,
    p.status,
    p.permit_type,
    p.permit_subtype,
    p.work_description,
    raw.address,
    raw.primary_address,
    raw.project_address,
    raw.pcis_permit,
    raw.permit_nbr,
    raw.permitnumber,
    raw.work_description,
    raw.work_desc,
    raw.workdescription,
    raw.project_description,
    raw.description,
    raw.use_desc,
  ].map(v => String(v || '').toUpperCase()).join(' ');
}

function permitMatchesSearch(p = {}, value = '') {
  if (!cleanSearchTerm(value)) return false;
  return searchHaystackMatches(permitSearchHaystack(p), value);
}

function statusIsRti(value) {
  const status = String(value || '');
  if (/not ready/i.test(status)) return false;
  return /ready to issue|pc approved|approved/i.test(status);
}

function permitRowAsHouseSite(p = {}) {
  const raw = p.raw_data || {};
  const address = firstText(
    p.address,
    raw.address,
    raw.primary_address,
    raw.location_address,
    raw.project_address,
    [raw.address_start, raw.street_direction, raw.street_name, raw.street_suffix].filter(Boolean).join(' ')
  );
  const work = firstText(
    p.work_description,
    raw.work_description,
    raw.work_desc,
    raw.workdescription,
    raw.project_description,
    raw.description,
    raw.use_desc
  );
  const units = numberFromValue(
    p.units ??
    raw.of_residential_dwelling_units ??
    raw.number_of_units ??
    raw.numberofunits ??
    raw.du_changed
  ) || 0;
  const subtype = p.permit_subtype || raw.permit_sub_type || raw.permitsubtype || raw.use_desc || '';
  const type = guessType(p.permit_type || raw.permit_type || raw.permittype, subtype, units);
  const sourceFloorArea = firstText(
    p.building_sf,
    raw.floor_area_l_a_building_code_definition,
    raw.floor_area_l_a_zoning_code_definition,
    raw.floor_area,
    raw.floorarea,
    raw.building_area,
    raw.building_sf,
    raw.total_floor_area,
    raw.new_floor_area,
    raw.proposed_floor_area,
    raw.project_floor_area,
    raw.square_footage,
    raw.sqft,
    raw.gross_floor_area,
    raw.gross_building_area,
    raw.residential_floor_area
  );
  const textFloorAreas = textAreaMatches([work, raw.project_description, raw.description, raw.use_desc]);
  const textFloorArea = textFloorAreas.length ? Math.max(...textFloorAreas.map(match => match.value)) : 0;
  const sourceFloorAreaNumber = sourceFloorArea ? numberFromValue(sourceFloorArea) : 0;
  const buildingSf = numberFromValue(p.building_sf) || textFloorArea || sourceFloorAreaNumber || null;
  const buildingSfSource = p.building_sf_source || (textFloorArea
    ? 'Permit work description'
    : (sourceFloorAreaNumber ? 'Permit source field' : null));
  const displayUnits = units || (type === 'New House' ? 1 : null);
  const avgUnitSf = buildingSf && displayUnits ? Math.round(buildingSf / displayUnits) : buildingSf;
  const lat = numberFromValue(p.lat ?? raw.lat ?? raw.latitude);
  const lng = numberFromValue(p.lng ?? p.lon ?? raw.lng ?? raw.lon ?? raw.longitude);
  const permitNumber = p.permit_number || raw.pcis_permit || raw.permit_nbr || raw.permitnumber || null;
  const status = p.status || raw.status || raw.status_desc || raw.latest_status || null;
  return {
    id: p.id || permitNumber || null,
    address,
    neighborhood: hoodFromCoords(lat, lng) || guessHood(address, p.zone || raw.zone || raw.zoning),
    project_type: type,
    zoning: p.zone || raw.zone || raw.zoning || null,
    lot_sf: numberFromValue(
      p.lot_sf ??
      raw.lot_area ??
      raw.lot_sf ??
      raw.lot_size ??
      raw.lot_square_footage ??
      raw.lot_sqft ??
      raw.site_area ??
      raw.parcel_area
    ),
    units: displayUnits,
    avg_unit_sf: avgUnitSf,
    rti: Boolean(p.is_rti || statusIsRti(status)),
    is_comp: false,
    price: null,
    status: 'off-market',
    lat,
    lng,
    permit_source_id: permitNumber,
    total_cost: null,
    hard_costs: null,
    soft_costs: null,
    carry_cost: null,
    noi: null,
    exit_value: null,
    net_profit: null,
    irr_v: null,
    cap_on_cost: null,
    dev_spread_pct: null,
    entry_cap_rate: null,
    permitValuation: p.valuation || raw.valuation || null,
    raw_permit_data: {
      ...raw,
      permit_valuation: p.valuation || raw.valuation || null,
      permit_units: displayUnits,
      permit_number: permitNumber,
      permit_status: status,
      development_status: developmentStatusKey({
        permitStatus: status,
        workDescription: work,
        rti: Boolean(p.is_rti || statusIsRti(status)),
      }),
      work_description: work || null,
      building_sf: buildingSf,
      building_sf_source: buildingSfSource,
      building_sf_parsed: p.building_sf_parsed ?? !!buildingSfSource,
      lot_sf: numberFromValue(p.lot_sf ?? raw.lot_area ?? raw.lot_sf ?? raw.lot_size ?? raw.site_area ?? raw.parcel_area) || null,
      lot_sf_source: p.lot_sf_source || raw.lot_sf_source || null,
      stories: p.stories || raw.of_stories || raw.stories || raw.number_of_stories || raw.story_count || null,
      contractor_name: p.contractor_name || raw.contractor_name || raw.contractors_business_name || raw.contractor_business_name || null,
      contractor_address: p.contractor_address || raw.contractor_address || null,
      contractor_city: p.contractor_city || raw.contractor_city || null,
      contractor_state: p.contractor_state || raw.contractor_state || null,
      applicant_name: p.applicant_name || raw.applicant_name || [raw.applicant_first_name, raw.applicant_last_name].filter(Boolean).join(' ') || null,
      applicant_business_name: p.applicant_business_name || raw.applicant_business_name || null,
      project_detail_complete: p.project_detail_complete ?? null,
    },
  };
}

function sortPermitHouseSites(sites, sort = 'profit') {
  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const metric = (site, key) => num(site?._m?.[key]) ?? -Infinity;
  const land = site => num(site.price ?? site._m?.landCost) ?? Infinity;
  const sorters = {
    profit: (a, b) => (metric(b, 'netProfit') - metric(a, 'netProfit')) || ((num(b.permitValuation) || 0) - (num(a.permitValuation) || 0)),
    irr: (a, b) => metric(b, 'leveragedIRR') - metric(a, 'leveragedIRR'),
    spread: (a, b) => metric(b, 'devSpreadPct') - metric(a, 'devSpreadPct'),
    capoc: (a, b) => metric(b, 'capRateOnCost') - metric(a, 'capRateOnCost'),
    'price-a': (a, b) => land(a) - land(b),
    'price-d': (a, b) => land(b) - land(a),
    units: (a, b) => (num(b.units) || 0) - (num(a.units) || 0),
  };
  return [...sites].sort(sorters[sort] || sorters.profit);
}

function permitHousePageCacheKey(queryParams, requestedLimit, requestedOffset) {
  const normalized = Object.keys(queryParams || {})
    .sort()
    .reduce((result, key) => {
      result[key] = queryParams[key];
      return result;
    }, {});
  return JSON.stringify([requestedLimit, requestedOffset, normalized]);
}

function cachedPermitHousePage(key) {
  const cached = _housePageCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > HOUSE_PAGE_CACHE_TTL) {
    _housePageCache.delete(key);
    return null;
  }
  return cached.value;
}

function cachePermitHousePage(key, value) {
  _housePageCache.set(key, { createdAt: Date.now(), value });
  while (_housePageCache.size > 100) {
    _housePageCache.delete(_housePageCache.keys().next().value);
  }
  return value;
}

function indexedPermitFieldsUnavailable(error) {
  const text = [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(' ');
  return /building_sf|lot_sf|lot_sf_source|project_detail_complete|stories|schema cache|PGRST204|42703/i.test(text);
}

async function fetchCombinedNewHouseSearchRows(queryParams, hoodBox, requestedLimit, requestedOffset) {
  const requestedParts = searchParts(queryParams.q || queryParams.search);
  if (requestedParts.length <= 1) return null;

  // A pasted list such as "5903, 6095, Pico, Riverside" identifies the
  // properties by street number. Avoid broad citywide scans for the trailing
  // street/city words once one or more address numbers are available.
  const numberedParts = requestedParts.filter(part => /^\d{3,6}\b/.test(part));
  const parts = numberedParts.length ? numberedParts : requestedParts;

  const target = requestedOffset + requestedLimit;
  const pageSize = Math.min(100, Math.max(40, target * 2));
  const minSf = activeNumericParam(queryParams.minSf);
  const maxSf = activeNumericParam(queryParams.maxSf);
  const lookupPart = async part => {
    let query = supabase
      .from('permits')
      .select(PERMIT_HOUSE_INDEXED_SELECT)
      .eq('permit_type', 'Bldg-New')
      .eq('project_detail_complete', true)
      .not('address', 'is', null)
      .or('units.lte.1,units.is.null')
      .order('id', { ascending: false })
      .range(0, pageSize - 1);

    if (minSf !== null) query = query.gte('building_sf', minSf);
    if (maxSf !== null) query = query.lte('building_sf', maxSf);
    if (hoodBox) {
      query = query
        .gte('lat', hoodBox.lat0)
        .lte('lat', hoodBox.lat1)
        .gte('lng', hoodBox.lng0)
        .lte('lng', hoodBox.lng1);
    }

    const clauses = permitSearchDbClauses(part);
    if (clauses.length) query = query.or(clauses.join(','));
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  };

  // The small Supabase instance can choose a slow plan when two permit
  // searches start at exactly the same time. Run the short address lookups in
  // sequence and retry a transient statement timeout once.
  const settled = [];
  for (const part of parts) {
    let result = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = { status: 'fulfilled', value: await lookupPart(part) };
        break;
      } catch (error) {
        const retryable = /timeout|canceling statement|aborted/i.test(String(error?.message || error));
        if (!retryable || attempt === 1) {
          result = { status: 'rejected', reason: error };
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    settled.push(result);
  }

  const successful = settled.filter(result => result.status === 'fulfilled');
  if (!successful.length) throw settled.find(result => result.status === 'rejected')?.reason || new Error('Permit search failed');

  const failedCount = settled.length - successful.length;
  if (failedCount) console.warn(`[sites:new-house] ${failedCount}/${settled.length} combined search lookups failed; returning successful matches`);
  const rows = [];
  const seen = new Set();
  for (const result of successful) {
    for (const row of result.value) {
      const key = String(row.id || row.permit_number || `${row.address}|${row.issued_date || ''}`);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return {
    rows,
    hasMore: successful.some(result => result.value.length === pageSize),
  };
}

async function fetchNewHousePermitPage(queryParams, requestedLimit, requestedOffset) {
  const cacheKey = permitHousePageCacheKey(queryParams, requestedLimit, requestedOffset);
  const cached = cachedPermitHousePage(cacheKey);
  if (cached) return cached;

  const rawSearch = queryParams.q || queryParams.search || '';
  const search = cleanSearchTerm(rawSearch);
  const hoodName = String(queryParams.hood || '').trim();
  const hoodBox = NEIGHBORHOOD_BOXES.find(box => box.h === hoodName);
  const target = requestedOffset + requestedLimit;

  try {
    const combined = await fetchCombinedNewHouseSearchRows(queryParams, hoodBox, requestedLimit, requestedOffset);
    if (combined) {
      const permitSites = combined.rows.map(permitRowAsHouseSite);
      const compHoods = [...new Set([
        hoodName,
        ...permitSites.map(site => normalizedNeighborhood(site)),
      ].map(value => String(value || '').trim()).filter(Boolean))];
      const landCompBenchmarks = await getLandCompBenchmarks(compHoods);
      const matches = permitSites
        .map((site, index) => mapSupabaseSite(site, index, landCompBenchmarks))
        .filter(site => isNewHouseSite(site))
        .filter(site => isPrimaryNewHouseWorkDescription(site.workDescription))
        .filter(site => sitePassesQueryFilters(site, queryParams));
      const sorted = sortPermitHouseSites(matches, queryParams.sort || 'profit');
      const page = sorted.slice(requestedOffset, requestedOffset + requestedLimit);
      const total = combined.hasMore
        ? Math.max(sorted.length, requestedOffset + page.length + requestedLimit)
        : sorted.length;
      return cachePermitHousePage(cacheKey, { sites: page, total });
    }
  } catch (error) {
    if (!indexedPermitFieldsUnavailable(error)) throw error;
    console.warn('[sites:new-house] Combined indexed search unavailable; using standard permit query:', error.message);
  }

  const matches = [];
  let rawOffset = 0;
  let reachedEnd = false;
  let indexedMode = true;
  let indexedTotal = null;

  while (matches.length < target) {
    const pageSize = indexedMode
      ? Math.min(100, Math.max(40, target * 2))
      : (search || hoodBox ? Math.min(120, Math.max(40, target * 6)) : Math.min(60, Math.max(25, target * 6)));
    const maxRawRows = indexedMode
      ? Math.min(500, Math.max(target * 10, 100))
      : (search || hoodBox ? Math.min(1800, Math.max(target * 45, 360)) : Math.min(600, Math.max(target * 30, 120)));
    if (rawOffset >= maxRawRows) break;

    let query = supabase
      .from('permits')
      .select(
        indexedMode ? PERMIT_HOUSE_INDEXED_SELECT : PERMIT_HOUSE_SELECT,
        indexedMode ? { count: 'planned' } : undefined
      )
      .eq('permit_type', 'Bldg-New')
      .not('address', 'is', null)
      .or('units.lte.1,units.is.null')
      .order('id', { ascending: false })
      .range(rawOffset, rawOffset + pageSize - 1);

    if (indexedMode) {
      query = query.eq('project_detail_complete', true);
      const minSf = activeNumericParam(queryParams.minSf);
      const maxSf = activeNumericParam(queryParams.maxSf);
      if (minSf !== null) query = query.gte('building_sf', minSf);
      if (maxSf !== null) query = query.lte('building_sf', maxSf);
    }

    if (hoodBox) {
      query = query
        .gte('lat', hoodBox.lat0)
        .lte('lat', hoodBox.lat1)
        .gte('lng', hoodBox.lng0)
        .lte('lng', hoodBox.lng1);
    }

    if (search) {
      const clauses = permitSearchDbClauses(rawSearch);
      if (clauses.length) query = query.or(clauses.join(','));
    }

    const { data, error, count } = await query;
    if (error && indexedMode && indexedPermitFieldsUnavailable(error)) {
      console.warn('[sites:new-house] Indexed permit fields unavailable; using legacy JSON scan:', error.message);
      indexedMode = false;
      indexedTotal = null;
      rawOffset = 0;
      matches.length = 0;
      continue;
    }
    if (error) throw error;
    if (indexedMode && Number.isFinite(Number(count))) indexedTotal = Number(count);
    const rows = data || [];
    if (!rows.length) {
      reachedEnd = true;
      break;
    }

    const permitSites = rows.map(permitRowAsHouseSite);
    const compHoods = [...new Set([
      hoodName,
      ...permitSites.map(site => normalizedNeighborhood(site)),
    ].map(value => String(value || '').trim()).filter(Boolean))];
    const landCompBenchmarks = await getLandCompBenchmarks(compHoods);
    const mapped = permitSites
      .map((site, i) => mapSupabaseSite(site, rawOffset + i, landCompBenchmarks))
      .filter(site => isNewHouseSite(site))
      .filter(site => isPrimaryNewHouseWorkDescription(site.workDescription))
      .filter(site => sitePassesQueryFilters(site, queryParams));
    matches.push(...mapped);

    if (rows.length < pageSize) {
      reachedEnd = true;
      break;
    }
    rawOffset += pageSize;
  }

  const sorted = sortPermitHouseSites(matches, queryParams.sort || 'profit');
  const page = sorted.slice(requestedOffset, requestedOffset + requestedLimit);
  const total = indexedMode && indexedTotal !== null
    ? indexedTotal
    : reachedEnd
    ? sorted.length
    : Math.max(sorted.length, requestedOffset + page.length + (page.length ? requestedLimit : 0));
  return cachePermitHousePage(cacheKey, { sites: page, total });
}

async function permitDetailNoticeForSearch(searchValue) {
  if (!process.env.SUPABASE_URL || !cleanSearchTerm(searchValue)) return null;
  const clauses = permitSearchDbClauses(searchValue);
  if (!clauses.length) return null;

  const { data, error } = await supabase
    .from('permits')
    .select('id,permit_number,address,zone,units,valuation,is_rti,status,permit_type,permit_subtype,work_description,raw_data')
    .or(clauses.join(','))
    .limit(25);
  if (error || !Array.isArray(data) || !data.length) return null;

  const houseMatches = data
    .filter(row => permitMatchesSearch(row, searchValue))
    .map(permitRowAsHouseSite)
    .filter(site => isNewHouseSite(site));
  if (!houseMatches.length) return null;

  const missing = [...new Set(houseMatches.flatMap(site => newHousePermitDetail(site, {}).missing || []))];
  return {
    code: 'house_project_detail_unavailable',
    message: missing.length
      ? `The city permit feed has this address, but submitted project details are not available enough to underwrite yet. Missing: ${missing.join(', ')}.`
      : 'The city permit feed has this address, but it is not available as an underwritable site yet.',
  };
}

function numericFilterPass(value, min, max) {
  const n = Number(value || 0);
  const minValue = activeNumericParam(min);
  const maxValue = activeNumericParam(max);
  if (minValue !== null && n && n < minValue) return false;
  if (maxValue !== null && n && n > maxValue) return false;
  return true;
}

function activeNumericParam(value) {
  if (Array.isArray(value)) value = value[0];
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasActiveNumericParam(value) {
  return activeNumericParam(value) !== null;
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
  if (!sitePassesDataQualityGate(s, queryParams)) return false;
  if (!siteMatchesSearch(s, queryParams.q || queryParams.search)) return false;

  const typeList = listParam(queryParams.types || queryParams.type).map(canonicalProjectType).filter(Boolean);
  if (typeList.length && !typeList.includes(canonicalProjectType(s.type))) return false;
  if (queryParams.hood && s.hood !== queryParams.hood) return false;
  if (queryParams.zone && !zoneMatches(s.zone, queryParams.zone)) return false;

  const listings = listParam(queryParams.listing);
  if (listings.length && !listings.includes(listingCategory(s))) return false;

  const devStatuses = listParam(queryParams.devStatus);
  const devKey = developmentStatusKey(s);
  if (devStatuses.length && !(devStatuses.includes(devKey) || (devStatuses.includes('city_approved_not_started') && s.rti))) return false;

  if (queryParams.rti !== undefined && s.rti !== (queryParams.rti === 'true')) return false;
  if (queryParams.isComp !== undefined && s.isComp !== (queryParams.isComp === 'true')) return false;
  if (String(queryParams.ed1 || '').toLowerCase() === 'true' && !isEd1Project(s)) return false;
  const minUnits = activeNumericParam(queryParams.minUnits);
  const maxUnits = activeNumericParam(queryParams.maxUnits);
  if (minUnits !== null && Number(s.units || 0) < minUnits) return false;
  if (maxUnits !== null && Number(s.units || 0) > maxUnits) return false;
  const buildingSf = Number(s.buildingSf ?? s.totalBuildingSf ?? m.buildingSf ?? 0);
  const minSf = activeNumericParam(queryParams.minSf);
  const maxSf = activeNumericParam(queryParams.maxSf);
  const minLot = activeNumericParam(queryParams.minLot);
  const maxLot = activeNumericParam(queryParams.maxLot);
  if (minSf !== null && buildingSf < minSf) return false;
  if (maxSf !== null && buildingSf > maxSf) return false;
  if (minLot !== null && Number(s.lot || 0) < minLot) return false;
  if (maxLot !== null && Number(s.lot || 0) > maxLot) return false;

  const landBasis = Number(s.price ?? m.landCost ?? 0);
  if (!numericFilterPass(landBasis, queryParams.minPrice, queryParams.maxPrice)) return false;
  const minCost = activeNumericParam(queryParams.minCost);
  const maxCost = activeNumericParam(queryParams.maxCost);
  const minIRR = activeNumericParam(queryParams.minIRR);
  const minProfit = activeNumericParam(queryParams.minProfit);
  if (minCost !== null && Number(m.totalCost || 0) < minCost) return false;
  if (maxCost !== null && Number(m.totalCost || Infinity) > maxCost) return false;
  if (minIRR !== null && Number(m.leveragedIRR || 0) < minIRR) return false;
  if (minProfit !== null && Number(m.netProfit || 0) < minProfit) return false;
  const spreadPct = Math.abs(Number(m.devSpreadPct || 0)) <= 1 ? Number(m.devSpreadPct || 0) * 100 : Number(m.devSpreadPct || 0);
  const capOnCostPct = Math.abs(Number(m.capRateOnCost || 0)) <= 1 ? Number(m.capRateOnCost || 0) * 100 : Number(m.capRateOnCost || 0);
  const minSpread = activeNumericParam(queryParams.minSpread);
  const minCapoc = activeNumericParam(queryParams.minCapoc);
  if (minSpread !== null && spreadPct < minSpread) return false;
  if (minCapoc !== null && capOnCostPct < minCapoc) return false;
  return true;
}

async function runTimedSitePageQuery(query) {
  const controller = new AbortController();
  const queryTimer = setTimeout(() => controller.abort(), SITE_PAGE_QUERY_TIMEOUT_MS);
  try {
    return await query.abortSignal(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Dashboard site query exceeded ${SITE_PAGE_QUERY_TIMEOUT_MS / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(queryTimer);
  }
}

function isTransientSitePageError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return [
    'exceeded',
    'timeout',
    'timed out',
    'abort',
    'fetch failed',
    'connection',
    'temporarily unavailable',
    'gateway',
  ].some(fragment => message.includes(fragment));
}

async function fetchMergedDashboardTypePage(projectTypes, queryParams, requestedLimit, requestedOffset) {
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
  const ascending = sort === 'price-a';
  const rowsPerType = requestedOffset + requestedLimit;
  const results = await Promise.all(projectTypes.map(async projectType => {
    const result = await runTimedSitePageQuery(
      supabase
        .from('sites')
        .select(SITE_PREVIEW_SELECT)
        .eq('project_type', projectType)
        .in('status', ['active', 'off-market'])
        .not('net_profit', 'is', null)
        .order(sortColumn, { ascending, nullsFirst: false })
        .range(0, rowsPerType - 1)
    );
    if (result.error) throw result.error;
    return result.data || [];
  }));

  const rows = results.flat();
  rows.sort((a, b) => {
    const av = Number(a?.[sortColumn]);
    const bv = Number(b?.[sortColumn]);
    const aValid = Number.isFinite(av);
    const bValid = Number.isFinite(bv);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return ascending ? av - bv : bv - av;
  });

  const pageRows = rows.slice(requestedOffset, requestedOffset + requestedLimit);
  const hasMore = results.some(result => result.length === rowsPerType);
  const rollingTotal = requestedOffset + pageRows.length + (hasMore ? requestedLimit : 0);
  return {
    sites: pageRows.map((row, index) => mapSupabaseSite(row, index + requestedOffset, null)),
    total: hasMore ? rollingTotal : rows.length,
  };
}

async function fetchSupabaseSitePage(queryParams, requestedLimit, requestedOffset) {
  if (
    !process.env.SUPABASE_URL
  ) return null;

  const search = cleanSearchTerm(queryParams.q || queryParams.search);
  const hasExplicitTypeFilter = Boolean(queryParams.types || queryParams.type);
  const types = listParam(queryParams.types || queryParams.type).map(canonicalProjectType).filter(Boolean);
  const newHouseOnly = types.length === 1 && types[0] === 'New House';
  if (newHouseOnly && !search) return fetchNewHousePermitPage(queryParams, requestedLimit, requestedOffset);
  const excludesNewHouseInMixedView = types.includes('New House') && types.length > 1 && !search;
  const dbTypes = [...new Set((excludesNewHouseInMixedView ? types.filter(type => type !== 'New House') : types).flatMap(dbProjectTypeVariants))];
  const mayReturnNewHouse = (types.includes('New House') && !excludesNewHouseInMixedView) || (!types.length && search);
  const devStatuses = listParam(queryParams.devStatus);
  const canPushDevStatus = devStatuses.every(status => [
    'submitted',
    'plan_check',
    'city_approved_not_started',
    'permit_issued',
    'possibly_started_unknown',
  ].includes(status));
  const activeNumericFilters = [
    queryParams.minUnits,
    queryParams.maxUnits,
    queryParams.minLot,
    queryParams.maxLot,
    queryParams.minSf,
    queryParams.maxSf,
    queryParams.minPrice,
    queryParams.maxPrice,
    queryParams.minCost,
    queryParams.maxCost,
    queryParams.minProfit,
    queryParams.minIRR,
    queryParams.minSpread,
    queryParams.minCapoc,
  ].some(hasActiveNumericParam);
  const needsPostFilter = Boolean(
    search ||
    mayReturnNewHouse ||
    String(queryParams.ed1 || '').toLowerCase() === 'true' ||
    queryParams.hood ||
    (queryParams.devStatus && !canPushDevStatus) ||
    hasActiveNumericParam(queryParams.minPrice) ||
    hasActiveNumericParam(queryParams.maxPrice) ||
    hasActiveNumericParam(queryParams.minSf) ||
    hasActiveNumericParam(queryParams.maxSf)
  );
  const usesSelectiveFilters = !!(
    search ||
    queryParams.hood ||
    queryParams.listing ||
    queryParams.devStatus ||
    queryParams.ed1 ||
    queryParams.zone ||
    activeNumericFilters ||
    hasModelOverrideParams(queryParams)
  );
  const skipEstimatedCount = String(queryParams.fast || '') === '1';

  // PostgreSQL can use the dashboard index efficiently for one project type,
  // but a global ORDER BY across multiple IN values can select a slow plan on
  // the small Supabase instance. Fetch each canonical type concurrently and
  // merge the already-sorted candidates; this keeps global paging exact.
  const dashboardTypes = (excludesNewHouseInMixedView
    ? types.filter(typeName => typeName !== 'New House')
    : (!types.length && !search ? ['Multifamily', 'Mixed-Use', 'Condo/TH'] : types)
  ).filter(typeName => typeName !== 'New House');
  if (skipEstimatedCount && !needsPostFilter && dashboardTypes.length > 1) {
    return fetchMergedDashboardTypePage(
      [...new Set(dashboardTypes)],
      queryParams,
      requestedLimit,
      requestedOffset
    );
  }

  const selectColumns = skipEstimatedCount && !needsPostFilter
    ? SITE_PREVIEW_SELECT
    : (search && !queryParams.devStatus ? SITE_SEARCH_SELECT : SITE_LIST_SELECT);
  let query = supabase
    .from('sites')
    .select(selectColumns, usesSelectiveFilters || skipEstimatedCount ? undefined : { count: 'estimated' })
    .in('status', ['active', 'off-market'])
    .not('net_profit', 'is', null);

  if (dbTypes.length) query = query.in('project_type', dbTypes);
  if (!hasExplicitTypeFilter && !search) query = query.neq('project_type', 'New House');
  if (queryParams.zone) query = query.eq('zoning', queryParams.zone);
  const minUnits = activeNumericParam(queryParams.minUnits);
  const maxUnits = activeNumericParam(queryParams.maxUnits);
  const minCost = activeNumericParam(queryParams.minCost);
  const maxCost = activeNumericParam(queryParams.maxCost);
  const minProfit = activeNumericParam(queryParams.minProfit);
  const minIRR = activeNumericParam(queryParams.minIRR);
  const minSpread = activeNumericParam(queryParams.minSpread);
  const minCapoc = activeNumericParam(queryParams.minCapoc);
  if (minUnits !== null) query = query.gte('units', minUnits);
  if (maxUnits !== null) query = query.lte('units', maxUnits);
  if (minCost !== null) query = query.gte('total_cost', minCost);
  if (maxCost !== null) query = query.lte('total_cost', maxCost);
  if (minProfit !== null) query = query.gte('net_profit', minProfit);
  if (minIRR !== null) query = query.gte('irr_v', minIRR);
  if (minSpread !== null) query = query.gte('dev_spread_pct', minSpread);
  if (minCapoc !== null) query = query.gte('cap_on_cost', minCapoc);

  if (search) {
    const clauses = siteSearchDbClauses(queryParams.q || queryParams.search);
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

  if (devStatuses.length && canPushDevStatus) {
    const clauses = [];
    for (const status of devStatuses) {
      clauses.push(`raw_permit_data->>development_status.eq.${status}`);
      if (status === 'city_approved_not_started') clauses.push('rti.eq.true');
    }
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
  if (!search) {
    query = newHouseOnly
      ? query.order('id', { ascending: false, nullsFirst: false })
      : query.order(sortColumn, { ascending: sort === 'price-a', nullsFirst: false });
  }
  const dbOffset = needsPostFilter ? 0 : requestedOffset;
  const dbLimit = needsPostFilter
    ? (String(queryParams.ed1 || '').toLowerCase() === 'true'
      ? 5000
      : Math.min(newHouseOnly ? 1000 : 5000, Math.max(requestedOffset + requestedLimit * (newHouseOnly ? 50 : 20), requestedLimit)))
    : requestedLimit;
  query = query.range(dbOffset, dbOffset + dbLimit - 1);

  const queryResult = await runTimedSitePageQuery(query);
  const { data, error, count } = queryResult;
  if (error) throw error;
  const rows = data || [];
  let mapped = rows.map((row, i) => mapSupabaseSite(row, i + dbOffset, null));
  if (needsPostFilter) {
    const searchValue = queryParams.q || queryParams.search || '';
    const preQualitySearchMatches = searchValue
      ? mapped.filter(site => siteMatchesSearch(site, searchValue))
      : [];
    const matches = mapped.filter(site => sitePassesQueryFilters(site, queryParams));
    const page = matches.slice(requestedOffset, requestedOffset + requestedLimit);
    const hasMoreRawRows = rows.length === dbLimit;
    const total = hasMoreRawRows
      ? (matches.length ? Math.max(matches.length, requestedOffset + page.length + requestedLimit) : 0)
      : matches.length;
    let notice = searchValue && !matches.length && preQualitySearchMatches.some(site =>
      isNewHouseSite(site) && !hasUsableNewHousePlanData(site, site._m || {})
    )
      ? {
          code: 'house_project_detail_unavailable',
          message: 'The city permit feed has this address, but submitted project details are not available enough to underwrite yet. New-house rows only show when LADBS provides real floor area, work description, valuation, and units/stories.',
        }
      : null;
    if (!notice && searchValue && !matches.length) {
      notice = await permitDetailNoticeForSearch(searchValue);
    }
    return { sites: page, total, notice };
  }
  const rollingTotal = requestedOffset + rows.length + (rows.length === requestedLimit ? requestedLimit : 0);
  return { sites: mapped, total: skipEstimatedCount ? rollingTotal : (count ?? rollingTotal) };
}

async function fetchSupabaseSitePageWithRetry(queryParams, requestedLimit, requestedOffset) {
  try {
    return await fetchSupabaseSitePage(queryParams, requestedLimit, requestedOffset);
  } catch (error) {
    const fastRequest = String(queryParams.fast || '') === '1';
    if (!fastRequest || !isTransientSitePageError(error)) throw error;

    console.warn('[sites] Transient Supabase page failure; retrying once:', error.message);
    await new Promise(resolve => setTimeout(resolve, SITE_PAGE_RETRY_DELAY_MS));
    return fetchSupabaseSitePage(queryParams, requestedLimit, requestedOffset);
  }
}

router.get('/', validateSiteFilters, optionalAuth, async (req, res, next) => {
  try {
    const {
      type, hood, zone, rti, isComp,
      minUnits, maxUnits, minLot, maxLot,
      minSf, maxSf,
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
    let fastNotice = null;
    let fastPageError = null;
    let usedFastPage = false;

    if (process.env.SUPABASE_URL) {
      try {
        const fastPage = await fetchSupabaseSitePageWithRetry(req.query, requestedLimit, requestedOffset);
        if (fastPage) {
          sites = fastPage.sites;
          fastTotal = fastPage.total;
          fastNotice = fastPage.notice || null;
          usedFastPage = true;
          console.log(`[sites] Loaded fast page ${sites.length}/${fastTotal} from Supabase`);
        }
      } catch (e) {
        fastPageError = e;
        console.log('[sites] Fast Supabase page failed - falling back:', e.message);
      }
    }

    // The browser always requests a small paginated page with fast=1. Loading
    // every underwritten site after that query fails turns a short database
    // timeout into a 1-2 minute response. Fail quickly so the client can retry
    // while preserving the full-table fallback for maintenance/legacy callers.
    if (!usedFastPage && fastPageError && String(req.query.fast || '') === '1') {
      console.error('[sites] Fast page unavailable; refusing full-table fallback', {
        message: fastPageError.message,
        query: req.query,
      });
      return res.status(503).json({
        error: 'The site index is temporarily unavailable. Please retry.',
        retryable: true,
      });
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
    const fallbackFilters = {
      minUnits: activeNumericParam(minUnits),
      maxUnits: activeNumericParam(maxUnits),
      minLot: activeNumericParam(minLot),
      maxLot: activeNumericParam(maxLot),
      minSf: activeNumericParam(minSf),
      maxSf: activeNumericParam(maxSf),
      minPrice: activeNumericParam(minPrice),
      maxPrice: activeNumericParam(maxPrice),
      minCost: activeNumericParam(minCost),
      maxCost: activeNumericParam(maxCost),
      minIRR: activeNumericParam(minIRR),
      minProfit: activeNumericParam(minProfit),
      minSpread: activeNumericParam(minSpread),
      minCapoc: activeNumericParam(minCapoc),
    };

    // Filter
    let filtered = usedFastPage ? modelled : modelled.filter(s => {
      const m = s._m;
      if (!sitePassesDataQualityGate(s, req.query)) return false;
      if (!siteMatchesSearch(s, req.query.q || req.query.search)) return false;
      const typeList = listParam(req.query.types || type).map(canonicalProjectType).filter(Boolean);
      if (typeList.length && !typeList.includes(canonicalProjectType(s.type))) return false;
      if (hood    && s.hood  !== hood)               return false;
      if (zone    && !zoneMatches(s.zone, zone))     return false;
      const listings = listParam(req.query.listing);
      if (listings.length && !listings.includes(listingCategory(s))) return false;
      const devStatuses = listParam(req.query.devStatus);
      const devKey = developmentStatusKey(s);
      if (devStatuses.length && !(devStatuses.includes(devKey) || (devStatuses.includes('city_approved_not_started') && s.rti))) return false;
      if (rti     !== undefined && s.rti !== (rti === 'true'))  return false;
      if (isComp  !== undefined && s.isComp !== (isComp === 'true')) return false;
      if (String(req.query.ed1 || '').toLowerCase() === 'true' && !isEd1Project(s)) return false;
      if (fallbackFilters.minUnits !== null && s.units < fallbackFilters.minUnits) return false;
      if (fallbackFilters.maxUnits !== null && s.units > fallbackFilters.maxUnits) return false;
      const buildingSf = Number(s.buildingSf ?? s.totalBuildingSf ?? m.buildingSf ?? 0);
      if (fallbackFilters.minSf !== null && buildingSf < fallbackFilters.minSf) return false;
      if (fallbackFilters.maxSf !== null && buildingSf > fallbackFilters.maxSf) return false;
      if (fallbackFilters.minLot !== null && s.lot < fallbackFilters.minLot) return false;
      if (fallbackFilters.maxLot !== null && s.lot > fallbackFilters.maxLot) return false;
      const landBasis = Number(s.price ?? m.landCost ?? 0);
      if (fallbackFilters.minPrice !== null && landBasis && landBasis < fallbackFilters.minPrice) return false;
      if (fallbackFilters.maxPrice !== null && landBasis && landBasis > fallbackFilters.maxPrice) return false;
      if (fallbackFilters.minCost !== null && (m.totalCost ?? 0) < fallbackFilters.minCost) return false;
      if (fallbackFilters.maxCost !== null && (m.totalCost ?? Infinity) > fallbackFilters.maxCost) return false;
      if (fallbackFilters.minIRR !== null && m.leveragedIRR < fallbackFilters.minIRR) return false;
      if (fallbackFilters.minProfit !== null && m.netProfit < fallbackFilters.minProfit) return false;
      if (fallbackFilters.minSpread !== null && m.devSpreadPct < fallbackFilters.minSpread) return false;
      if (fallbackFilters.minCapoc !== null && m.capRateOnCost < fallbackFilters.minCapoc) return false;
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
      notice:  fastNotice,
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
        buildingSf:   s.buildingSf ?? s._m.buildingSf,
        buildingSfSource: s.buildingSfSource ?? s._m.buildingSfSource,
        buildingSfParsed: s.buildingSfParsed ?? s._m.buildingSfParsed,
        permitValuation: s.permitValuation ?? s._m.permitValuation ?? null,
        lotSfSource:  s.lotSfSource ?? s._m.lotSfSource,
        exitValueSource: s.exitValueSource ?? s._m.exitValueSource,
        exitValueMetric: s.exitValueMetric ?? s._m.exitValueMetric,
        exitValueMetricValue: s.exitValueMetricValue ?? s._m.exitValueMetricValue,
        exitValueBasisQuantity: s.exitValueBasisQuantity ?? s._m.exitValueBasisQuantity,
        needsLandComp: s.needsLandComp ?? s._m.needsLandComp ?? false,
        landBasisReliable: s.landBasisReliable ?? s._m.landBasisReliable ?? true,
        rti:          s.rti,
        permitStatus: s.permitStatus,
        developmentStatus: s.developmentStatus,
        inspectionCheck: s.inspectionCheck,
        permitNumber:  s.permitNumber,
        workDescription: s.workDescription,
        projectDetailStatus: s.projectDetailStatus,
        projectDetailUnavailableReason: s.projectDetailUnavailableReason,
        stories:      s.stories,
        contractorName: s.contractorName,
        contractorAddress: s.contractorAddress,
        contractorCity: s.contractorCity,
        contractorState: s.contractorState,
        applicantName: s.applicantName,
        applicantBusinessName: s.applicantBusinessName,
        addressAliases: s.addressAliases || [],
        hasPlanningDocuments: s.hasPlanningDocuments ?? (s.planningDocuments || []).length > 0,
        planningCases: s.planningCases || [],
        planningDocuments: s.planningDocuments || planningDocumentsForSite({
          address: s.addr ?? s.address,
          raw_permit_data: { address_aliases: s.addressAliases || [] },
        }),
        planningDiscovery: s.planningDiscovery || null,
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
        askPrice:     (s.needsLandComp || s._m.needsLandComp) ? null : (s.price ?? s.askPrice ?? s._m.price ?? null),
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
        landCost:     (s.needsLandComp || s._m.needsLandComp) ? null : (s._m.landCost ?? s._m.price ?? s.price ?? s.askPrice ?? null),
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
        site = await attachPlanningDiscovery(site, data.id);
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

export { parsePdisProfile, pdisDocumentRow };
export default router;
