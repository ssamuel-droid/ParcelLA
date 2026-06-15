/**
 * ParceLLA — Middleware Stack
 * Rate limiting, request logging, error handling, validation.
 */

import rateLimit from 'express-rate-limit';

// ── Request logger ────────────────────────────────────────────────────────────
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const user = req.user?.email ?? 'anon';
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms [${user}]`);
  });
  next();
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
export const apiLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // 15 minutes
  max:              200,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests — please try again in 15 minutes' },
});

export const pdfLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      5,            // 5 PDFs per minute per IP
  message:  { error: 'PDF rate limit exceeded — max 5 per minute' },
});

export const modelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  message:  { error: 'Model rate limit exceeded' },
});

// ── Input validation ──────────────────────────────────────────────────────────
export function validateSiteFilters(req, res, next) {
  const { minIRR, maxPrice, minUnits, minProfit, minSpread, minCapoc } = req.query;
  const numFields = { minIRR, maxPrice, minUnits, minProfit, minSpread, minCapoc };
  for (const [key, val] of Object.entries(numFields)) {
    if (val !== undefined && isNaN(+val)) {
      return res.status(400).json({ error: `Invalid value for ${key}: must be a number` });
    }
  }
  next();
}

export function validateModelOverrides(req, res, next) {
  const { overrides = {} } = req.body;
  const allowedKeys = ['exitCap','hcpsf','sc','vac','opex','ltc','rate','months','hold','app','ppu','psf'];
  const invalid = Object.keys(overrides).filter(k => !allowedKeys.includes(k));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown override keys: ${invalid.join(', ')}` });
  }
  next();
}

// ── Global error handler (must be last middleware) ────────────────────────────
export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (process.env.NODE_ENV === 'development') console.error(err.stack);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err.code === 'PGRST116') {
    return res.status(404).json({ error: 'Record not found' });
  }

  res.status(err.status ?? 500).json({
    error: err.message ?? 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

// ── Env check on startup ──────────────────────────────────────────────────────
export function checkEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
  const optional = ['MAPBOX_TOKEN', 'SOCRATA_APP_TOKEN', 'CENSUS_API_KEY'];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing required env vars: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in your keys.\n');
    process.exit(1);
  }

  optional.forEach(k => {
    if (!process.env[k]) console.warn(`⚠️  Optional env var not set: ${k}`);
  });

  console.log('✅ Environment check passed');
}
