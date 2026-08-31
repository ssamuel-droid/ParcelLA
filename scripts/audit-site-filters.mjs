const baseUrl = String(process.env.API_BASE_URL || 'https://parcella-api-production.up.railway.app').replace(/\/$/, '');
const failures = [];
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}
      if (response.ok) return { payload, elapsedMs: Date.now() - started, attempts: attempt };
      lastError = new Error(`${response.status} ${payload?.error || text.slice(0, 160)}`);
      if (![502, 503, 504].includes(response.status) || attempt === 3) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 3 || (!/abort|fetch|502|503|504|temporarily unavailable/i.test(error.message))) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, 300 * attempt));
  }
  throw lastError || new Error('request failed');
}

function sitesFrom(payload) {
  return payload?.sites || payload?.results || [];
}

function canonicalType(site) {
  return String(site?.type || site?.project_type || '').toLowerCase();
}

function number(site, ...keys) {
  for (const key of keys) {
    const value = Number(site?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function check(name, path, validate = () => {}) {
  try {
    const { payload, elapsedMs, attempts } = await request(path);
    const sites = sitesFrom(payload);
    assert(Array.isArray(sites), 'response does not contain a site array');
    assert(sites.length <= 50, `returned too many rows (${sites.length})`);
    validate(payload, sites);
    results.push({ name, status: 'PASS', count: sites.length, total: payload?.total, elapsedMs, attempts });
    return { payload, sites };
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    results.push({ name, status: 'FAIL', count: 0, total: null, elapsedMs: null, attempts: null });
    return { payload: null, sites: [] };
  }
}

const house = await check(
  'SFH only',
  '/api/sites?types=New%20House&fast=1&limit=10&offset=0',
  (payload, sites) => {
    assert(sites.length > 0, 'no permit-backed houses returned');
    assert(sites.every(site => canonicalType(site).includes('house')), 'non-house row returned by SFH filter');
    assert(Number(payload.total) >= sites.length, 'total is smaller than returned page');
  }
);

await check(
  'SFH Pacific Palisades',
  '/api/sites?types=New%20House&hood=Pacific%20Palisades&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'no Pacific Palisades houses returned');
    assert(sites.every(site => canonicalType(site).includes('house')), 'neighborhood filter returned a non-house row');
  }
);

await check(
  'SFH minimum 4,000 SF',
  '/api/sites?types=New%20House&minSf=4000&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'no houses at or above 4,000 SF returned');
    assert(sites.every(site => number(site, 'buildingSf', 'totalBuildingSf') >= 4000), 'minimum SF filter returned a smaller house');
  }
);

await check(
  'SFH maximum 3,000 SF',
  '/api/sites?types=New%20House&maxSf=3000&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'no houses at or below 3,000 SF returned');
    assert(sites.every(site => number(site, 'buildingSf', 'totalBuildingSf') <= 3000), 'maximum SF filter returned a larger house');
  }
);

await check(
  'SFH minimum 5,000 lot SF',
  '/api/sites?types=New%20House&minLot=5000&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'lot-size filter returned no permit-backed houses')
);

const addressHouse = await check(
  'SFH full address search',
  '/api/sites?types=New%20House&q=1374%20S%20BECKWITH%20AVE&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'known permit-backed house was not found');
    assert(sites.every(site => canonicalType(site).includes('house')), 'SFH search returned another project type');
  }
);

const sampleHouse = addressHouse.sites[0] || house.sites[0];
if (sampleHouse) {

  try {
    const { payload, elapsedMs, attempts } = await request(`/api/sites/${sampleHouse.id}`);
    assert(payload?.site, 'house detail response has no site');
    assert(Number(payload.site.id) === Number(sampleHouse.id), 'house detail returned the wrong permit');
    results.push({ name: 'SFH detail and planning lookup', status: 'PASS', count: 1, total: 1, elapsedMs, attempts });
  } catch (error) {
    failures.push(`SFH detail and planning lookup: ${error.message}`);
    results.push({ name: 'SFH detail and planning lookup', status: 'FAIL', count: 0, total: null, elapsedMs: null, attempts: null });
  }

  await check(
    'Mixed types include SFH search',
    '/api/sites?types=Multifamily%2CMixed-Use%2CCondo%2FTH%2CNew%20House&q=1374%20S%20BECKWITH%20AVE&fast=1&limit=10&offset=0',
    (_payload, sites) => assert(sites.some(site => canonicalType(site).includes('house')), 'mixed project-type search omitted the known house')
  );
}

await check(
  '12500 Riverside search',
  '/api/sites?types=Multifamily%2CMixed-Use%2CCondo%2FTH&q=12500%20Riverside&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'known Riverside project was not found')
);

await check(
  'Multifamily unit range',
  '/api/sites?types=Multifamily&minUnits=50&maxUnits=250&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.every(site => canonicalType(site).includes('multifamily')), 'project-type filter returned another type');
    assert(sites.every(site => number(site, 'units') >= 50 && number(site, 'units') <= 250), 'unit range filter returned an out-of-range project');
  }
);

await check(
  'Mixed-Use type',
  '/api/sites?types=Mixed-Use&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'no mixed-use projects returned');
    assert(sites.every(site => canonicalType(site).includes('mixed')), 'mixed-use filter returned another project type');
  }
);

await check(
  'Condo / townhome type',
  '/api/sites?types=Condo%2FTH&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.length > 0, 'no condo/townhome projects returned');
    assert(sites.every(site => /condo|town/i.test(canonicalType(site))), 'condo/townhome filter returned another project type');
  }
);

await check(
  'Koreatown neighborhood',
  '/api/sites?types=Multifamily&hood=Koreatown&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'neighborhood filter returned no projects')
);

await check(
  'Off-market listing',
  '/api/sites?types=Multifamily&listing=off_market&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.every(site => /off|not for sale/i.test(String(site.listingStatus || site.status || ''))), 'listing filter returned a non-off-market project')
);

await check(
  'For-sale listing',
  '/api/sites?types=Multifamily&listing=for_sale&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0 && sites.every(site => !/off|not for sale/i.test(String(site.listingStatus || site.status || ''))), 'for-sale filter returned another listing category')
);

await check(
  'RTI listing',
  '/api/sites?types=Multifamily&listing=rti&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0 && sites.every(site => site.rti), 'RTI filter returned a non-RTI project')
);

await check(
  'Submitted development status',
  '/api/sites?types=Multifamily&devStatus=submitted&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'submitted filter returned no projects')
);

await check(
  'Plan-check development status',
  '/api/sites?types=Multifamily&devStatus=plan_check&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'plan-check filter returned no projects')
);

await check(
  'ED1 apartments',
  '/api/sites?types=Multifamily&ed1=true&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.length > 0, 'ED1 filter returned no projects')
);

await check(
  'Default dashboard excludes SFH',
  '/api/sites?fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.every(site => !canonicalType(site).includes('house')), 'default dashboard included a permit-backed house')
);

console.table(results);
if (failures.length) {
  console.error('\nAudit failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${results.length} production site/filter checks passed against ${baseUrl}.`);
