// ParceLLA — Full LA City Permit Sync
// Pulls large multifamily new construction only (20+ units, no ADU, no remodels)

const https = require('https');
const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(d));
        else reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0,200)));
      });
    }).on('error', reject);
  });
}

function upsert(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const u = new URL(SB_URL + '/rest/v1/permits?on_conflict=permit_number');
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

async function fetchAll(baseUrl) {
  let all = [], offset = 0;
  while (true) {
    const batch = await get(baseUrl + '&$limit=1000&$offset=' + offset);
    if (!batch.length) break;
    all = all.concat(batch);
    console.log('  fetched ' + all.length + '...');
    if (batch.length < 1000) break;
    offset += 1000;
    await sleep(300);
  }
  return all;
}

async function syncDataset(name, records, buildRow) {
  console.log('\n--- ' + name + ': ' + records.length + ' records ---');
  const seen = new Set();
  const unique = records.filter(r => {
    const k = buildRow(r, 0).permit_number;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  let synced = 0;
  for (let i = 0; i < unique.length; i += 25) {
    const batch = unique.slice(i, i + 25);
    const bseen = new Set();
    const rows = batch.map((r, j) => buildRow(r, i+j)).filter(r => {
      if (bseen.has(r.permit_number)) return false;
      bseen.add(r.permit_number); return true;
    });
    const res = await upsert(rows);
    if (res.status < 300) synced += rows.length;
    else console.log('  upsert error:', res.status, res.body.slice(0,100));
    await sleep(80);
  }
  console.log('Synced: ' + synced + '/' + unique.length);
  return synced;
}

// ── Exclusion keywords — work_description patterns to drop ──────────────────
const EXCLUDE_DESC = /\b(ADU|accessory.dwelling|remodel|alteration|addition|conversion|repair|reroof|solar|HVAC|plumbing|electrical|tenant.improv|TI\b|retrofit|seismic)/i;
const EXCLUDE_SUBTYPE = /ADU|Accessory Dwelling|Addition|Alter|Repair|1 or 2 Family/i;

async function main() {
  let total = 0;

  // ── Dataset 1: DBS Permits (t57t-h8jb) ──────────────────────────────────
  // Single $where clause (Socrata only honours one) — filter server-side for
  // Bldg-New + multifamily, then filter client-side for 20+ units & no ADU
  try {
    console.log('\nFetching DBS Permits (t57t-h8jb)...');
    const raw = await fetchAll(
      'https://data.lacity.org/resource/t57t-h8jb.json?$order=issue_date DESC' +
      '&$where=permit_type=\'Bldg-New\'' +
      ' AND of_residential_dwelling_units >= 20'
    );
    // Client-side filter: drop ADUs, remodels, additions
    const records = raw.filter(r => {
      if (EXCLUDE_SUBTYPE.test(r.permit_sub_type || '')) return false;
      if (EXCLUDE_DESC.test(r.work_description || '')) return false;
      return true;
    });
    console.log('After filtering: ' + records.length + ' qualifying records');

    total += await syncDataset('DBS Permits', records, (r, i) => {
      const addr = [r.address_start, r.street_direction, r.street_name, r.street_suffix]
        .filter(Boolean).join(' ').trim() || r.address || '';
      const units = parseInt(r.of_residential_dwelling_units || '0') || 0;
      let lat = null, lng = null;
      if (r.location_1?.coordinates) { lng = r.location_1.coordinates[0]; lat = r.location_1.coordinates[1]; }
      return {
        permit_number: String(r.pcis_permit || r.id || 'dbs-'+i).slice(0,100),
        permit_type: 'Bldg-New',
        permit_subtype: r.permit_sub_type || null,
        status: String(r.latest_status || 'Issued').slice(0,50),
        address: addr.slice(0,255), zone: r.zone || null,
        units, valuation: parseFloat(r.valuation||'0')||0,
        issued_date: (r.issue_date||'').split('T')[0]||null,
        is_rti: (r.latest_status||'').toLowerCase().includes('ready'),
        lat, lng, raw_data: r, synced_at: new Date().toISOString(),
      };
    });
  } catch(e) { console.log('DBS Permits failed:', e.message); }

  // ── Dataset 2: cpkv-aajs — New Housing Units ─────────────────────────────
  // This dataset tracks net new units added per project. Field names confirmed
  // by LA Open Data portal: net_units, project_status, address, latitude, longitude
  try {
    console.log('\nFetching New Housing Units (cpkv-aajs)...');
    const raw = await fetchAll(
      'https://data.lacity.org/resource/cpkv-aajs.json?$order=date_application DESC' +
      '&$where=net_units >= 20'
    );
    // Peek at first record to log actual field names (helps debug)
    if (raw.length > 0) console.log('  Sample record keys:', Object.keys(raw[0]).join(', '));

    const records = raw.filter(r => {
      if (EXCLUDE_DESC.test(r.work_description || r.description || '')) return false;
      return true;
    });
    console.log('After filtering: ' + records.length + ' qualifying records');

    total += await syncDataset('New Housing Units', records, (r, i) => {
      // Try every plausible field name for units
      const units = parseInt(r.net_units || r.units || r.number_of_units || r.total_units || '0') || 0;
      const addr = String(r.address || r.location_address || r.project_address || '').slice(0,255);
      const issued = (r.date_issued || r.date_application || r.date || r.issued_date || '').split('T')[0] || null;
      return {
        permit_number: String(r.permit_number || r.case_number || r.id || 'hu-'+i).slice(0,100),
        permit_type: 'Bldg-New',
        permit_subtype: 'Multifamily',
        status: String(r.status || r.project_status || 'Issued').slice(0,50),
        address: addr, zone: r.zoning || r.zone || null,
        units, valuation: parseFloat(r.valuation||'0')||0,
        issued_date: issued,
        is_rti: false,
        lat: r.latitude ? parseFloat(r.latitude) : null,
        lng: r.longitude ? parseFloat(r.longitude) : null,
        raw_data: r, synced_at: new Date().toISOString(),
      };
    });
  } catch(e) { console.log('New Housing Units failed:', e.message); }

  console.log('\n=== TOTAL SYNCED: ' + total + ' ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
