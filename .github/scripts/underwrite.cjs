// ParceLLA — Underwriting Engine
// Reads permits from Supabase, runs financial model, stores results in sites table

const https = require('https');

const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(SB_URL + path);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function sbUpsert(table, rows, conflict) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const u = new URL(SB_URL + '/rest/v1/' + table + '?on_conflict=' + conflict);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Underwriting model ────────────────────────────────────────────────────────
const RENTS = {
  'Silver Lake':   { studio: 2600, one: 3400, two: 4400, three: 5800 },
  'Echo Park':     { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Highland Park': { studio: 2200, one: 2850, two: 3700, three: 4900 },
  'Los Feliz':     { studio: 2800, one: 3600, two: 4700, three: 6200 },
  'Koreatown':     { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Mid-Wilshire':  { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'Culver City':   { studio: 2900, one: 3700, two: 4800, three: 6300 },
  'Mar Vista':     { studio: 2700, one: 3500, two: 4500, three: 5900 },
  'West Adams':    { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'Boyle Heights': { studio: 1900, one: 2450, two: 3200, three: 4200 },
};
const CAPS = {
  'Silver Lake': 0.0475, 'Echo Park': 0.0500, 'Highland Park': 0.0525,
  'Los Feliz': 0.0475,   'Koreatown': 0.0525, 'Mid-Wilshire': 0.0500,
  'Culver City': 0.0475, 'Mar Vista': 0.0500, 'West Adams': 0.0525,
  'Boyle Heights': 0.0575,
};
const HC = { 'Multifamily': 285, 'Mixed-Use': 320, 'Condo/TH': 340, 'SFR+ADU': 275 };

// Neighborhood lookup by lat/lng bounding boxes (LA neighborhoods)
const HOOD_BOXES = [
  { hood: 'Silver Lake',   latMin: 34.070, latMax: 34.100, lngMin: -118.285, lngMax: -118.255 },
  { hood: 'Echo Park',     latMin: 34.065, latMax: 34.085, lngMin: -118.275, lngMax: -118.245 },
  { hood: 'Highland Park', latMin: 34.095, latMax: 34.125, lngMin: -118.225, lngMax: -118.185 },
  { hood: 'Los Feliz',     latMin: 34.095, latMax: 34.120, lngMin: -118.305, lngMax: -118.275 },
  { hood: 'Koreatown',     latMin: 34.045, latMax: 34.075, lngMin: -118.320, lngMax: -118.285 },
  { hood: 'Mid-Wilshire',  latMin: 34.055, latMax: 34.075, lngMin: -118.360, lngMax: -118.320 },
  { hood: 'Culver City',   latMin: 34.000, latMax: 34.035, lngMin: -118.415, lngMax: -118.375 },
  { hood: 'Mar Vista',     latMin: 33.985, latMax: 34.015, lngMin: -118.445, lngMax: -118.410 },
  { hood: 'West Adams',    latMin: 34.000, latMax: 34.030, lngMin: -118.350, lngMax: -118.310 },
  { hood: 'Boyle Heights', latMin: 34.020, latMax: 34.055, lngMin: -118.225, lngMax: -118.195 },
];

// Council district to neighborhood mapping
const DISTRICT_HOOD = {
  1: 'Highland Park', 2: 'Mid-Wilshire', 3: 'Mar Vista', 4: 'Los Feliz',
  5: 'Mid-Wilshire',  6: 'West Adams',   7: 'Highland Park', 8: 'West Adams',
  9: 'Koreatown',    10: 'Mid-Wilshire', 11: 'Mar Vista', 12: 'Culver City',
  13: 'Silver Lake', 14: 'Highland Park', 15: 'Boyle Heights',
};

function guessHood(a, lat, lng, councilDistrict) {
  // First try coordinates (most accurate)
  if (lat && lng) {
    for (const b of HOOD_BOXES) {
      if (lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax) {
        return b.hood;
      }
    }
  }
  // Fall back to council district
  if (councilDistrict && DISTRICT_HOOD[councilDistrict]) {
    return DISTRICT_HOOD[councilDistrict];
  }
  // Fall back to address text search
  a = (a || '').toUpperCase();
  if (a.includes('SILVER LAKE') || a.includes('SILVERLAKE')) return 'Silver Lake';
  if (a.includes('ECHO PARK'))     return 'Echo Park';
  if (a.includes('HIGHLAND PARK')) return 'Highland Park';
  if (a.includes('LOS FELIZ'))     return 'Los Feliz';
  if (a.includes('CULVER'))        return 'Culver City';
  if (a.includes('MAR VISTA'))     return 'Mar Vista';
  if (a.includes('WEST ADAMS'))    return 'West Adams';
  if (a.includes('BOYLE'))         return 'Boyle Heights';
  if (a.includes('WILSHIRE'))      return 'Mid-Wilshire';
  return 'Koreatown';
}

function guessType(pt, st, u) {
  const s = (st || '').toLowerCase();
  if (s.includes('condo') || s.includes('townhouse')) return 'Condo/TH';
  if (s.includes('commercial') || s.includes('mixed')) return 'Mixed-Use';
  if (u >= 5) return 'Multifamily';
  return 'SFR+ADU';
}

function calcIRR(cfs) {
  let rate = 0.15;
  for (let i = 0; i < 60; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cfs.length; t++) {
      npv  += cfs[t] / Math.pow(1 + rate, t);
      dnpv -= t * cfs[t] / Math.pow(1 + rate, t + 1);
    }
    const delta = npv / dnpv;
    rate -= delta;
    if (Math.abs(delta) < 0.00001) break;
  }
  return Math.round(rate * 1000) / 10;
}

function underwrite(p) {
  const hood  = guessHood(p.address, p.lat, p.lng, p.council_district);
  const type  = guessType(p.permit_type, p.permit_subtype, p.units);
  const units = Math.max(p.units || 2, 2);
  const R     = RENTS[hood] || RENTS['Koreatown'];
  const cap   = CAPS[hood]  || 0.0525;
  const hcpsf = HC[type]    || 285;

  const blended = R.studio * 0.25 + R.one * 0.50 + R.two * 0.20 + R.three * 0.05;
  const noi     = blended * 12 * units * 0.95 * 0.62;
  const hard    = hcpsf * 800 * units;
  const soft    = hard * 0.18;
  const landEst = p.valuation > hard ? p.valuation : hard * 0.45;
  const preLoan = landEst + hard + soft;
  const loan    = preLoan * 0.65;
  const carry   = loan * 0.065 * 1.5;
  const total   = preLoan + carry;
  const exitCap = cap + 0.005;
  const exitVal = noi / exitCap;
  const profit  = exitVal - total;
  const equity  = total - loan;
  const ds      = loan * 0.065;
  const cfbt    = noi - ds;
  const irr     = equity > 500
    ? Math.min(Math.max(calcIRR([-equity, cfbt, cfbt, cfbt, cfbt, cfbt + exitVal - loan]), -50), 100)
    : 0;

  return {
    neighborhood:    hood,
    project_type:    type,
    units,
    avg_unit_sf:     800,
    lot_sf:          5000,
    status:          'active',
    data_source:     'ladbs_permit',
    rti:             p.is_rti || false,
    lat:             p.lat,
    lng:             p.lng,
    noi:             Math.round(noi),
    total_cost:      Math.round(total),
    exit_value:      Math.round(exitVal),
    net_profit:      Math.round(profit),
    irr_v:           irr,
    cap_on_cost:     Math.round(noi / total * 10000) / 100,
    dev_spread_pct:  Math.round(profit / total * 10000) / 100,
    underwritten_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('Loading permits from Supabase...');

  // Load in pages of 1000 to handle large datasets
  let allPermits = [], offset = 0;
  while (true) {
    const batch = await sbGet(
      '/rest/v1/permits' +
      '?select=id,address,zone,units,valuation,issued_date,is_rti,permit_type,permit_subtype,lat,lng,status,raw_data->council_district' +
      '&valuation=gte.50000' +
      '&address=neq.' +
      '&limit=1000' +
      '&offset=' + offset +
      '&order=issued_date.desc' +
      '&apikey=' + SB_KEY
    );
    if (!batch.length) break;
    allPermits = allPermits.concat(batch);
    console.log('Loaded', allPermits.length, 'permits...');
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log('Total permits to underwrite:', allPermits.length);

  let done = 0;
  for (let i = 0; i < allPermits.length; i += 100) {
    const batch = allPermits.slice(i, i + 100);
    const rows = batch.map(p => ({ address: p.address, ...underwrite(p) }));

    // Deduplicate by address + project_type
    const seen = new Set();
    const dedup = rows.filter(r => {
      const k = r.address + '|' + r.project_type;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const res = await sbUpsert('sites', dedup, 'address,project_type');
    if (res.status < 300) done += dedup.length;
    else console.log('Batch error:', res.status, res.body.slice(0, 100));

    if (i % 1000 === 0) console.log('Progress:', done, '/', allPermits.length);
    await sleep(50);
  }

  console.log('\n=== UNDERWRITING COMPLETE ===');
  console.log('Sites underwritten and stored:', done);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
