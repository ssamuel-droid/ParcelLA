// ParceLLA - optional owner/sale enrichment.
// Uses Regrid when REGRID_API_KEY or REGRID_TOKEN is present. If the key or
// owner cache columns are missing, this script logs and exits successfully.

const https = require('https');

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const REGRID_TOKEN = process.env.REGRID_API_KEY || process.env.REGRID_TOKEN;
const REGRID_BASE = 'https://app.regrid.com/api/v2/parcels';
const REGRID_LA_PATH = '/us/ca/los-angeles';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function clean(value) {
  const text = String(value ?? '').trim();
  return text && text !== '0' && text.toLowerCase() !== 'null' ? text : '';
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

function normalizeRegrid(feature) {
  const p = feature?.properties || {};
  const fields = p.fields && typeof p.fields === 'object' ? p.fields : p;
  const enhancedRows = Array.isArray(p.enhanced_ownership)
    ? p.enhanced_ownership
    : (p.enhanced_ownership || p.enhancedOwnership ? [p.enhanced_ownership || p.enhancedOwnership] : []);
  const ownerName = [...new Set([
    fields.owner,
    fields.owner1,
    fields.owner_1,
    fields.owner_name,
    fields.ownername,
    ...enhancedRows.flatMap(row => [row.eo_owner, row.eo_owner2, row.eo_owner3, row.eo_owner4]),
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

async function lookupOwner(site) {
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
        throw new Error(`Regrid rejected REGRID_API_KEY (${e.message}). Replace it before rerunning owner enrichment.`);
      }
    }
  }
  return null;
}

async function main() {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  if (!REGRID_TOKEN) {
    console.log('[owners] REGRID_API_KEY not set; skipping owner/sale enrichment.');
    return;
  }

  const sites = await requestJson(
    'GET',
    `${SB_URL}/rest/v1/sites?select=id,address,lat,lng,apn,owner_enriched_at&order=owner_enriched_at.asc.nullsfirst,updated_at.desc&limit=300`,
    null,
    sbHeaders()
  );
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

main().catch(err => {
  console.error('[owners] Fatal:', err.message);
  process.exit(1);
});
