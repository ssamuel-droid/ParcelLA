const baseUrl = String(process.env.API_BASE_URL || 'https://parcella-api-production.up.railway.app').replace(/\/$/, '');
const failures = [];
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    assert(response.ok, `${response.status} ${payload?.error || text.slice(0, 160)}`);
    return { payload, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
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
    const { payload, elapsedMs } = await request(path);
    const sites = sitesFrom(payload);
    assert(Array.isArray(sites), 'response does not contain a site array');
    assert(sites.length <= 50, `returned too many rows (${sites.length})`);
    validate(payload, sites);
    results.push({ name, status: 'PASS', count: sites.length, total: payload?.total, elapsedMs });
    return { payload, sites };
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    results.push({ name, status: 'FAIL', count: 0, total: null, elapsedMs: null });
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
    assert(sites.every(site => site.hood === 'Pacific Palisades'), 'neighborhood filter leaked another neighborhood');
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

const sampleHouse = house.sites[0];
if (sampleHouse) {
  const addressNumber = encodeURIComponent(String(sampleHouse.addr || sampleHouse.address || '').split(/\s+/)[0]);
  await check(
    'SFH address search',
    `/api/sites?types=New%20House&q=${addressNumber}&fast=1&limit=10&offset=0`,
    (_payload, sites) => assert(sites.some(site => Number(site.id) === Number(sampleHouse.id)), 'known house was not found by address number')
  );

  try {
    const { payload, elapsedMs } = await request(`/api/sites/${sampleHouse.id}`);
    assert(payload?.site, 'house detail response has no site');
    assert(Number(payload.site.id) === Number(sampleHouse.id), 'house detail returned the wrong permit');
    results.push({ name: 'SFH detail and planning lookup', status: 'PASS', count: 1, total: 1, elapsedMs });
  } catch (error) {
    failures.push(`SFH detail and planning lookup: ${error.message}`);
    results.push({ name: 'SFH detail and planning lookup', status: 'FAIL', count: 0, total: null, elapsedMs: null });
  }

  await check(
    'Mixed types include SFH search',
    `/api/sites?types=Multifamily%2CMixed-Use%2CCondo%2FTH%2CNew%20House&q=${addressNumber}&fast=1&limit=10&offset=0`,
    (_payload, sites) => assert(sites.some(site => Number(site.id) === Number(sampleHouse.id)), 'mixed project-type search omitted the known house')
  );
}

await check(
  'Multifamily unit range',
  '/api/sites?types=Multifamily&minUnits=50&maxUnits=250&fast=1&limit=10&offset=0',
  (_payload, sites) => {
    assert(sites.every(site => canonicalType(site).includes('multifamily')), 'project-type filter returned another type');
    assert(sites.every(site => number(site, 'units') >= 50 && number(site, 'units') <= 250), 'unit range filter returned an out-of-range project');
  }
);

await check(
  'Off-market listing',
  '/api/sites?types=Multifamily&listing=off_market&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.every(site => /off|not for sale/i.test(String(site.listingStatus || site.status || ''))), 'listing filter returned a non-off-market project')
);

await check(
  'Submitted development status',
  '/api/sites?types=Multifamily&devStatus=submitted&fast=1&limit=10&offset=0',
  (_payload, sites) => assert(sites.every(site => String(site.developmentStatus || '').toLowerCase().includes('submitted')), 'development-status filter returned another status')
);

console.table(results);
if (failures.length) {
  console.error('\nAudit failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${results.length} production site/filter checks passed against ${baseUrl}.`);
