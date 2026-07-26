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
import { enrichSite }    from '../../src/data/laOpenData.js';
import { scoreSiteDemand, SUBMARKET_CENSUS_ESTIMATES } from '../../src/scoring/DemandScore.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
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
const AFFORDABLE_TEXT = /(affordable|income[- ]restricted|income restricted|low income|very low|extremely low|moderate income|\bed1\b|executive directive 1|100%\s*affordable|vhca|hca|density bonus)/i;
const DEFAULT_MARKET_LAND_PER_DOOR = 100000;
const DEFAULT_AFFORDABLE_LAND_PER_DOOR = 30000;

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
  if (addr.includes('WEST ADAMS')) return 'West Adams';
  if (addr.includes('BOYLE')) return 'Boyle Heights';
  if (addr.includes('MID-WILSHIRE') || addr.includes('WILSHIRE')) return 'Mid-Wilshire';
  // Guess by zip or street
  return 'Koreatown';  // default fallback
}

function permitProgramText(raw = {}, site = {}) {
  return [
    raw.housing_program,
    raw.affordability,
    raw.work_description,
    raw.project_description,
    raw.use_desc,
    raw.permit_status,
    raw.status,
    raw.permit_number,
    site.address,
    site.addr,
    ...(Array.isArray(raw.address_aliases) ? raw.address_aliases : []),
  ].map(v => String(v || '')).join(' ');
}

function rawAffordable(raw = {}, site = {}) {
  if (raw.is_affordable === true || raw.income_restricted === true) return true;
  if (String(raw.is_affordable).toLowerCase() === 'true' || String(raw.income_restricted).toLowerCase() === 'true') return true;
  return AFFORDABLE_TEXT.test(permitProgramText(raw, site));
}

function housingProgramFromRaw(raw = {}, site = {}) {
  const text = permitProgramText(raw, site);
  if (!rawAffordable(raw, site)) return null;
  if (/\bed1\b|executive directive 1/i.test(text)) return 'Affordable / ED1';
  return 'Affordable';
}

function perDoorLandBasis(type, units, affordable) {
  if (!['Multifamily', 'Mixed-Use'].includes(type) || !Number(units || 0)) return null;
  const perDoor = affordable ? DEFAULT_AFFORDABLE_LAND_PER_DOOR : DEFAULT_MARKET_LAND_PER_DOOR;
  return {
    value: Math.round(perDoor * Number(units || 0)),
    source: affordable ? 'default_affordable_per_door' : 'default_market_per_door',
    metricLabel: 'price per door',
    metricValue: perDoor,
    basisQuantity: Number(units || 0),
    compCount: 0,
    matchLabel: affordable ? 'Affordable / ED1 default' : 'market-rate default',
    recencyDays: LAND_COMP_RECENCY_DAYS,
    comps: [],
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
  const affordable = rawAffordable(rawPermit, s);
  const housingProgram = housingProgramFromRaw(rawPermit, s);
  const doorLand = offMarket ? perDoorLandBasis(type, units, affordable) : null;
  const compLand = offMarket ? estimateLandBasisFromComps({
    neighborhood: s.neighborhood ?? s.hood,
    project_type: type,
    units,
    avg_unit_sf: avgUnitSf,
    lot_sf: s.lot_sf ?? s.lot,
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
  const noi = s.noi || 0;
  const netProfit = usedDynamicLand && exitValue ? exitValue - recastTotalCost : (s.net_profit || 0);

  return {
    isAffordable: affordable,
    housingProgram,
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
  const isAffordable = rawAffordable(rawPermit, s);
  const housingProgram = housingProgramFromRaw(rawPermit, s);
  const model = modelFromSupabaseSite(s, landCompBenchmarks);
  return {
    id:           s.id || (50000 + i),
    addr:         s.address ?? s.addr,
    hood:         s.neighborhood ?? s.hood ?? 'Koreatown',
    type:         s.project_type ?? s.type ?? 'Multifamily',
    zone:         s.zoning ?? s.zone ?? 'R3',
    lot:          s.lot_sf ?? s.lot ?? 5000,
    units:        s.units ?? 4,
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
    isAffordable,
    housingProgram,
    addressAliases,
    underwrittenAt: s.underwritten_at,
    _precomputed: true,
    _m: model,
    ms: 0.25, mo: 0.50, mt: 0.20, mth: 0.05,
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
        isAffordable: s.isAffordable ?? baseModel.isAffordable ?? false,
        housingProgram: s.housingProgram ?? baseModel.housingProgram ?? null,
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
  return haystack.includes(term) || searchVariants(value).some(v => haystack.includes(v.toUpperCase()));
}

async function fetchSupabaseSitePage(queryParams, requestedLimit, requestedOffset) {
  if (!process.env.SUPABASE_URL || queryParams.devStatus || queryParams.affordable || hasModelOverrideParams(queryParams)) return null;

  let query = supabase
    .from('sites')
    .select('*', { count: 'exact' })
    .in('status', ['active', 'off-market'])
    .not('net_profit', 'is', null);

  const types = listParam(queryParams.types || queryParams.type);
  if (types.length) query = query.in('project_type', types);
  if (queryParams.hood) query = query.eq('neighborhood', queryParams.hood);
  if (queryParams.zone) query = query.eq('zoning', queryParams.zone);
  if (queryParams.minUnits) query = query.gte('units', Number(queryParams.minUnits));
  if (queryParams.maxUnits) query = query.lte('units', Number(queryParams.maxUnits));
  if (queryParams.minPrice) query = query.gte('price', Number(queryParams.minPrice));
  if (queryParams.maxPrice) query = query.lte('price', Number(queryParams.maxPrice));
  if (queryParams.minCost) query = query.gte('total_cost', Number(queryParams.minCost));
  if (queryParams.maxCost) query = query.lte('total_cost', Number(queryParams.maxCost));
  if (queryParams.minProfit) query = query.gte('net_profit', Number(queryParams.minProfit));
  if (queryParams.minIRR) query = query.gte('irr_v', Number(queryParams.minIRR));
  if (queryParams.minSpread) query = query.gte('dev_spread_pct', Number(queryParams.minSpread));
  if (queryParams.minCapoc) query = query.gte('cap_on_cost', Number(queryParams.minCapoc));

  const search = cleanSearchTerm(queryParams.q || queryParams.search);
  if (search) {
    const clauses = [];
    for (const variant of searchVariants(search)) {
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
  query = query.order(sortColumn, { ascending: sort === 'price-a', nullsFirst: false });
  query = query.range(requestedOffset, requestedOffset + requestedLimit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  const landCompBenchmarks = await getLandCompBenchmarks();
  return { sites: (data || []).map((row, i) => mapSupabaseSite(row, i, landCompBenchmarks)), total: count ?? (data || []).length };
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
          const landCompBenchmarks = await getLandCompBenchmarks();
          sites = sbSites.map((row, i) => mapSupabaseSite(row, i, landCompBenchmarks));
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
      if (type    && s.type  !== type)               return false;
      if (hood    && s.hood  !== hood)               return false;
      if (zone    && s.zone  !== zone)               return false;
      if (req.query.affordable === 'true' && !s.isAffordable) return false;
      if (rti     !== undefined && s.rti !== (rti === 'true'))  return false;
      if (isComp  !== undefined && s.isComp !== (isComp === 'true')) return false;
      if (minUnits && s.units < +minUnits)            return false;
      if (maxUnits && s.units > +maxUnits)            return false;
      if (minLot  && s.lot   < +minLot)              return false;
      if (maxLot  && s.lot   > +maxLot)              return false;
      if (minPrice && !s.isComp && (s.price ?? 0) < +minPrice) return false;
      if (maxPrice && !s.isComp && (s.price ?? Infinity) > +maxPrice) return false;
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

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json({
      total,
      limit:   +limit,
      offset:  +offset,
      results: paginated.map(s => ({
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
        isAffordable: s.isAffordable ?? s._m.isAffordable ?? false,
        housingProgram: s.housingProgram ?? s._m.housingProgram ?? null,
        addressAliases: s.addressAliases || [],
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
      })),
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

    res.json({ site, model, scenarios, isSaved, userOverrides });
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
