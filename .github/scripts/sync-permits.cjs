// ParceLLA - Full LA City Permit Sync
// Pulls from multiple LA City datasets to capture both small and large developments.

const https = require('https');
const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SB_URL || !SB_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

const EXCLUDE_SUBTYPE = /adu|accessory|addition/i;
const EXCLUDE_WORK = /(adu|jadu|junior adu|accessory dwelling|\baddition\b|\bremodel\b|\balteration\b|\bsupplemental\b|\bconversion\b|\bgazebo\b|\bpool\b|\bspa\b|\bshed\b|\bcarport\b|\bretaining wall\b|\bfence\b|\breroof\b|\bre-roof\b|\bsolar\b)/i;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' }, timeout: 30000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + d.slice(0,300)));
          return;
        }
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('Invalid JSON: ' + d.slice(0,300))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

function supabaseReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(SB_URL + path);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SB_KEY,
        'apikey': SB_KEY,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Supabase request timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function upsert(rows) {
  if (!rows.length) return Promise.resolve({ status: 204, body: '' });
  return supabaseReq('POST', '/rest/v1/permits?on_conflict=permit_number', rows);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function socrataUrl(dataset, params = {}) {
  const u = new URL('https://data.lacity.org/resource/' + dataset + '.json');
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u.toString();
}

async function fetchAll(baseUrl, label) {
  let all = [], offset = 0;
  while (true) {
    const u = new URL(baseUrl);
    u.searchParams.set('$limit', '1000');
    u.searchParams.set('$offset', String(offset));
    const batch = await get(u.toString());
    if (!Array.isArray(batch)) throw new Error(label + ' did not return an array');
    if (!batch.length) break;
    all = all.concat(batch);
    console.log('  ' + label + ': fetched ' + all.length + '...');
    if (batch.length < 1000) break;
    offset += 1000;
    await sleep(300);
  }
  return all;
}

async function fetchDataset(label, dataset, paramVariants) {
  const errors = [];
  for (const params of paramVariants) {
    try {
      return await fetchAll(socrataUrl(dataset, params), label);
    } catch (e) {
      errors.push(e.message);
      console.warn(label + ' fetch attempt failed:', e.message);
    }
  }
  throw new Error(errors.join(' | '));
}

function cleanDate(value) {
  return (value || '').split('T')[0] || null;
}

function cleanAddress(value) {
  return String(value || '').trim().slice(0,255);
}

function number(value) {
  return parseFloat(value || '0') || 0;
}

function integer(value) {
  return parseInt(value || '0', 10) || 0;
}

function shouldSkipSubtype(value) {
  return EXCLUDE_SUBTYPE.test(String(value || ''));
}

function shouldSkipPermit(record, textParts = []) {
  if (record?.adu_changed || record?.junior_adu) return true;
  return textParts.some(value => EXCLUDE_WORK.test(String(value || '')));
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function unitsFromText(value) {
  const text = String(value || '');
  const match = text.match(/(\d{1,3})\s*[- ]?\s*(?:unit|dwelling|apartment|affordable housing)/i);
  return match ? integer(match[1]) : 0;
}

function statusIsRti(value) {
  return /ready|approved/i.test(String(value || ''));
}

function buildModernPermitRow(r, i, fallbackPrefix) {
  const status = String(first(r.status_desc, r.status, r.project_status, 'Submitted')).slice(0,50);
  const subtype = first(r.permit_sub_type, r.permitsubtype, r.use_desc);
  const work = String(first(r.work_desc, r.work_description, '') || '').slice(0,2000);
  const permitType = first(r.permit_type, r.permittype, 'Bldg-New');
  if (!/new|bldg-new/i.test(String(permitType))) return null;
  if (shouldSkipSubtype(subtype)) return null;
  if (shouldSkipPermit(r, [subtype, r.use_desc, work])) return null;

  const units = integer(first(
    r.du_changed,
    r.of_residential_dwelling_units,
    r.number_of_units,
    r.numberofunits,
    r.units,
    r.net_units
  )) || unitsFromText(work);

  return {
    permit_number: String(first(r.permit_nbr, r.permit_number, r.permitnumber, r.pcis_permit, r.id, fallbackPrefix + '-' + i)).slice(0,100),
    permit_type: String(permitType).slice(0,100),
    permit_subtype: subtype ? String(subtype).slice(0,100) : null,
    status,
    address: cleanAddress(first(r.primary_address, r.address, r.location_address, r.project_address)),
    zone: first(r.zone, r.zoning),
    units,
    valuation: number(r.valuation),
    issued_date: cleanDate(first(r.issue_date, r.submitted_date, r.status_date, r.date, r.issued_date)),
    is_rti: statusIsRti(status),
    lat: r.lat ? parseFloat(r.lat) : (r.latitude ? parseFloat(r.latitude) : null),
    lng: r.lon ? parseFloat(r.lon) : (r.longitude ? parseFloat(r.longitude) : null),
    work_description: work || null,
    raw_data: r,
    synced_at: new Date().toISOString(),
  };
}

async function syncDataset(name, records, buildRow) {
  console.log('\n--- ' + name + ': ' + records.length + ' records ---');
  const seen = new Set();
  const rows = [];

  for (const record of records) {
    const row = buildRow(record, rows.length);
    if (!row || !row.permit_number || !row.address) continue;
    if (seen.has(row.permit_number)) continue;
    seen.add(row.permit_number);
    rows.push(row);
  }

  let synced = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const res = await upsert(batch);
    if (res.status >= 300) {
      throw new Error(name + ' upsert failed: HTTP ' + res.status + ' ' + res.body.slice(0,300));
    }
    synced += batch.length;
    await sleep(80);
  }

  console.log('Synced: ' + synced + '/' + rows.length);
  return synced;
}

async function main() {
  let total = 0;
  const failures = [];

  try {
    const where = [
      "permit_type='Bldg-New'",
      "(latest_status='Submitted' OR latest_status='Ready to Issue' OR latest_status='Approved' OR latest_status='Issued' OR latest_status='Plan Check')",
    ].join(' AND ');
    const records = await fetchAll(socrataUrl('t57t-h8jb', {
      '$order': 'issue_date DESC',
      '$where': where,
    }), 'DBS Permits');

    total += await syncDataset('DBS Permits', records, (r, i) => {
      if (shouldSkipSubtype(r.permit_sub_type)) return null;
      const addr = cleanAddress(r.address || [r.address_start, r.street_direction, r.street_name, r.street_suffix].filter(Boolean).join(' '));
      let lat = null, lng = null;
      if (r.location_1 && r.location_1.coordinates) {
        lng = r.location_1.coordinates[0];
        lat = r.location_1.coordinates[1];
      }
      return {
        permit_number: String(r.pcis_permit || r.id || 'dbs-' + i).slice(0,100),
        permit_type: r.permit_type || 'Bldg-New',
        permit_subtype: r.permit_sub_type || null,
        status: String(r.latest_status || 'Issued').slice(0,50),
        address: addr,
        zone: r.zone || null,
        units: integer(r.of_residential_dwelling_units || r.number_of_units),
        valuation: number(r.valuation),
        issued_date: cleanDate(r.issue_date),
        is_rti: /ready|approved/i.test(String(r.latest_status || '')),
        lat, lng,
        raw_data: r,
        synced_at: new Date().toISOString(),
      };
    });
  } catch (e) {
    failures.push('DBS Permits: ' + e.message);
    console.error('DBS Permits failed:', e.message);
  }

  try {
    const activeStatuses = [
      "status_desc='Submitted'",
      "status_desc='Submitted for Quality Review'",
      "status_desc='Submitted for Sprvsr Rvw'",
      "status_desc='PC Assigned'",
      "status_desc='PC in Progress'",
      "status_desc='PC Info Complete'",
      "status_desc='Corrections Issued'",
      "status_desc='Verifications in Progress'",
      "status_desc='Quality Review Completed'",
      "status_desc='Reviewed by Supervisor'",
      "status_desc='Plans on Hold'",
      "status_desc='Not Ready to Issue'",
      "status_desc='PC Approved'",
      "status_desc='Ready to Issue'",
    ].join(' OR ');
    const records = await fetchAll(socrataUrl('gwh9-jnip', {
      '$order': 'submitted_date DESC',
      '$where': "permit_type='Bldg-New' AND (" + activeStatuses + ")",
    }), 'Current Submitted Building Permits');

    total += await syncDataset('Current Submitted Building Permits', records, (r, i) =>
      buildModernPermitRow(r, i, 'submitted')
    );
  } catch (e) {
    failures.push('Current Submitted Building Permits: ' + e.message);
    console.error('Current Submitted Building Permits failed:', e.message);
  }

  try {
    const records = await fetchAll(socrataUrl('pi9x-tg5x', {
      '$order': 'issue_date DESC',
      '$where': "permit_type='Bldg-New'",
    }), 'Current Issued Building Permits');

    total += await syncDataset('Current Issued Building Permits', records, (r, i) =>
      buildModernPermitRow(r, i, 'issued')
    );
  } catch (e) {
    failures.push('Current Issued Building Permits: ' + e.message);
    console.error('Current Issued Building Permits failed:', e.message);
  }

  try {
    const records = await fetchDataset('New Housing Units', 'cpkv-aajs', [
      { '$order': 'date DESC' },
      { '$order': 'issued_date DESC' },
      {},
    ]);

    total += await syncDataset('New Housing Units', records, (r, i) => {
      const units = integer(r.units || r.net_units || r.number_of_units);
      return {
        permit_number: String(r.permit_number || r.id || 'hu-' + i).slice(0,100),
        permit_type: 'Bldg-New',
        permit_subtype: units <= 1 ? 'New House' : 'Multifamily',
        status: String(r.status || r.project_status || 'Issued').slice(0,50),
        address: cleanAddress(r.address || r.location_address || r.project_address),
        zone: r.zoning || r.zone || null,
        units,
        valuation: number(r.valuation),
        issued_date: cleanDate(r.date || r.issued_date),
        is_rti: false,
        lat: r.latitude ? parseFloat(r.latitude) : null,
        lng: r.longitude ? parseFloat(r.longitude) : null,
        raw_data: r,
        synced_at: new Date().toISOString(),
      };
    });
  } catch (e) {
    failures.push('New Housing Units: ' + e.message);
    console.error('New Housing Units failed:', e.message);
  }

  try {
    const records = await fetchDataset('Building Permits Official', '6q2s-9pnn', [
      { '$order': 'permitissuancedate DESC' },
      { '$order': 'issue_date DESC' },
      {},
    ]);

    total += await syncDataset('Building Permits Official', records, (r, i) => {
      if (shouldSkipSubtype(r.permitsubtype)) return null;
      const permitType = r.permittype || 'Bldg-New';
      if (!/new|bldg-new/i.test(permitType)) return null;
      return {
        permit_number: String(r.permitnumber || r.pcisid || 'bp-' + i).slice(0,100),
        permit_type: permitType,
        permit_subtype: r.permitsubtype || null,
        status: String(r.permitstatus || 'Issued').slice(0,50),
        address: cleanAddress(r.address),
        zone: r.zone || null,
        units: integer(r.numberofunits),
        valuation: number(r.valuation),
        issued_date: cleanDate(r.permitissuancedate),
        is_rti: /ready|approved/i.test(String(r.permitstatus || '')),
        lat: null,
        lng: null,
        raw_data: r,
        synced_at: new Date().toISOString(),
      };
    });
  } catch (e) {
    failures.push('Building Permits Official: ' + e.message);
    console.error('Building Permits Official failed:', e.message);
  }

  if (total === 0) {
    throw new Error('Permit sync completed with zero records: ' + failures.join(' | '));
  }
  if (failures.length) {
    console.warn('Permit sync completed with optional dataset warning(s): ' + failures.join(' | '));
  }

  console.log('\n=== TOTAL SYNCED: ' + total + ' ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
