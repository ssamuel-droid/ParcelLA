/**
 * ParceLLA API Server — v2
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/sites               — list + pre-underwrite, all filters
 *   GET  /api/sites/:id           — single site + full model
 *   GET  /api/sites/:id/enrich    — LADBS + Census enrichment
 *   GET  /api/sites/:id/demand    — demand score (7 factors)
 *   POST /api/sites/:id/save      — save to watchlist (auth)
 *   DEL  /api/sites/:id/save      — unsave (auth)
 *   POST /api/model/:id           — run model with overrides
 *   POST /api/model/:id/scenarios — bear/base/bull + stress tests
 *   POST /api/model/:id/waterfall — equity waterfall
 *   PUT  /api/model/:id/overrides — save overrides (auth)
 *   GET  /api/model/:id/overrides — get overrides (auth)
 *   GET  /api/model/waterfall/presets
 *   POST /api/pdf/:id             — generate deal memo PDF
 *   POST /api/auth/signup
 *   POST /api/auth/signin
 *   POST /api/auth/signout
 *   GET  /api/auth/me
 *   GET  /api/alerts              — list alerts (auth)
 *   POST /api/alerts              — create alert (auth)
 *   DEL  /api/alerts/:id          — delete alert (auth)
 *   GET  /api/submarkets          — all submarket data
 *   GET  /api/submarkets/:hood    — single submarket
 */

import 'dotenv/config';
import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import compression    from 'compression';

import {
  requestLogger,
  apiLimiter,
  errorHandler,
  checkEnv,
} from './middleware/middleware.js';

import sitesRouter      from './routes/sites.js';
import modelRouter      from './routes/model.js';
import {
  pdfRouter,
  authRouter,
  alertsRouter,
  submarketRouter,
} from './routes/other.js';

import { startSyncJobs } from './jobs/sync.js';

// ── Env check ─────────────────────────────────────────────────────────────────
// Skip hard exit in development if Supabase keys aren't set yet
if (process.env.NODE_ENV === 'production') checkEnv();

const app  = express();
const PORT = process.env.PORT ?? 3001;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // handled by frontend
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin:      process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods:     ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/sites',       sitesRouter);
app.use('/api/model',       modelRouter);
app.use('/api/pdf',         pdfRouter);
app.use('/api/auth',        authRouter);
app.use('/api/alerts',      alertsRouter);
app.use('/api/submarkets',  submarketRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV ?? 'development',
    services: {
      supabase:  !!process.env.SUPABASE_URL,
      mapbox:    !!process.env.MAPBOX_TOKEN,
      socrata:   !!process.env.SOCRATA_APP_TOKEN,
      census:    !!process.env.CENSUS_API_KEY,
      rentcast:  !!process.env.RENTCAST_API_KEY,
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏗  ParceLLA API running → http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`   Supabase:    ${process.env.SUPABASE_URL ? '✅' : '⚠️  not configured'}`);
  console.log(`   Mapbox:      ${process.env.MAPBOX_TOKEN ? '✅' : '⚠️  not configured'}`);
  console.log(`   Socrata:     ${process.env.SOCRATA_APP_TOKEN ? '✅' : '⚠️  not configured'}`);
  console.log(`   Census:      ${process.env.CENSUS_API_KEY ? '✅' : '⚠️  not configured'}`);

  // Start background sync jobs in production
  if (process.env.NODE_ENV === 'production') {
    startSyncJobs();
  } else {
    console.log('   Sync jobs:   skipped (dev mode — run manually with --run-now)');
  }
  console.log('');
});

export default app;
