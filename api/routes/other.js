/**
 * ParceLLA — PDF Router
 * POST /api/pdf/:id  — generate deal memo PDF
 */
import { Router } from 'express';
import { SITES, normalizeSite } from '../../src/data/sites.js';
import { runModel } from '../../src/model/financialModel.js';
import { pdfLimiter } from '../middleware/middleware.js';

const pdfRouter = Router();

pdfRouter.post('/:id', pdfLimiter, async (req, res, next) => {
  try {
    const site = SITES.find(s => s.id === +req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const overrides = req.body.overrides ?? {};
    const model     = runModel(normalizeSite(site), overrides);

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
import { ensureUserProfile, accessForProfile, getUnlockedSiteIdsFast } from '../middleware/auth.js';

const authRouter = Router();

const CURRENT_TERMS_VERSION = '2026-09-03';
const CURRENT_TERMS_DIGEST = '1ea1c5127923b6e191d03fa9d7db554f85616e05621a7a06d64e4765c16e5bb0';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

authRouter.get('/config', (req, res) => {
  const googleProviderReady = process.env.GOOGLE_AUTH_ENABLED !== 'false';
  const termsEnforcementEnabled = process.env.TERMS_ENFORCEMENT_ENABLED === 'true';
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    googleEnabled: googleProviderReady,
    googleProviderReady,
    freeAccessHours: 0,
    propertyPrice: 10,
    introPrice: 49,
    checkoutTrialDays: 0,
    termsVersion: CURRENT_TERMS_VERSION,
    termsUrl: '/terms.html',
    underwritingAcknowledgmentRequired: true,
    termsEnforcementEnabled,
  });
});

authRouter.post('/signup', async (req, res, next) => {
  try {
    const {
      email,
      password,
      name,
      termsVersion,
      underwritingProjectionAcknowledged,
      independentVerificationAcknowledged,
    } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (
      termsVersion !== CURRENT_TERMS_VERSION ||
      underwritingProjectionAcknowledged !== true ||
      independentVerificationAcknowledged !== true
    ) {
      return res.status(400).json({ error: 'Current Terms and underwriting-risk acknowledgments are required' });
    }

    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: {
        data: {
          name,
          terms_version: CURRENT_TERMS_VERSION,
          underwriting_projection_acknowledged: true,
          independent_verification_acknowledged: true,
        },
      },
    });

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({
      user:    data.user,
      session: data.session,
      message: 'Check your email to confirm your account',
    });
  } catch (err) { next(err); }
});

authRouter.post('/terms/accept', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const {
      termsVersion,
      underwritingProjectionAcknowledged,
      independentVerificationAcknowledged,
    } = req.body || {};

    if (
      termsVersion !== CURRENT_TERMS_VERSION ||
      underwritingProjectionAcknowledged !== true ||
      independentVerificationAcknowledged !== true
    ) {
      return res.status(400).json({ error: 'Current Terms and both risk acknowledgments are required' });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error: userError } = await sb.auth.getUser(token);
    if (userError || !user) return res.status(401).json({ error: 'Invalid token' });

    await ensureUserProfile(user);
    const { data, error } = await sb
      .from('terms_acceptances')
      .upsert({
        user_id: user.id,
        terms_version: CURRENT_TERMS_VERSION,
        terms_digest: CURRENT_TERMS_DIGEST,
        underwriting_projection_acknowledged: true,
        independent_verification_acknowledged: true,
        acceptance_method: 'registration_clickwrap',
        user_agent: String(req.get('user-agent') || '').slice(0, 500) || null,
        accepted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,terms_version' })
      .select('terms_version,accepted_at')
      .single();

    if (error) throw error;
    res.json({ accepted: true, termsVersion: data.terms_version, acceptedAt: data.accepted_at });
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

    let profile = null;
    let access = null;
    try {
      profile = await ensureUserProfile(user);
      access = accessForProfile(profile);
    } catch (profileErr) {
      access = accessForProfile({ email: user.email });
      if (!access.active) throw profileErr;
      profile = {
        id: user.id,
        email: user.email,
        plan: access.plan,
        subscription_status: access.subscriptionStatus,
      };
    }

    // Get saved site ids
    const { data: saved } = await sb
      .from('saved_sites').select('site_id').eq('user_id', user.id);

    const unlockedSiteIds = await getUnlockedSiteIdsFast(user.id);

    let termsAcceptance = null;
    const { data: acceptedTerms, error: termsError } = await sb
      .from('terms_acceptances')
      .select('terms_version,accepted_at')
      .eq('user_id', user.id)
      .eq('terms_version', CURRENT_TERMS_VERSION)
      .maybeSingle();
    if (termsError) {
      console.warn('[auth] Terms acceptance lookup failed:', termsError.message);
    } else {
      termsAcceptance = acceptedTerms;
    }

    res.json({
      user,
      profile,
      access,
      unlockedSiteIds,
      savedSiteIds: saved?.map(s => s.site_id) ?? [],
      terms: {
        currentVersion: CURRENT_TERMS_VERSION,
        accepted: !!termsAcceptance,
        acceptedAt: termsAcceptance?.accepted_at || null,
      },
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
