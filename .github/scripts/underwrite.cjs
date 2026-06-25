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
  // Eastside premium
  'Silver Lake':   { studio: 2600, one: 3400, two: 4400, three: 5800 },
  'Los Feliz':     { studio: 2800, one: 3600, two: 4700, three: 6200 },
  'Echo Park':     { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Atwater Village': { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Eagle Rock':    { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Glassell Park': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Highland Park': { studio: 2200, one: 2850, two: 3700, three: 4900 },
  'Mount Washington': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Lincoln Heights': { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'El Sereno':     { studio: 1850, one: 2350, two: 3000, three: 3950 },
  'Boyle Heights': { studio: 1900, one: 2450, two: 3200, three: 4200 },
  // Central
  'Koreatown':     { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Mid-Wilshire':  { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'Hancock Park':  { studio: 2600, one: 3300, two: 4300, three: 5700 },
  'Larchmont':     { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'Hollywood':     { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'East Hollywood': { studio: 2200, one: 2800, two: 3600, three: 4800 },
  'Thai Town':     { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Little Armenia': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Hollywood Hills': { studio: 2800, one: 3600, two: 4700, three: 6200 },
  // South LA
  'West Adams':    { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'Jefferson Park': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Leimert Park':  { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Hyde Park':     { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'Vermont Square': { studio: 1800, one: 2300, two: 2950, three: 3900 },
  'South Park':    { studio: 1800, one: 2300, two: 2950, three: 3900 },
  'Historic South-Central': { studio: 1750, one: 2200, two: 2850, three: 3750 },
  'Exposition Park': { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'University Park': { studio: 2000, one: 2550, two: 3300, three: 4350 },
  // Westside
  'Culver City':   { studio: 2900, one: 3700, two: 4800, three: 6300 },
  'Mar Vista':     { studio: 2700, one: 3500, two: 4500, three: 5900 },
  'Venice':        { studio: 2900, one: 3700, two: 4800, three: 6300 },
  'Playa Vista':   { studio: 3000, one: 3900, two: 5000, three: 6500 },
  'Westchester':   { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Palms':         { studio: 2400, one: 3100, two: 4000, three: 5200 },
  'Sawtelle':      { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'West LA':       { studio: 2600, one: 3300, two: 4300, three: 5600 },
  'Brentwood':     { studio: 2900, one: 3800, two: 4900, three: 6400 },
  'Pacific Palisades': { studio: 3200, one: 4100, two: 5300, three: 7000 },
  // SFV
  'Studio City':   { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Sherman Oaks':  { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Van Nuys':      { studio: 1700, one: 2150, two: 2800, three: 3700 },
  'North Hollywood': { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'Encino':        { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Tarzana':       { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Woodland Hills': { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Reseda':        { studio: 1650, one: 2100, two: 2700, three: 3550 },
  'Canoga Park':   { studio: 1700, one: 2150, two: 2800, three: 3700 },
  'Granada Hills': { studio: 1800, one: 2300, two: 2950, three: 3900 },
  'Northridge':    { studio: 1750, one: 2200, two: 2850, three: 3750 },
  'Panorama City': { studio: 1600, one: 2050, two: 2650, three: 3500 },
  'Pacoima':       { studio: 1550, one: 1950, two: 2550, three: 3350 },
  'Arleta':        { studio: 1600, one: 2000, two: 2600, three: 3400 },
  'Sun Valley':    { studio: 1600, one: 2050, two: 2650, three: 3500 },
  'Chatsworth':    { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'Sylmar':        { studio: 1600, one: 2050, two: 2650, three: 3500 },
  'Sunland':       { studio: 1750, one: 2200, two: 2850, three: 3750 },
  'Tujunga':       { studio: 1700, one: 2150, two: 2800, three: 3700 },
  'Lakeview Terrace': { studio: 1600, one: 2050, two: 2650, three: 3500 },
};

const CAPS = {
  // Westside premium (low cap = high value)
  'Venice': 0.0425, 'Playa Vista': 0.0425, 'Brentwood': 0.0425,
  'Pacific Palisades': 0.0400, 'Culver City': 0.0450, 'West LA': 0.0450,
  'Sawtelle': 0.0475, 'Mar Vista': 0.0475,
  // Eastside trendy
  'Silver Lake': 0.0475, 'Los Feliz': 0.0475, 'Atwater Village': 0.0500,
  'Eagle Rock': 0.0500, 'Echo Park': 0.0500, 'Hollywood Hills': 0.0475,
  'Highland Park': 0.0525, 'Glassell Park': 0.0525, 'Mount Washington': 0.0525,
  // Central
  'Hancock Park': 0.0475, 'Mid-Wilshire': 0.0500, 'Larchmont': 0.0500,
  'Hollywood': 0.0500, 'East Hollywood': 0.0525, 'Studio City': 0.0475,
  'Sherman Oaks': 0.0500, 'Encino': 0.0500,
  'Koreatown': 0.0525, 'Thai Town': 0.0525, 'Little Armenia': 0.0525,
  // South LA / emerging
  'West Adams': 0.0525, 'Jefferson Park': 0.0550, 'Leimert Park': 0.0550,
  'Exposition Park': 0.0550, 'University Park': 0.0550,
  'Hyde Park': 0.0575, 'Vermont Square': 0.0575, 'South Park': 0.0575,
  'Historic South-Central': 0.0600, 'Lincoln Heights': 0.0550,
  'El Sereno': 0.0575, 'Boyle Heights': 0.0575,
  // SFV
  'North Hollywood': 0.0525, 'Van Nuys': 0.0550, 'Reseda': 0.0575,
  'Canoga Park': 0.0575, 'Panorama City': 0.0600, 'Pacoima': 0.0625,
  'Arleta': 0.0600, 'Sun Valley': 0.0600, 'Woodland Hills': 0.0525,
  'Tarzana': 0.0525, 'Granada Hills': 0.0525, 'Northridge': 0.0550,
  'Chatsworth': 0.0525, 'Sylmar': 0.0575,
  'Sunland': 0.0550, 'Tujunga': 0.0550, 'Lakeview Terrace': 0.0600,
};
const HC = { 'Multifamily': 285, 'Mixed-Use': 320, 'Condo/TH': 340, 'SFR+ADU': 275 };

// Neighborhood lookup by lat/lng bounding boxes — comprehensive LA coverage
const HOOD_BOXES = [
  // Eastside
  { hood: 'Silver Lake',      latMin: 34.070, latMax: 34.105, lngMin: -118.290, lngMax: -118.250 },
  { hood: 'Echo Park',        latMin: 34.060, latMax: 34.085, lngMin: -118.280, lngMax: -118.248 },
  { hood: 'Los Feliz',        latMin: 34.095, latMax: 34.125, lngMin: -118.310, lngMax: -118.270 },
  { hood: 'Highland Park',    latMin: 34.095, latMax: 34.135, lngMin: -118.235, lngMax: -118.175 },
  { hood: 'Eagle Rock',       latMin: 34.125, latMax: 34.155, lngMin: -118.225, lngMax: -118.185 },
  { hood: 'Glassell Park',    latMin: 34.095, latMax: 34.120, lngMin: -118.255, lngMax: -118.225 },
  { hood: 'Atwater Village',  latMin: 34.110, latMax: 34.130, lngMin: -118.275, lngMax: -118.250 },
  { hood: 'Mount Washington', latMin: 34.095, latMax: 34.120, lngMin: -118.220, lngMax: -118.195 },
  { hood: 'Boyle Heights',    latMin: 34.020, latMax: 34.060, lngMin: -118.225, lngMax: -118.190 },
  { hood: 'El Sereno',        latMin: 34.065, latMax: 34.095, lngMin: -118.190, lngMax: -118.155 },
  { hood: 'Lincoln Heights',  latMin: 34.060, latMax: 34.090, lngMin: -118.225, lngMax: -118.200 },
  // Central / Koreatown
  { hood: 'Koreatown',        latMin: 34.045, latMax: 34.075, lngMin: -118.325, lngMax: -118.285 },
  { hood: 'Mid-Wilshire',     latMin: 34.055, latMax: 34.075, lngMin: -118.365, lngMax: -118.325 },
  { hood: 'Hancock Park',     latMin: 34.070, latMax: 34.090, lngMin: -118.355, lngMax: -118.325 },
  { hood: 'Larchmont',        latMin: 34.068, latMax: 34.082, lngMin: -118.330, lngMax: -118.315 },
  { hood: 'Hollywood',        latMin: 34.085, latMax: 34.110, lngMin: -118.340, lngMax: -118.300 },
  { hood: 'East Hollywood',   latMin: 34.085, latMax: 34.105, lngMin: -118.300, lngMax: -118.275 },
  { hood: 'Thai Town',        latMin: 34.098, latMax: 34.108, lngMin: -118.305, lngMax: -118.292 },
  { hood: 'Little Armenia',   latMin: 34.095, latMax: 34.108, lngMin: -118.318, lngMax: -118.300 },
  { hood: 'Palms',            latMin: 34.000, latMax: 34.025, lngMin: -118.405, lngMax: -118.375 },
  // South LA
  { hood: 'West Adams',       latMin: 34.000, latMax: 34.035, lngMin: -118.355, lngMax: -118.315 },
  { hood: 'Jefferson Park',   latMin: 34.010, latMax: 34.030, lngMin: -118.330, lngMax: -118.305 },
  { hood: 'Leimert Park',     latMin: 33.990, latMax: 34.015, lngMin: -118.335, lngMax: -118.310 },
  { hood: 'Hyde Park',        latMin: 33.975, latMax: 33.998, lngMin: -118.335, lngMax: -118.305 },
  { hood: 'Vermont Square',   latMin: 33.998, latMax: 34.015, lngMin: -118.305, lngMax: -118.280 },
  { hood: 'South Park',       latMin: 34.010, latMax: 34.030, lngMin: -118.285, lngMax: -118.260 },
  { hood: 'Historic South-Central', latMin: 33.995, latMax: 34.020, lngMin: -118.280, lngMax: -118.250 },
  { hood: 'Exposition Park',  latMin: 34.013, latMax: 34.030, lngMin: -118.295, lngMax: -118.270 },
  { hood: 'University Park',  latMin: 34.018, latMax: 34.038, lngMin: -118.290, lngMax: -118.268 },
  // Westside
  { hood: 'Culver City',      latMin: 33.995, latMax: 34.030, lngMin: -118.420, lngMax: -118.375 },
  { hood: 'Mar Vista',        latMin: 33.982, latMax: 34.010, lngMin: -118.455, lngMax: -118.415 },
  { hood: 'Venice',           latMin: 33.975, latMax: 34.005, lngMin: -118.480, lngMax: -118.445 },
  { hood: 'Playa Vista',      latMin: 33.973, latMax: 33.990, lngMin: -118.440, lngMax: -118.410 },
  { hood: 'Westchester',      latMin: 33.953, latMax: 33.978, lngMin: -118.415, lngMax: -118.378 },
  { hood: 'Palms',            latMin: 34.000, latMax: 34.025, lngMin: -118.408, lngMax: -118.378 },
  { hood: 'Sawtelle',         latMin: 34.020, latMax: 34.048, lngMin: -118.450, lngMax: -118.425 },
  { hood: 'West LA',          latMin: 34.030, latMax: 34.060, lngMin: -118.455, lngMax: -118.420 },
  { hood: 'Brentwood',        latMin: 34.040, latMax: 34.075, lngMin: -118.490, lngMax: -118.450 },
  { hood: 'Pacific Palisades', latMin: 34.030, latMax: 34.080, lngMin: -118.545, lngMax: -118.490 },
  // Hollywood Hills / SFV adjacent
  { hood: 'Hollywood Hills',  latMin: 34.105, latMax: 34.145, lngMin: -118.360, lngMax: -118.300 },
  { hood: 'Los Feliz',        latMin: 34.100, latMax: 34.130, lngMin: -118.300, lngMax: -118.270 },
  { hood: 'Studio City',      latMin: 34.130, latMax: 34.160, lngMin: -118.405, lngMax: -118.370 },
  { hood: 'Sherman Oaks',     latMin: 34.140, latMax: 34.175, lngMin: -118.465, lngMax: -118.415 },
  { hood: 'Van Nuys',         latMin: 34.175, latMax: 34.215, lngMin: -118.465, lngMax: -118.415 },
  { hood: 'North Hollywood',  latMin: 34.155, latMax: 34.195, lngMin: -118.390, lngMax: -118.350 },
  { hood: 'Sun Valley',       latMin: 34.195, latMax: 34.235, lngMin: -118.390, lngMax: -118.345 },
  { hood: 'Sylmar',           latMin: 34.280, latMax: 34.330, lngMin: -118.470, lngMax: -118.410 },
  { hood: 'Chatsworth',       latMin: 34.240, latMax: 34.280, lngMin: -118.620, lngMax: -118.565 },
  { hood: 'Granada Hills',    latMin: 34.260, latMax: 34.300, lngMin: -118.540, lngMax: -118.490 },
  { hood: 'Northridge',       latMin: 34.220, latMax: 34.260, lngMin: -118.555, lngMax: -118.500 },
  { hood: 'Reseda',           latMin: 34.190, latMax: 34.225, lngMin: -118.545, lngMax: -118.500 },
  { hood: 'Canoga Park',      latMin: 34.195, latMax: 34.235, lngMin: -118.610, lngMax: -118.555 },
  { hood: 'Woodland Hills',   latMin: 34.155, latMax: 34.200, lngMin: -118.640, lngMax: -118.580 },
  { hood: 'Tarzana',          latMin: 34.155, latMax: 34.190, lngMin: -118.570, lngMax: -118.530 },
  { hood: 'Encino',           latMin: 34.145, latMax: 34.180, lngMin: -118.530, lngMax: -118.480 },
  // Northeast
  { hood: 'Sunland',          latMin: 34.245, latMax: 34.280, lngMin: -118.325, lngMax: -118.280 },
  { hood: 'Tujunga',          latMin: 34.250, latMax: 34.295, lngMin: -118.300, lngMax: -118.250 },
  { hood: 'Lakeview Terrace', latMin: 34.255, latMax: 34.285, lngMin: -118.380, lngMax: -118.340 },
  { hood: 'Pacoima',          latMin: 34.240, latMax: 34.280, lngMin: -118.410, lngMax: -118.370 },
  { hood: 'Arleta',           latMin: 34.230, latMax: 34.265, lngMin: -118.440, lngMax: -118.405 },
  { hood: 'Panorama City',    latMin: 34.210, latMax: 34.240, lngMin: -118.455, lngMax: -118.415 },
];

// Council district to neighborhood mapping (fallback)
const DISTRICT_HOOD = {
  1: 'Echo Park',      2: 'Hollywood Hills', 3: 'Woodland Hills',  4: 'Los Feliz',
  5: 'Mid-Wilshire',   6: 'Van Nuys',        7: 'Pacoima',         8: 'Leimert Park',
  9: 'South Park',    10: 'West Adams',      11: 'Venice',         12: 'Granada Hills',
  13: 'Silver Lake',  14: 'Highland Park',   15: 'Boyle Heights',
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
