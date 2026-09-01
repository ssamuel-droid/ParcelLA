// ParceLLA - optional owner/sale enrichment.
// Uses Regrid first and RentCast as a countywide fallback. If neither key is
// configured, the job logs and exits successfully.

const https = require('https');

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const REGRID_TOKEN = process.env.REGRID_API_KEY || process.env.REGRID_TOKEN;
const RENTCAST_KEY = process.env.RENTCAST_API_KEY;
const REGRID_BASE = 'https://app.regrid.com/api/v2/parcels';
const REGRID_LA_PATH = '/us/ca/los-angeles';
const RENTCAST_BASE = 'https://api.rentcast.io/v1/properties';
const ENRICH_LIMIT = Math.max(0, Number.parseInt(process.env.OWNER_ENRICH_LIMIT || '25', 10) || 25);
const STALE_DAYS = Math.max(1, Number.parseInt(process.env.OWNER_ENRICH_STALE_DAYS || '30', 10) || 30);
const RENTCAST_BULK_ENABLED = /^(1|true|yes)$/i.test(process.env.RENTCAST_BULK_OWNER_ENABLED || '');
let regridAuthRejected = false;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function clean(value) {
  if (value !== null && typeof value === 'object') return '';
  const text = String(value ?? '').trim();
  return text && text !== '0' && text.toLowerCase() !== 'null' ? text : '';
}

function ownerNameParts(value) {
  if (Array.isArray(value)) return value.flatMap(ownerNameParts);
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') {
    const text = clean(value);
    return text && text !== '[object Object]' ? [text] : [];
  }

  const named = [
    value.fullName,
    value.name,
    value.ownerName,
    value.companyName,
    value.organizationName,
    value.entityName,
  ].map(clean).filter(Boolean);
  if (named.length) return named;

  const person = [value.firstName, value.middleName, value.lastName]
    .map(clean)
    .filter(Boolean)
    .join(' ');
  return person ? [person] : [];
}

function latestRentCastSale(record) {
  const history = record?.history;
  if (!history || typeof history !== 'object' || Array.isArray(history)) return null;
  return Object.values(history)
    .filter(row => row && typeof row === 'object' && (!row.event || /sale/i.test(row.event)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function money(value) {
  const n = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function cleanDate(value) {
  const text = clean(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text ? text.slice(0, 10) : null;
}

function requestJson(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = d ? JSON.parse(d) : null; } catch {}
        if (res.statusCode >= 300) {
          const msg = parsed?.message || parsed?.error || d.slice(0, 300);
          const error = new Error(`HTTP ${res.statusCode}: ${msg}`);
          error.status = res.statusCode;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sbHeaders(prefer = '') {
  return {
    Authorization: `Bearer ${SB_KEY}`,
    apikey: SB_KEY,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function regridFeature(data) {
  const features = data?.parcels?.features || data?.features || [];
  return Array.isArray(features) ? features[0] : null;
}

function enhancedOwnershipRows(properties = {}) {
  const value = properties.enhanced_ownership
    ?? properties.enhancedOwnership
    ?? properties.enhanced_owners
    ?? properties.enhancedOwners;
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (Object.keys(value).some(key => /^eo_/i.test(key)) ? [value] : Object.values(value))
      : [];
  return rows
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map(row => row.fields && typeof row.fields === 'object' ? { ...row.fields, ...row } : row);
}

function normalizeRegrid(feature) {
  const p = feature?.properties || {};
  const fields = p.fields && typeof p.fields === 'object' ? p.fields : p;
  const enhancedRows = enhancedOwnershipRows(p);
  const ownerName = [...new Set([
    fields.owner,
    fields.owner1,
    fields.owner_1,
    fields.owner_name,
    fields.ownername,
    fields.unmodified_owner,
    fields.owner2,
    fields.owner3,
    fields.owner4,
    [fields.ownfrst, fields.ownlast].map(clean).filter(Boolean).join(' '),
    ...enhancedRows.flatMap(row => [
      row.eo_owner,
      row.eo_owner2,
      row.eo_owner3,
      row.eo_owner4,
      row.eo_deedowner,
      row.eo_deedowner2,
      row.eo_deedowner3,
      row.eo_deedowner4,
      [row.eo_ownerfirst, row.eo_ownermiddle, row.eo_ownerlast].map(clean).filter(Boolean).join(' '),
      [row.eo_deedownerfirst, row.eo_deedownermiddle, row.eo_deedownerlast].map(clean).filter(Boolean).join(' '),
    ]),
  ].map(clean).filter(Boolean))].join(' / ');
  const saleDate = cleanDate(first(
    fields.saledate,
    fields.sale_date,
    fields.last_sale_date,
    fields.lastsaledate,
    fields.recordingdate,
    fields.recording_date
  ));
  const saleAmount = money(first(
    fields.saleprice,
    fields.sale_price,
    fields.last_sale_price,
    fields.lastsaleprice,
    fields.last_sale_amount,
    fields.saleamt
  ));
  return ownerName || saleDate || saleAmount ? {
    owner_name: ownerName || null,
    owner_last_sale_date: saleDate,
    owner_last_sale_amount: saleAmount,
    owner_source: 'Regrid Parcel API',
    owner_enriched_at: new Date().toISOString(),
  } : null;
}

function normalizeRentCast(record) {
  const names = [...new Set([
    ...ownerNameParts(record?.owner?.names),
    ...ownerNameParts(record?.ownerName),
    ...ownerNameParts(record?.ownerNames),
  ])];
  const latestSale = latestRentCastSale(record);
  const ownerName = first(
    names.join(' / '),
    typeof record?.owner === 'string' ? record.owner : null,
    record?.owner1,
    record?.owner_name
  );
  const saleDate = cleanDate(first(
    record?.lastSaleDate,
    record?.lastSoldDate,
    record?.saleDate,
    record?.saleHistory?.[0]?.date,
    record?.saleHistory?.[0]?.saleDate,
    latestSale?.date
  ));
  const saleAmount = money(first(
    record?.lastSalePrice,
    record?.lastSoldPrice,
    record?.salePrice,
    record?.saleHistory?.[0]?.price,
    record?.saleHistory?.[0]?.salePrice,
    latestSale?.price
  ));
  return ownerName || saleDate || saleAmount ? {
    owner_name: ownerName || null,
    owner_last_sale_date: saleDate,
    owner_last_sale_amount: saleAmount,
    owner_source: 'RentCast property records',
    owner_enriched_at: new Date().toISOString(),
  } : null;
}

async function lookupRegrid(site) {
  if (!REGRID_TOKEN || regridAuthRejected) return null;
  const attempts = [];
  const lat = Number(site.lat);
  const lng = Number(site.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const u = new URL(`${REGRID_BASE}/point`);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('radius', '150');
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', REGRID_TOKEN);
    attempts.push(u.toString());
  }
  if (clean(site.address)) {
    const u = new URL(`${REGRID_BASE}/address`);
    u.searchParams.set('query', clean(site.address));
    u.searchParams.set('path', REGRID_LA_PATH);
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', REGRID_TOKEN);
    attempts.push(u.toString());
  }
  if (clean(site.apn)) {
    const u = new URL(`${REGRID_BASE}/apn`);
    u.searchParams.set('parcelnumb', clean(site.apn));
    u.searchParams.set('path', REGRID_LA_PATH);
    u.searchParams.set('limit', '1');
    u.searchParams.set('return_geometry', 'false');
    u.searchParams.set('return_custom', 'true');
    u.searchParams.set('return_enhanced_ownership', 'true');
    u.searchParams.set('token', REGRID_TOKEN);
    attempts.push(u.toString());
  }

  for (const url of attempts) {
    try {
      const data = await requestJson('GET', url);
      const owner = normalizeRegrid(regridFeature(data));
      if (owner) return owner;
    } catch (e) {
      console.warn(`[owners] Lookup failed for ${site.address}: ${e.message}`);
      if (e.status === 401 || e.status === 403) {
        regridAuthRejected = true;
        console.warn('[owners] Regrid rejected REGRID_API_KEY; disabling Regrid for this run and using RentCast when configured.');
        break;
      }
    }
  }
  return null;
}

async function lookupRentCast(site) {
  const address = clean(site.address);
  if (!RENTCAST_KEY || !address) return null;
  const url = new URL(RENTCAST_BASE);
  url.searchParams.set('address', /\bCA\b|CALIFORNIA/i.test(address)
    ? address
    : `${address}, Los Angeles, CA`);
  url.searchParams.set('limit', '1');
  try {
    const data = await requestJson('GET', url.toString(), null, { 'X-Api-Key': RENTCAST_KEY });
    const record = Array.isArray(data) ? data[0] : data?.properties?.[0] || data?.data?.[0];
    return record ? normalizeRentCast(record) : null;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new Error(`RentCast rejected RENTCAST_API_KEY (${e.message}). Replace it before rerunning owner enrichment.`);
    }
    console.warn(`[owners] RentCast lookup failed for ${site.address}: ${e.message}`);
    return null;
  }
}

async function lookupOwner(site) {
  const regrid = await lookupRegrid(site);
  if (regrid) return regrid;
  return RENTCAST_BULK_ENABLED ? lookupRentCast(site) : null;
}

async function main() {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  if (!REGRID_TOKEN && !RENTCAST_KEY) {
    console.log('[owners] No ownership provider key set; add REGRID_API_KEY or RENTCAST_API_KEY.');
    return;
  }
  console.log(`[owners] Providers: Regrid ${REGRID_TOKEN ? 'configured' : 'not configured'}; RentCast ${RENTCAST_KEY ? (RENTCAST_BULK_ENABLED ? 'enabled' : 'configured but bulk-disabled') : 'not configured'}.`);
  console.log(`[owners] Guardrails: at most ${ENRICH_LIMIT} stale properties; no-match cooldown ${STALE_DAYS} days.`);

  const corrupted = await requestJson(
    'GET',
    `${SB_URL}/rest/v1/sites?select=id,address,lat,lng,apn,owner_enriched_at&owner_name=eq.${encodeURIComponent('[object Object]')}&order=updated_at.desc&limit=${ENRICH_LIMIT}`,
    null,
    sbHeaders()
  );
  const remaining = Math.max(0, ENRICH_LIMIT - (Array.isArray(corrupted) ? corrupted.length : 0));
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const pendingFilter = encodeURIComponent(`(owner_enriched_at.is.null,owner_enriched_at.lt.${staleBefore})`);
  const pending = remaining ? await requestJson(
    'GET',
    `${SB_URL}/rest/v1/sites?select=id,address,lat,lng,apn,owner_enriched_at&owner_name=is.null&or=${pendingFilter}&order=owner_enriched_at.asc.nullsfirst,updated_at.desc&limit=${remaining}`,
    null,
    sbHeaders()
  ) : [];
  const sites = [...(Array.isArray(corrupted) ? corrupted : []), ...(Array.isArray(pending) ? pending : [])];
  if (!Array.isArray(sites) || !sites.length) {
    console.log('[owners] No sites returned for enrichment.');
    return;
  }

  let updated = 0;
  let misses = 0;
  let columnWarningShown = false;
  for (const site of sites) {
    const owner = await lookupOwner(site);
    if (!owner) {
      misses++;
      try {
        await requestJson(
          'PATCH',
          `${SB_URL}/rest/v1/sites?id=eq.${encodeURIComponent(site.id)}`,
          { owner_enriched_at: new Date().toISOString() },
          sbHeaders('return=minimal')
        );
      } catch (e) {
        console.warn(`[owners] Could not record no-match check for ${site.address}: ${e.message}`);
      }
      await sleep(120);
      continue;
    }
    try {
      await requestJson(
        'PATCH',
        `${SB_URL}/rest/v1/sites?id=eq.${encodeURIComponent(site.id)}`,
        owner,
        sbHeaders('return=minimal')
      );
      updated++;
    } catch (e) {
      if (!columnWarningShown && /column|schema|owner_/i.test(e.message)) {
        console.warn('[owners] Owner cache columns are missing. Run supabase/migrations/007_owner_sale_fields.sql, then rerun this workflow.');
        columnWarningShown = true;
      } else {
        console.warn(`[owners] Update failed for ${site.address}: ${e.message}`);
      }
    }
    await sleep(120);
  }

  console.log(`[owners] Complete. Updated ${updated}; no match ${misses}.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[owners] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { normalizeRegrid, normalizeRentCast, ownerNameParts, latestRentCastSale };
