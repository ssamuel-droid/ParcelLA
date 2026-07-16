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

const router = Router();

// Cache computed model results (refreshed every 5 min)
let _siteCache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  if (query.sc)       ov.sc       = +query.sc;
  if (query.ppu)      ov.ppu      = +query.ppu;
  if (query.psf)      ov.psf      = +query.psf;
  if (query.method)   ov.method   = query.method;
  return ov;
}

function modelFromSupabaseSite(s) {
  const totalCost = s.total_cost || 0;
  const price = s.price || 0;
  const interestCarryPct = 0.65 * 0.065 * 1.5; // 65% LTC, 6.5%, 18 months
  const preCarryCost = totalCost > 0 ? totalCost / (1 + interestCarryPct) : 0;
  const verticalBudget = Math.max(0, preCarryCost - price);
  const hardFallback = verticalBudget / 1.18; // soft costs assumed at 18% of hard costs
  const softFallback = hardFallback * 0.18;
  const carryFallback = Math.max(0, totalCost - preCarryCost);
  const hardCosts = s.hard_costs ?? s.hardCosts ?? hardFallback;
  const softCosts = s.soft_costs ?? s.softCosts ?? softFallback;
  const carryCost = s.carry_cost ?? s.carryCost ?? carryFallback;

  return {
    noi:           s.noi          || 0,
    totalCost,
    exitValue:     s.exit_value   || 0,
    exitProceeds:  s.net_profit   || 0,
    netProfit:     s.net_profit   || 0,
    leveragedIRR:  s.irr_v        || 0,
    capRateOnCost: (s.cap_on_cost   || 0) / 100,
    devSpreadPct:  (s.dev_spread_pct || 0) / 100,
    marketCapRate: 0.0500,
    price,
    hardCosts,
    softCosts,
    carryCost,
    loanAmount:    totalCost * 0.65,
    equity:        totalCost * 0.35,
    equityMultiple: totalCost > 0 ? ((s.exit_value || 0) / (totalCost * 0.35)) : 0,
  };
}

function mapSupabaseSite(s, i = 0) {
  const rawPermit = s.raw_permit_data || {};
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
    forSale:      true,
    isComp:       s.is_comp ?? false,
    price:        s.price ?? null,
    demo:         s.has_demo ?? false,
    lat:          s.lat,
    lng:          s.lng,
    permitSourceId: s.permit_source_id,
    permitStatus: rawPermit.permit_status || rawPermit.status || null,
    developmentStatus: rawPermit.development_status || null,
    underwrittenAt: s.underwritten_at,
    _precomputed: true,
    _m: modelFromSupabaseSite(s),
    ms: 0.25, mo: 0.50, mt: 0.20, mth: 0.05,
  };
}

// ── GET /api/sites ─────────────────────────────────────────────────────────────
router.get('/', validateSiteFilters, optionalAuth, async (req, res, next) => {
  try {
    const {
      type, hood, zone, rti, isComp,
      minUnits, maxUnits, minLot, maxLot,
      minPrice, maxPrice,
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

    if (process.env.SUPABASE_URL) {
      try {
        // Load pre-underwritten sites from Supabase (populated by GitHub Action)
        const { data: sbSites, error: sbErr } = await supabase
          .from('sites')
          .select('*')
          .eq('status', 'active')
          .not('net_profit', 'is', null)  // only pre-underwritten sites
          .limit(Math.min(Math.max(requestedLimit + requestedOffset, 2000), 10000))
          .order('irr_v', { ascending: false });

        if (!sbErr && sbSites?.length > 0) {
          sites = sbSites.map(mapSupabaseSite);
          console.log(`[sites] Loaded ${sites.length} pre-underwritten sites from Supabase`);
        } else {
          console.log('[sites] No pre-underwritten sites found — using mock sites');
          sites = [...SITES];
        }
      } catch (e) {
        console.log('[sites] Supabase failed — using mock sites:', e.message);
        sites = [...SITES];
      }
    }

    // Re-run the current model for dashboard rows so valuation, income statement,
    // and user hard-cost overrides are consistent with the latest app logic.
    const modelled = sites.map(s => ({
      ...s,
      _m: runModel(normalizeSite(s), overrides),
    }));

    // Filter
    let filtered = modelled.filter(s => {
      const m = s._m;
      if (type    && s.type  !== type)               return false;
      if (hood    && s.hood  !== hood)               return false;
      if (zone    && s.zone  !== zone)               return false;
      if (rti     !== undefined && s.rti !== (rti === 'true'))  return false;
      if (isComp  !== undefined && s.isComp !== (isComp === 'true')) return false;
      if (minUnits && s.units < +minUnits)            return false;
      if (maxUnits && s.units > +maxUnits)            return false;
      if (minLot  && s.lot   < +minLot)              return false;
      if (maxLot  && s.lot   > +maxLot)              return false;
      if (minPrice && !s.isComp && (s.price ?? 0) < +minPrice) return false;
      if (maxPrice && !s.isComp && (s.price ?? Infinity) > +maxPrice) return false;
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
    if (SORTS[sort]) filtered.sort(SORTS[sort]);

    const total = filtered.length;
    const paginated = filtered.slice(requestedOffset, requestedOffset + requestedLimit);

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
        landCost:     s._m.price ?? s.price ?? s.askPrice ?? null,
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
