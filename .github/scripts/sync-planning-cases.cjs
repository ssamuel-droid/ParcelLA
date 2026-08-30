// ParcelLA automated City Planning case and PDIS document discovery.

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const DOCUMENT_CASE_LIMIT = positiveInt(process.env.PLANNING_DOCUMENT_CASE_LIMIT, 75);
const DOCUMENT_STALE_DAYS = positiveInt(process.env.PLANNING_DOCUMENT_STALE_DAYS, 30);
const DOCUMENT_CONCURRENCY = positiveInt(process.env.PLANNING_DOCUMENT_CONCURRENCY, 4);

const FILINGS_LAYER = 'https://services1.arcgis.com/tzwalEyxl2rpamKs/arcgis/rest/services/New_PCTS_Case_Filings_Updated_All/FeatureServer/0';
const COMPLETED_LAYER = 'https://services1.arcgis.com/tzwalEyxl2rpamKs/arcgis/rest/services/BiWeekly_Cases_Archived/FeatureServer/0';
const PDIS_BASE = 'https://planning.lacity.gov/pdiscaseinfo';

if (require.main === module && (!SB_URL || !SB_KEY)) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value || '', 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && text.toLowerCase() !== 'null' ? text : '';
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanApn(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : '';
}

function cleanDate(value) {
  if (!value) return null;
  if (typeof value === 'number' && value > 100000000000) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const text = clean(value);
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeAddress(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\bLOS ANGELES\b|\bCALIFORNIA\b/g, ' ')
    .replace(/\bCA\b/g, ' ')
    .replace(/\b9\d{4}(?:-\d{4})?\b/g, ' ')
    .replace(/\bSTREET\b/g, ' ST ')
    .replace(/\bAVENUE\b/g, ' AVE ')
    .replace(/\bBOULEVARD\b/g, ' BLVD ')
    .replace(/\bDRIVE\b/g, ' DR ')
    .replace(/\bROAD\b/g, ' RD ')
    .replace(/\bPLACE\b/g, ' PL ')
    .replace(/\bLANE\b/g, ' LN ')
    .replace(/\bCOURT\b/g, ' CT ')
    .replace(/\bPARKWAY\b/g, ' PKWY ')
    .replace(/\bHIGHWAY\b/g, ' HWY ')
    .replace(/\bNORTH\b/g, ' N ')
    .replace(/\bSOUTH\b/g, ' S ')
    .replace(/\bEAST\b/g, ' E ')
    .replace(/\bWEST\b/g, ' W ')
    .replace(/\b(?:UNIT|STE|SUITE|APT|APARTMENT)\s+[A-Z0-9-]+.*$/g, ' ')
    .replace(/[^A-Z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressKeys(value) {
  const normalized = normalizeAddress(value);
  if (!normalized) return [];
  const keys = new Set([normalized]);
  const range = normalized.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (range) {
    keys.add(`${range[1]} ${range[3]}`);
    keys.add(`${range[2]} ${range[3]}`);
  }
  return [...keys];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchJson(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 45000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ParcelLA/3.0 planning case sync',
          ...(options.headers || {}),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function supabase(method, path, body = null, prefer = 'return=minimal,resolution=merge-duplicates') {
  const response = await fetch(`${SB_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SB_KEY}`,
      apikey: SB_KEY,
      Prefer: prefer,
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchArcgisFeatures(layer, label) {
  const rows = [];
  let offset = 0;
  const pageSize = 2000;
  while (true) {
    const query = new URL(`${layer}/query`);
    query.searchParams.set('where', '1=1');
    query.searchParams.set('outFields', '*');
    query.searchParams.set('returnGeometry', 'true');
    query.searchParams.set('outSR', '4326');
    query.searchParams.set('resultOffset', String(offset));
    query.searchParams.set('resultRecordCount', String(pageSize));
    query.searchParams.set('orderByFields', 'OBJECTID ASC');
    query.searchParams.set('f', 'json');
    const payload = await fetchJson(query.toString());
    if (payload?.error) throw new Error(`${label}: ${payload.error.message || JSON.stringify(payload.error)}`);
    const page = array(payload?.features);
    rows.push(...page);
    console.log(`[planning] ${label}: fetched ${rows.length}`);
    if (page.length < pageSize) break;
    offset += page.length;
    await sleep(150);
  }
  return rows;
}

function filingCase(feature) {
  const a = feature?.attributes || {};
  const caseNumber = clean(a.USER_CaseNumber).toUpperCase();
  if (!caseNumber) return null;
  return {
    case_number: caseNumber,
    case_id: number(a.USER_CaseID),
    apn: cleanApn(a.User_fld) || null,
    address: clean(a.USER_Address || a.Match_addr || a.IN_SingleLine) || null,
    address_normalized: normalizeAddress(a.USER_Address || a.Match_addr || a.IN_SingleLine) || null,
    neighborhood_council: clean(a.USER_NeighborhoodCouncil) || null,
    community_plan_area: clean(a.USER_CommunityPlanArea) || null,
    council_district: number(a.USER_CouncilDist),
    project_description: clean(a.USER_ProjectDescription) || null,
    request_type: clean(a.USER_RequestType) || null,
    application_date: cleanDate(a.USER_AppDate),
    completion_date: null,
    case_status: 'filed',
    pdis_url: `${PDIS_BASE}/search/casenumber/${encodeURIComponent(caseNumber)}`,
    related_case_numbers: [],
    source_record: { filing: a },
    lat: number(feature?.geometry?.y),
    lng: number(feature?.geometry?.x),
    synced_at: new Date().toISOString(),
  };
}

function completedCase(feature) {
  const a = feature?.attributes || {};
  const caseNumber = clean(a.CaseNumber || a.CASE_NUM).toUpperCase();
  if (!caseNumber) return null;
  return {
    case_number: caseNumber,
    case_id: number(a.CaseID || a.CASE_ID),
    apn: cleanApn(a.APN || a.Field) || null,
    address: clean(a.Address) || null,
    address_normalized: normalizeAddress(a.Address) || null,
    neighborhood_council: clean(a.NeighborhoodCouncil) || null,
    community_plan_area: clean(a.CommunityPlanArea) || null,
    council_district: number(a.CouncilDist),
    project_description: clean(a.ProjectDescription) || null,
    request_type: clean(a.RequestType) || null,
    application_date: cleanDate(a.AppDate),
    completion_date: cleanDate(a.CompletionDate),
    case_status: 'completed',
    pdis_url: `${PDIS_BASE}/search/casenumber/${encodeURIComponent(caseNumber)}`,
    related_case_numbers: [],
    source_record: { completed: a },
    lat: number(feature?.geometry?.y),
    lng: number(feature?.geometry?.x),
    synced_at: new Date().toISOString(),
  };
}

function mergeCases(filings, completed) {
  const byNumber = new Map();
  for (const row of [...filings, ...completed].filter(Boolean)) {
    const previous = byNumber.get(row.case_number);
    if (!previous) {
      byNumber.set(row.case_number, row);
      continue;
    }
    const prefer = row.case_status === 'completed' ? row : previous;
    const fallback = prefer === row ? previous : row;
    byNumber.set(row.case_number, {
      ...fallback,
      ...prefer,
      apn: prefer.apn || fallback.apn || null,
      case_id: prefer.case_id || fallback.case_id || null,
      address: prefer.address || fallback.address || null,
      address_normalized: prefer.address_normalized || fallback.address_normalized || null,
      application_date: prefer.application_date || fallback.application_date || null,
      source_record: { ...(fallback.source_record || {}), ...(prefer.source_record || {}) },
    });
  }
  return [...byNumber.values()];
}

async function fetchAllSupabase(table, select, order = 'id.asc') {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const path = `/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}&limit=${pageSize}&offset=${offset}`;
    const page = await supabase('GET', path, null, 'count=none');
    rows.push(...array(page));
    if (!page || page.length < pageSize) break;
  }
  return rows;
}

async function upsertChunks(table, conflict, rows, size = 250) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    await supabase('POST', `/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, chunk);
  }
}

function firstNested(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      const value = clean(source[key]);
      if (value) return value;
    }
  }
  return '';
}

function siteApns(site) {
  const raw = site.raw_permit_data || {};
  const external = site.external_property_record || {};
  const candidates = [
    firstNested(raw, ['apn', 'ain', 'parcel_number', 'parcelNumber', 'assessor_parcel_number']),
    firstNested(external, ['apn', 'ain', 'parcelNumber', 'assessorParcelNumber']),
    firstNested(raw.raw_data, ['apn', 'ain', 'parcel_number', 'parcelNumber']),
  ];
  const book = firstNested(raw, ['assessor_book', 'book']);
  const page = firstNested(raw, ['assessor_page', 'page']);
  const parcel = firstNested(raw, ['assessor_parcel', 'parcel']);
  if (book && page && parcel) candidates.push(`${book}${page}${parcel}`);
  return [...new Set(candidates.map(cleanApn).filter(Boolean))];
}

function siteAddressKeys(site) {
  const raw = site.raw_permit_data || {};
  const aliases = [
    ...array(raw.address_aliases),
    ...array(raw.project_addresses),
    raw.primary_address,
    raw.location_address,
  ];
  return [...new Set([site.address, ...aliases].flatMap(addressKeys).filter(Boolean))];
}

function buildMatches(cases, sites) {
  const sitesByApn = new Map();
  const sitesByAddress = new Map();
  for (const site of sites) {
    for (const apn of siteApns(site)) {
      if (!sitesByApn.has(apn)) sitesByApn.set(apn, []);
      sitesByApn.get(apn).push(site.id);
    }
    for (const key of siteAddressKeys(site)) {
      if (!sitesByAddress.has(key)) sitesByAddress.set(key, []);
      sitesByAddress.get(key).push(site.id);
    }
  }

  const matches = new Map();
  for (const planningCase of cases) {
    const candidates = [];
    if (planningCase.apn && sitesByApn.has(planningCase.apn)) {
      for (const siteId of sitesByApn.get(planningCase.apn)) candidates.push({ siteId, method: 'apn', confidence: 1 });
    }
    if (!candidates.length) {
      for (const key of addressKeys(planningCase.address)) {
        for (const siteId of sitesByAddress.get(key) || []) candidates.push({ siteId, method: 'address_alias', confidence: 0.98 });
      }
    }
    for (const candidate of candidates) {
      const key = `${candidate.siteId}|${planningCase.case_number}`;
      const previous = matches.get(key);
      if (!previous || candidate.confidence > previous.match_confidence) {
        matches.set(key, {
          site_id: candidate.siteId,
          case_number: planningCase.case_number,
          match_method: candidate.method,
          match_confidence: candidate.confidence,
          is_primary: false,
          matched_at: new Date().toISOString(),
        });
      }
    }
  }

  const casesByNumber = new Map(cases.map(row => [row.case_number, row]));
  const grouped = new Map();
  for (const match of matches.values()) {
    if (!grouped.has(match.site_id)) grouped.set(match.site_id, []);
    grouped.get(match.site_id).push(match);
  }
  for (const rows of grouped.values()) {
    rows.sort((left, right) => {
      const a = casesByNumber.get(left.case_number);
      const b = casesByNumber.get(right.case_number);
      return String(b?.completion_date || b?.application_date || '').localeCompare(String(a?.completion_date || a?.application_date || ''));
    });
    if (rows[0]) rows[0].is_primary = true;
  }
  return [...matches.values()];
}

function classifyDocument(record) {
  const text = [record.DocType, record.DocumentCategory, record.OriginalZaCardNumber, record.Comments]
    .map(clean).join(' ').toLowerCase();
  if (/determination|decision|letter of determination|findings/.test(text)) return 'determination';
  if (/cover sheet|title sheet|cover page/.test(text)) return 'cover_sheet';
  if (/floor plan/.test(text)) return 'floor_plan';
  if (/elevation/.test(text)) return 'elevation';
  if (/site plan/.test(text)) return 'site_plan';
  if (/architectural|project plan|approved plan|plan set|parcel map|plot plan/.test(text)) return 'project_plans';
  if (/application/.test(text)) return 'application';
  return 'other';
}

function planningDocument(record, section) {
  const providerId = clean(record.Id || record.TpId || record.EncodedId);
  const caseNumber = clean(record.CaseNumber || record.MeetingId).toUpperCase();
  const url = clean(record.ExternalUrl);
  if (!providerId || !caseNumber || !/^https:\/\//i.test(url)) return null;
  const comments = clean(record.Comments);
  const baseTitle = clean(record.DocType || record.OriginalZaCardNumber || record.DocumentCategory) || 'Planning document';
  return {
    case_number: caseNumber,
    provider_document_id: providerId,
    title: comments && comments.length <= 120 ? `${baseTitle}: ${comments}` : baseTitle,
    document_type: classifyDocument(record),
    document_category: clean(record.DocumentCategory) || null,
    section,
    document_date: cleanDate(record.ScanDate || record.DateModified),
    url,
    comments: comments || null,
    is_approved_plan: clean(record.IsApprovedPlan) ? /^yes$/i.test(clean(record.IsApprovedPlan)) : null,
    source_record: record,
    synced_at: new Date().toISOString(),
  };
}

async function fetchPdisCase(planningCase) {
  const approvedUrl = `${PDIS_BASE}/api/Service/GetPddData?caseNumbers=${encodeURIComponent(planningCase.case_number)}`;
  const initialUrl = planningCase.case_id
    ? `${PDIS_BASE}/api/Service/GetEsubmitData/${encodeURIComponent(planningCase.case_id)}`
    : null;
  const relatedUrl = planningCase.case_id
    ? `${PDIS_BASE}/api/Service/relatedcases/${encodeURIComponent(planningCase.case_id)}`
    : null;
  const addressesUrl = planningCase.case_id
    ? `${PDIS_BASE}/api/Service/addresses/${encodeURIComponent(planningCase.case_id)}`
    : null;
  const requests = [fetchJson(approvedUrl, { timeout: 35000 })];
  if (initialUrl) requests.push(fetchJson(initialUrl, { timeout: 35000 }));
  if (relatedUrl) requests.push(fetchJson(relatedUrl, { timeout: 35000 }, 1));
  if (addressesUrl) requests.push(fetchJson(addressesUrl, { timeout: 35000 }, 1));
  const results = await Promise.allSettled(requests);
  if (results[0].status !== 'fulfilled' || (initialUrl && results[1].status !== 'fulfilled')) {
    throw new Error(`PDIS document request failed for ${planningCase.case_number}`);
  }
  const approved = results[0].value;
  const initial = initialUrl ? results[1].value : [];
  const relatedIndex = relatedUrl ? (initialUrl ? 2 : 1) : -1;
  const related = relatedIndex >= 0 && results[relatedIndex]?.status === 'fulfilled' ? results[relatedIndex].value : [];
  const addressesIndex = addressesUrl ? (initialUrl ? (relatedUrl ? 3 : 2) : (relatedUrl ? 2 : 1)) : -1;
  const addresses = addressesIndex >= 0 && results[addressesIndex]?.status === 'fulfilled' ? array(results[addressesIndex].value) : [];
  const zimasPin = clean(addresses.find(row => clean(row.pin))?.pin);
  return {
    documents: [
      ...array(approved).map(row => planningDocument(row, 'approved')),
      ...array(initial).map(row => planningDocument(row, 'initial_submittal')),
    ].filter(Boolean),
    relatedCaseNumbers: [...new Set(array(related).map(row => clean(row.caseNumber || row.CaseNumber).toUpperCase()).filter(Boolean))],
    addresses,
    zimasPin: zimasPin || null,
  };
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function setSyncState(values) {
  await supabase('POST', '/rest/v1/planning_sync_state?on_conflict=id', [{
    id: 1,
    updated_at: new Date().toISOString(),
    ...values,
  }]);
}

async function main() {
  const startedAt = new Date().toISOString();
  await setSyncState({ status: 'running', started_at: startedAt, completed_at: null, error: null });
  try {
    const [filingFeatures, completedFeatures] = await Promise.all([
      fetchArcgisFeatures(FILINGS_LAYER, 'filed cases'),
      fetchArcgisFeatures(COMPLETED_LAYER, 'completed cases'),
    ]);
    const cases = mergeCases(filingFeatures.map(filingCase), completedFeatures.map(completedCase));
    console.log(`[planning] ${cases.length} unique cases ready to store`);
    await upsertChunks('planning_cases', 'case_number', cases, 200);

    const sites = await fetchAllSupabase(
      'sites',
      'id,address,lat,lng,permit_source_id,raw_permit_data,external_property_record',
      'id.asc'
    );
    console.log(`[planning] matching ${cases.length} cases against ${sites.length} ParcelLA properties`);
    const matches = buildMatches(cases, sites);
    await supabase('DELETE', '/rest/v1/site_planning_cases?site_id=not.is.null');
    await upsertChunks('site_planning_cases', 'site_id,case_number', matches, 300);
    console.log(`[planning] stored ${matches.length} APN/address matches`);

    const matchedNumbers = new Set(matches.map(row => row.case_number));
    const existingCases = await fetchAllSupabase(
      'planning_cases',
      'case_number,case_id,documents_checked_at',
      'case_number.asc'
    );
    const staleBefore = Date.now() - DOCUMENT_STALE_DAYS * 86400000;
    const documentCandidates = existingCases
      .filter(row => matchedNumbers.has(row.case_number))
      .filter(row => !row.documents_checked_at || new Date(row.documents_checked_at).getTime() < staleBefore)
      .sort((a, b) => String(a.documents_checked_at || '').localeCompare(String(b.documents_checked_at || '')))
      .slice(0, DOCUMENT_CASE_LIMIT);

    console.log(`[planning] refreshing PDIS documents for ${documentCandidates.length} matched case(s)`);
    const documentResults = await mapLimit(documentCandidates, DOCUMENT_CONCURRENCY, async planningCase => {
      const result = await fetchPdisCase(planningCase);
      if (result.documents.length) await upsertChunks('planning_documents', 'case_number,provider_document_id,section', result.documents, 100);
      await supabase(
        'PATCH',
        `/rest/v1/planning_cases?case_number=eq.${encodeURIComponent(planningCase.case_number)}`,
        {
          documents_checked_at: new Date().toISOString(),
          related_case_numbers: result.relatedCaseNumbers,
          case_addresses: result.addresses,
          zimas_pin: result.zimasPin,
          zimas_url: result.zimasPin ? `https://zimas.lacity.org?pin=${encodeURIComponent(result.zimasPin)}` : null,
        }
      );
      console.log(`[planning] ${planningCase.case_number}: ${result.documents.length} document(s), ${result.relatedCaseNumbers.length} related case(s)`);
      return result.documents.length;
    });
    const documentCount = documentResults
      .filter(result => result.status === 'fulfilled')
      .reduce((sum, result) => sum + result.value, 0);
    const failures = documentResults.filter(result => result.status === 'rejected');
    for (const failure of failures) console.warn(`[planning] document warning: ${failure.reason?.message || failure.reason}`);

    await setSyncState({
      status: 'complete',
      completed_at: new Date().toISOString(),
      case_count: cases.length,
      match_count: matches.length,
      document_count: documentCount,
      error: failures.length ? `${failures.length} PDIS case refresh(es) failed and will retry next run` : null,
      details: {
        filed_records: filingFeatures.length,
        completed_records: completedFeatures.length,
        sites_checked: sites.length,
        document_cases_checked: documentCandidates.length,
        document_failures: failures.length,
      },
    });
    console.log(`[planning] complete: ${cases.length} cases, ${matches.length} matches, ${documentCount} documents refreshed`);
  } catch (error) {
    try {
      await setSyncState({ status: 'failed', completed_at: new Date().toISOString(), error: error.message });
    } catch {}
    throw error;
  }
}

module.exports = {
  addressKeys,
  buildMatches,
  classifyDocument,
  cleanApn,
  filingCase,
  completedCase,
  mergeCases,
  normalizeAddress,
  planningDocument,
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[planning] fatal: ${error.stack || error.message}`);
    process.exit(1);
  });
}
