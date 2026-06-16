/**
 * ParceLLA — PDF Router
 * POST /api/pdf/:id  — generate deal memo PDF
 */
import { Router } from 'express';
import { SITES }  from '../../src/data/sites.js';
import { runModel } from '../../src/model/financialModel.js';
import { pdfLimiter } from '../middleware/middleware.js';

const pdfRouter = Router();

pdfRouter.post('/:id', pdfLimiter, async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const overrides = req.body.overrides ?? {};
    const model     = runModel(site, overrides);

    // Merge site + model into a flat object for the template
    const memo = {
      ...site,
      ...model,
      addr:  site.addr,
      hood:  site.hood,
      type:  site.type,
      zone:  site.zone,
      lot:   site.lot,
      units: site.units,
      usf:   site.usf,
      demo:  site.demo,
      rti:   site.rti,
      isComp: site.isComp,
      askPrice: site.price,
    };

    const { generateDealMemo } = await import('../../src/pdf/DealMemo.js');
    const pdf = await generateDealMemo(memo);

    const filename = `ParceLLA_${site.addr.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}.pdf`;
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':       pdf.length,
    });
    res.send(pdf);
  } catch (err) { next(err); }
});

export { pdfRouter };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ParceLLA — Auth Router
 * POST /api/auth/signup
 * POST /api/auth/signin
 * POST /api/auth/signout
 * GET  /api/auth/me
 */
import { createClient } from '@supabase/supabase-js';

const authRouter = Router();

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

authRouter.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { name } },
    });

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({
      user:    data.user,
      session: data.session,
      message: 'Check your email to confirm your account',
    });
  } catch (err) { next(err); }
});

authRouter.post('/signin', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    res.json({ user: data.user, session: data.session });
  } catch (err) { next(err); }
});

authRouter.post('/signout', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7);
    if (token) {
      const sb = getSupabase();
      await sb.auth.signOut();
    }
    res.json({ message: 'Signed out' });
  } catch (err) { next(err); }
});

authRouter.get('/me', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

    // Get profile
    const { data: profile } = await sb
      .from('profiles').select('*').eq('id', user.id).maybeSingle();

    // Get saved site ids
    const { data: saved } = await sb
      .from('saved_sites').select('site_id').eq('user_id', user.id);

    res.json({
      user,
      profile,
      savedSiteIds: saved?.map(s => s.site_id) ?? [],
    });
  } catch (err) { next(err); }
});

export { authRouter };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ParceLLA — Alerts Router
 * GET    /api/alerts        — list user's alerts
 * POST   /api/alerts        — create alert
 * DELETE /api/alerts/:id    — delete alert
 */
import { requireAuth } from '../middleware/auth.js';

const alertsRouter = Router();

alertsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('alerts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (err) { next(err); }
});

alertsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, filters, frequency = 'daily' } = req.body;
    if (!name) return res.status(400).json({ error: 'Alert name required' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('alerts')
      .insert({ user_id: req.user.id, name, filters: filters ?? {}, frequency })
      .select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

alertsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { error } = await sb
      .from('alerts')
      .update({ active: false })
      .match({ id: +req.params.id, user_id: req.user.id });

    if (error) throw error;
    res.json({ deleted: true, id: +req.params.id });
  } catch (err) { next(err); }
});

export { alertsRouter };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ParceLLA — Submarkets Router
 * GET /api/submarkets       — cap rates + rent comps
 * GET /api/submarkets/:hood — single submarket detail
 */
const submarketRouter = Router();

submarketRouter.get('/', async (req, res, next) => {
  try {
    const { RENTS, CAP_RATES, MAP_COORDS } = await import('../../src/data/submarkets.js');
    const { RENT_GROWTH_3YR, SUBMARKET_CENSUS_ESTIMATES } = await import('../../src/scoring/DemandScore.js');

    const result = Object.keys(RENTS).map(hood => ({
      hood,
      entryCap:     CAP_RATES[hood],
      exitCap:      +(CAP_RATES[hood] + 0.0025).toFixed(4),
      rents:        RENTS[hood],
      coords:       MAP_COORDS[hood],
      rentGrowth3yr: RENT_GROWTH_3YR[hood],
      demographics: SUBMARKET_CENSUS_ESTIMATES[hood],
    }));

    res.json(result);
  } catch (err) { next(err); }
});

submarketRouter.get('/:hood', async (req, res, next) => {
  try {
    const hood = decodeURIComponent(req.params.hood);
    const { RENTS, CAP_RATES, MAP_COORDS } = await import('../../src/data/submarkets.js');
    const { SUBMARKET_CENSUS_ESTIMATES } = await import('../../src/scoring/DemandScore.js');

    if (!RENTS[hood]) return res.status(404).json({ error: `Submarket not found: ${hood}` });

    res.json({
      hood,
      entryCap:     CAP_RATES[hood],
      exitCap:      +(CAP_RATES[hood] + 0.0025).toFixed(4),
      rents:        RENTS[hood],
      coords:       MAP_COORDS[hood],
      demographics: SUBMARKET_CENSUS_ESTIMATES[hood],
    });
  } catch (err) { next(err); }
});

export { submarketRouter };
