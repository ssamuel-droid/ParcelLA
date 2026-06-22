/**
 * ParceLLA API Server v3 — Production Ready
 *
 * All routes mounted. All middleware wired.
 *
 * GET  /api/health
 *
 * Sites:       /api/sites, /api/sites/:id, /api/sites/:id/enrich,
 *              /api/sites/:id/demand, POST/DEL /api/sites/:id/save
 * Model:       /api/model/:id, /api/model/:id/scenarios,
 *              /api/model/:id/waterfall, /api/model/:id/overrides
 * PDF:         POST /api/pdf/:id
 * Auth:        /api/auth/signup, /api/auth/signin, /api/auth/signout,
 *              /api/auth/me, /api/auth/forgot-password, /api/auth/reset-password
 * Alerts:      GET/POST/DEL /api/alerts
 * Notes:       GET/POST/PATCH/DEL /api/notes/:siteId
 * Comps:       GET /api/comps, /api/comps/submarket/:hood, POST /api/comps
 * Narrative:   POST /api/narrative/:siteId
 * Share:       POST /api/share, GET /api/share/:token
 * Activity:    GET /api/activity
 * Email:       POST /api/email/deal-memo
 * Stripe:      GET /api/stripe/plans, POST /api/stripe/checkout,
 *              POST /api/stripe/portal, POST /api/stripe/webhook
 * Submarkets:  GET /api/submarkets, /api/submarkets/:hood
 */

import 'dotenv/config';
import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import compression  from 'compression';

import {
  requestLogger, apiLimiter, pdfLimiter,
  errorHandler, checkEnv,
} from './middleware/middleware.js';

import sitesRouter     from './routes/sites.js';
import modelRouter     from './routes/model.js';
import compsRouter     from './routes/comps.js';
import notesRouter     from './routes/notes.js';
import stripeRouter    from './routes/stripe.js';
import {
  pdfRouter, authRouter, alertsRouter, submarketRouter,
} from './routes/other.js';
import {
  narrativeRouter, shareRouter, activityRouter,
  passwordRouter, emailRouter,
} from './routes/narrative.js';
import { startSyncJobs } from './jobs/sync.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

if (process.env.NODE_ENV === 'production') checkEnv();

const app  = express();
const PORT = process.env.PORT ?? 3001;

// ── Security & parsing ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({
  origin:      true,   // allow all origins — restrict after launch
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','stripe-signature'],
}));

// Raw body for Stripe webhook (must come before express.json)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging & rate limiting ────────────────────────────────────────────────────
app.use(requestLogger);
app.use('/api/', apiLimiter);

// ── Frontend static files ────────────────────────────────────────────────────
const __dirname2 = dirname(fileURLToPath(import.meta.url));
const publicDir  = join(__dirname2, '..', 'public');

// Serve all static files from public/
app.use(express.static(publicDir));

// Fallback — serve index.html for any non-API route
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: publicDir });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/sites',       sitesRouter);
app.use('/api/model',       modelRouter);
app.use('/api/comps',       compsRouter);
app.use('/api/notes',       notesRouter);
app.use('/api/pdf',         pdfLimiter, pdfRouter);
app.use('/api/auth',        authRouter);
app.use('/api/auth',        passwordRouter);       // forgot-password, reset-password
app.use('/api/alerts',      alertsRouter);
app.use('/api/submarkets',  submarketRouter);
app.use('/api/narrative',   narrativeRouter);
app.use('/api/share',       shareRouter);
app.use('/api/activity',    activityRouter);
app.use('/api/email',       emailRouter);
app.use('/api/stripe',      stripeRouter);

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/api/setup-status', async (req, res) => {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const tables = ['sites','profiles','saved_sites','deal_notes','model_overrides',
      'alerts','rent_comps','sold_comps','permits','share_links','narratives','activity_log'];
    const status = {};
    for (const t of tables) {
      try {
        const { error } = await sb.from(t).select('*').limit(1);
        status[t] = error ? 'ERR:' + error.message : 'OK';
      } catch (e) { status[t] = 'ERROR'; }
    }
    res.json({ status, supabase: !!process.env.SUPABASE_URL });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '3.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV ?? 'development',
    services: {
      supabase:  !!process.env.SUPABASE_URL,
      mapbox:    !!process.env.MAPBOX_TOKEN,
      socrata:   !!process.env.SOCRATA_APP_TOKEN,
      census:    !!process.env.CENSUS_API_KEY,
      rentcast:  !!process.env.RENTCAST_API_KEY,
      stripe:    !!process.env.STRIPE_SECRET_KEY,
      resend:    !!process.env.RESEND_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const svc = (key, label) => process.env[key] ? `✅ ${label}` : `⚠️  ${label} (not set)`;
  console.log(`\n🏗  ParceLLA API v3.0 → http://localhost:${PORT}`);
  console.log(`   ${svc('SUPABASE_URL','Supabase')}  ${svc('MAPBOX_TOKEN','Mapbox')}`);
  console.log(`   ${svc('SOCRATA_APP_TOKEN','LADBS')}  ${svc('CENSUS_API_KEY','Census')}`);
  console.log(`   ${svc('RESEND_API_KEY','Resend')}  ${svc('STRIPE_SECRET_KEY','Stripe')}`);
  console.log(`   ${svc('ANTHROPIC_API_KEY','Claude API')}`);
  if (process.env.NODE_ENV === 'production') startSyncJobs();
  console.log('');
});

export default app;
