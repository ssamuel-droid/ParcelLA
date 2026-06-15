/**
 * ParceLLA — Model Router
 * POST /api/model/:id           — run model with custom overrides
 * POST /api/model/:id/scenarios — bear/base/bull scenarios
 * POST /api/model/:id/waterfall — equity waterfall with preset
 * PUT  /api/model/:id/overrides — save user's overrides (auth required)
 * GET  /api/model/:id/overrides — get user's saved overrides (auth required)
 */

import { Router } from 'express';
import { SITES }  from '../src/data/sites.js';
import { runModel, runScenarios } from '../src/model/financialModel.js';
import { runWaterfall, compareWaterfalls, WATERFALL_PRESETS } from '../src/waterfall/Waterfall.js';
import { requireAuth } from './middleware/auth.js';
import { validateModelOverrides, modelLimiter } from './middleware/middleware.js';
import { supabase } from '../src/data/supabase.js';

const router = Router();

// ── POST /api/model/:id ────────────────────────────────────────────────────────
router.post('/:id', modelLimiter, validateModelOverrides, async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const overrides = req.body.overrides ?? {};
    const model     = runModel(site, overrides);

    res.json({ siteId: site.id, addr: site.addr, model });
  } catch (err) { next(err); }
});

// ── POST /api/model/:id/scenarios ─────────────────────────────────────────────
router.post('/:id/scenarios', modelLimiter, async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const overrides  = req.body.overrides ?? {};
    const scenarios  = runScenarios(site, overrides);

    // Additional stress tests
    const stressTests = {
      rentShock:    runModel(site, { ...overrides, rentMultiplier: 0.80, exitCapDelta: 0.005 }),
      costOverrun:  runModel(site, { ...overrides, hcpsf: (overrides.hcpsf ?? 285) * 1.15 }),
      capExpansion: runModel(site, { ...overrides, exitCapDelta: 0.0075 }),
      rateSpike:    runModel(site, { ...overrides, rate: 0.085, months: 24 }),
    };

    res.json({ siteId: site.id, scenarios, stressTests });
  } catch (err) { next(err); }
});

// ── POST /api/model/:id/waterfall ─────────────────────────────────────────────
router.post('/:id/waterfall', modelLimiter, async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { overrides = {}, preset = 'institutional', compare = false } = req.body;
    const model = runModel(site, overrides);

    let result;
    if (compare) {
      result = compareWaterfalls(model);
    } else {
      if (!WATERFALL_PRESETS[preset]) {
        return res.status(400).json({
          error: `Unknown preset: ${preset}`,
          available: Object.keys(WATERFALL_PRESETS),
        });
      }
      result = runWaterfall(model, preset, req.body.options ?? {});
    }

    res.json({ siteId: site.id, waterfall: result });
  } catch (err) { next(err); }
});

// ── PUT /api/model/:id/overrides ──────────────────────────────────────────────
router.put('/:id/overrides', requireAuth, validateModelOverrides, async (req, res, next) => {
  try {
    const { overrides = {} } = req.body;
    const siteId = +req.params.id;

    const { error } = await supabase
      .from('model_overrides')
      .upsert({
        user_id:    req.user.id,
        site_id:    siteId,
        overrides,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;

    // Return recalculated model with saved overrides
    const site  = SITES.find(s => s.id === siteId);
    const model = site ? runModel(site, overrides) : null;

    res.json({ saved: true, siteId, overrides, model });
  } catch (err) { next(err); }
});

// ── GET /api/model/:id/overrides ──────────────────────────────────────────────
router.get('/:id/overrides', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('model_overrides')
      .select('overrides, updated_at')
      .match({ user_id: req.user.id, site_id: +req.params.id })
      .maybeSingle();

    if (error) throw error;
    res.json({ overrides: data?.overrides ?? {}, updatedAt: data?.updated_at ?? null });
  } catch (err) { next(err); }
});

// ── GET /api/model/waterfall/presets ──────────────────────────────────────────
router.get('/waterfall/presets', (req, res) => {
  res.json(
    Object.entries(WATERFALL_PRESETS).map(([key, val]) => ({
      key,
      name: val.name,
      prefReturn: val.prefReturn,
      tierCount:  val.tiers.length,
    }))
  );
});

export default router;
