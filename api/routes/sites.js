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
  if (query.hcpsf)    ov.hcpsf    = +query.hcpsf;
  if (query.sc)       ov.sc       = +query.sc;
  if (query.ppu)      ov.ppu      = +query.ppu;
  if (query.psf)      ov.psf      = +query.psf;
  if (query.method)   ov.method   = query.method;
  return ov;
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

    // Pull from Supabase in production — fall back to in-memory for dev
    let sites = SITES;
    // Try Supabase first, fall back to mock data if empty
    if (process.env.SUPABASE_URL) {
      try {
        const { data, error } = await supabase.from('sites').select('*').eq('status', 'active');
        if (!error && data?.length > 0) {
          // Normalize Supabase column names to match model expectations
          sites = data.map(s => ({
            ...s,
            hood:   s.neighborhood ?? s.hood,
            usf:    s.avg_unit_sf  ?? s.usf ?? 800,
            demo:   s.has_demo     ?? s.demo ?? false,
            price:  s.price        ?? null,
            ms:     s.unit_mix?.studio ?? 0.25,
            mo:     s.unit_mix?.one    ?? 0.50,
            mt:     s.unit_mix?.two    ?? 0.20,
            mth:    s.unit_mix?.three  ?? 0.05,
          }));
          console.log(`[sites] Loaded ${sites.length} sites from Supabase`);
        } else {
          console.log('[sites] Supabase empty or error — using mock data');
        }
      } catch (e) {
        console.log('[sites] Supabase failed — using mock data:', e.message);
      }
    }

    // Run pre-underwriting on every site
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
      if (minProfit && m.exitProceeds < +minProfit)      return false;
      if (minSpread && m.devSpreadPct < +minSpread)   return false;
      if (minCapoc  && m.capRateOnCost < +minCapoc)       return false;
      return true;
    });

    // Sort
    const SORTS = {
      profit:   (a,b) => b._m.exitProceeds   - a._m.exitProceeds,
      irr:      (a,b) => b._m.leveragedIRR        - a._m.leveragedIRR,
      spread:   (a,b) => b._m.devSpreadPct - a._m.devSpreadPct,
      capoc:    (a,b) => b._m.capRateOnCost   - a._m.capRateOnCost,
      'price-a':(a,b) => (a.price??a._m.landCost) - (b.price??b._m.landCost),
      'price-d':(a,b) => (b.price??b._m.landCost) - (a.price??a._m.landCost),
      units:    (a,b) => b.units - a.units,
    };
    if (SORTS[sort]) filtered.sort(SORTS[sort]);

    const total = filtered.length;
    const paginated = filtered.slice(+offset, +offset + +limit);

    res.json({
      total,
      limit:   +limit,
      offset:  +offset,
      results: paginated.map(s => ({
        id:           s.id,
        addr:         s.addr,
        hood:         s.hood,
        type:         s.type,
        zone:         s.zone,
        lot:          s.lot,
        units:        s.units,
        usf:          s.usf,
        rti:          s.rti,
        isComp:       s.isComp,
        askPrice:     s.price,
        // Pre-underwritten metrics
        totalCost:    s._m.totalCost,
        noi:          s._m.noi,
        exitValue:    s._m.exitValue,
        netProfit:    s._m.exitProceeds,
        irrV:         s._m.leveragedIRR,
        capOnCost:    Math.round(s._m.capRateOnCost * 10000) / 100,
        devSpreadPct: s._m.devSpreadPct,
        landCost:     s._m.price ?? s.price,
        noi:          s._m.noi,
        entryCap:     s._m.marketCapRate,
        exitCap:      s._m.marketCapRate + 0.0025,
        coc:          s._m.cocReturn,
        eqMult:       s._m.equityMultiple,
        coc:          s._m.coc,
        eqMult:       s._m.eqMult,
        entryCap:     s._m.entryCap,
        exitCap:      s._m.exitCap,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id ─────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = +req.params.id;
    const site = SITES.find(s => s.id === id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const overrides = buildOverrides(req.query);
    const model     = runModel(normalizeSite(site), overrides);
    const scenarios = runScenarios(normalizeSite(site), overrides);

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
