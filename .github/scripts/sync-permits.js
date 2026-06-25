// ParceLLA — LA City Permit Sync + Underwriting
// Runs via GitHub Actions from US servers (not blocked by LA City)
// Fetches permits, runs financial model, stores in Supabase

const https = require('https');

const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(d));
        else reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
      });
    }).on('error', reject);
  });
}

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(SB_URL + path);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Accept': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Parse error: ' + d.slice(0,100))); }
      });
    }).on('error', reject);
  });
}

function sbUpsert(table, rows, conflict) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const path = '/rest/v1/' + table + '?on_conflict=' + conflict;
    const u = new URL(SB_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SB_KEY,
        'apikey': SB_KEY,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch all pages from Socrata ──────────────────────────────────────────────
async function fetchAll(baseUrl) {
  let all = [], offset = 0;
  while (true) {
    const batch = await get(baseUrl + '&$limit=1000&$offset=' + offset);
    if (!batch.length) break;
    all = all.concat(batch);
    console.log('  Fetched', all.length, 'permits so far...');
    if (batch.length < 1000) break;
    offset += 1000;
    await sleep(300);
  }
  return all;
}

// ── Permit row builder ────────────────────────────────────────────────────────
function toPermitRow(r, i) {
  const addr = r.address ||
    [r.address_start, r.street_direction, r.street_name, r.street_suffix]
      .filter(Boolean).join(' ').trim();
  const pnum = String(r.pcis_permit || r.permitnumber || r.id || 'rec-' + i).slice(0, 100);
  const status = String(r.latest_status || r.status || 'Active').slice(0, 50);
  let lat = null, lng = null;
  if (r.location_1 && r.location_1.coordinates) {
    lng = r.location_1.coordinates[0];
    lat = r.location_1.coordinates[1];
  }
  return {
    permit_number: pnum,
    permit_type: r.permit_type || 'Building',
    permit_subtype: r.permit_sub_type || null,
    status,
    address: addr.slice(0, 255),
    zone: r.zone || null,
    units: parseInt(r.of_residential_dwelling_units || r.units || '0') || 0,
    valuation: parseFloat(r.valuation || '0') || 0,
    issued_date: (r.issue_date || '').split('T')[0] || null,
    is_rti: status.toLowerCase().includes('ready'),
    lat, lng,
    raw_data: r,
    synced_at: new Date().toISOString(),
  };
}

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

function guessHood(a) {
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
  const hood  = guessHood(p.address);
  const type  = guessType(p.permit_type, p.permit_subtype, p.units);
  const units = Math.max(p.units || 2, 2);
  const R     = RENTS[hood] || RENTS['Koreatown'];
  const cap   = CAPS[hood]  || 0.0525;
  const hcpsf = HC[type]    || 285;

  const blended = R.studio * 0.25 + R.one * 0.50 + R.two * 0.20 + R.three * 0.05;
  const noi     = blended * 12 * units * 0.95 * 0.62;

  const hard    = hcpsf * 800 * units;
  const soft    = hard * 0.18;
  const landEst = p.valuation > hard ? p.valuation : hard * 0.45; // estimate land
  const preLoan = landEst + hard + soft;
  const loan    = preLoan * 0.65;
  const carry   = loan * 0.065 * 1.5;
  const total   = preLoan + carry;

  const exitCap   = cap + 0.005;
  const exitValue = noi / exitCap;
  const netProfit = exitValue - total;
  const equity    = total - loan;
  const ds        = loan * 0.065;
  const cfbt      = noi - ds;

  const irr = equity > 500 && cfbt > -equity
    ? calcIRR([-equity, cfbt, cfbt, cfbt, cfbt, cfbt + exitValue - loan])
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
    exit_value:      Math.round(exitValue),
    net_profit:      Math.round(netProfit),
    irr_v:           Math.min(Math.max(irr, -50), 100), // cap at reasonable range
    cap_on_cost:     Math.round(noi / total * 10000) / 100,
    dev_spread_pct:  Math.round(netProfit / total * 10000) / 100,
    underwritten_at: new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // STEP 1: Fetch permits from LA City
  console.log('\n=== STEP 1: Fetching permits from LA City ===');
  const url = "https://data.lacity.org/resource/t57t-h8jb.json?$order=issue_date+DESC" +
    "&$where=(permit_type='Bldg-New'+OR+permit_type='Bldg-Addition')" +
    "+AND+(latest_status='Ready+to+Issue'+OR+latest_status='Issued'+OR+latest_status='Plan+Check')";

  const records = await fetchAll(url);
  console.log('Total permits fetched:', records.length);

  // Deduplicate
  const seen = new Set();
  const unique = records.filter(r => {
    const p = String(r.pcis_permit || r.id || '');
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  console.log('Unique permits:', unique.length);

  // Sync to permits table
  let permSynced = 0;
  for (let i = 0; i < unique.length; i += 25) {
    const batch = unique.slice(i, i + 25);
    const rows = batch.map((r, j) => toPermitRow(r, i + j));
    const bseen = new Set();
    const dedup = rows.filter(r => {
      if (bseen.has(r.permit_number)) return false;
      bseen.add(r.permit_number);
      return true;
    });
    const res = await sbUpsert('permits', dedup, 'permit_number');
    if (res.status < 300) permSynced += dedup.length;
    if (i % 2500 === 0) console.log('Permits saved:', permSynced, '/', unique.length);
    await sleep(80);
  }
  console.log('Permits synced:', permSynced);

  // STEP 2: Underwrite all permits and store in sites table
  console.log('\n=== STEP 2: Underwriting permits ===');
  const permits = await sbGet(
    '/rest/v1/permits' +
    '?select=id,address,zone,units,valuation,issued_date,is_rti,permit_type,permit_subtype,lat,lng,status' +
    '&valuation=gte.50000' +
    '&address=neq.' +
    '&limit=5000' +
    '&order=issued_date.desc' +
    '&apikey=' + SB_KEY
  );
  console.log('Permits to underwrite:', permits.length);

  let siteSynced = 0;
  for (let i = 0; i < permits.length; i += 50) {
    const batch = permits.slice(i, i + 50);
    const rows = batch.map(p => ({ address: p.address, ...underwrite(p) }));
    const useen = new Set();
    const dedup = rows.filter(r => {
      const k = r.address + '|' + r.project_type;
      if (useen.has(k)) return false;
      useen.add(k);
      return true;
    });
    const res = await sbUpsert('sites', dedup, 'address,project_type');
    if (res.status < 300) siteSynced += dedup.length;
    if (i % 500 === 0) console.log('Sites underwritten:', siteSynced, '/', permits.length);
    await sleep(150);
  }

  console.log('\n=== COMPLETE ===');
  console.log('Permits synced:', permSynced);
  console.log('Sites underwritten:', siteSynced);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
