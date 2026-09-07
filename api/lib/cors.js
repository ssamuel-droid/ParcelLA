const PRODUCTION_APP_ORIGIN = 'https://parcel-la.vercel.app';
const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedCorsOrigins(env = process.env) {
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const defaults = env.NODE_ENV === 'production'
    ? [PRODUCTION_APP_ORIGIN]
    : [PRODUCTION_APP_ORIGIN, ...DEVELOPMENT_ORIGINS];

  return new Set([...defaults, ...configured]);
}

export function isCorsOriginAllowed(origin, env = process.env) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return !!normalized && allowedCorsOrigins(env).has(normalized);
}

export function createCorsOptions(env = process.env) {
  return {
    origin(origin, callback) {
      callback(null, isCorsOriginAllowed(origin, env));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  };
}
