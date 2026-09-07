import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { allowedCorsOrigins, isCorsOriginAllowed } from '../api/lib/cors.js';

const production = { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.parcella.com' };
const development = { NODE_ENV: 'development', ALLOWED_ORIGINS: '' };

assert.equal(isCorsOriginAllowed(undefined, production), true, 'server-to-server requests remain allowed');
assert.equal(isCorsOriginAllowed('https://parcel-la.vercel.app', production), true);
assert.equal(isCorsOriginAllowed('https://app.parcella.com/path', production), true);
assert.equal(isCorsOriginAllowed('https://app.parcella.com.evil.example', production), false);
assert.equal(isCorsOriginAllowed('https://evil.example', production), false);
assert.equal(isCorsOriginAllowed('null', production), false);
assert.equal(isCorsOriginAllowed('http://localhost:5173', production), false);
assert.equal(isCorsOriginAllowed('http://localhost:5173', development), true);
assert.deepEqual(
  [...allowedCorsOrigins(production)].sort(),
  ['https://app.parcella.com', 'https://parcel-la.vercel.app'],
);

console.log('CORS origin allowlist tests passed.');

const terms = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const authRoute = readFileSync(new URL('../api/routes/other.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/020_lock_down_public_data.sql', import.meta.url), 'utf8');
const termsDigest = createHash('sha256').update(terms).digest('hex');

assert.match(authRoute, new RegExp(`CURRENT_TERMS_DIGEST = '${termsDigest}'`));
assert.match(authRoute, /CURRENT_TERMS_VERSION = '2026-09-07'/);
assert.match(app, /TERMS_VERSION = '2026-09-07'/);
assert.match(app, /href="\/privacy\.html"/);
assert.match(terms, /ssamuel@goodhealthcorp\.com/);
assert.match(privacy, /ssamuel@goodhealthcorp\.com/);
assert.match(privacy, /does not sell personal information/i);

for (const table of [
  'sites', 'profiles', 'sold_comps', 'permits', 'subscription_events',
  'sync_log', 'planning_cases', 'planning_documents', 'terms_acceptances',
]) {
  assert.match(migration, new RegExp(`'${table}'`), `security migration must cover ${table}`);
}
assert.match(migration, /REVOKE ALL PRIVILEGES[\s\S]+anon, authenticated/);
assert.match(migration, /ALTER DEFAULT PRIVILEGES/);

console.log('Launch security and legal-page consistency tests passed.');
