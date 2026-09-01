const DEFAULT_MAX_PDF_BYTES = 30 * 1024 * 1024;
let pdfjsPromise = null;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(value => value.length >= 2))];
}

function cleanParty(value) {
  return clean(value)
    .replace(/^[\s|/;,:-]+|[\s|/;,:-]+$/g, '')
    .replace(/^(?:name\s+of\s+)?(?:the\s+)?(?:applicant|owner)s?\s*[:|-]\s*/i, '')
    .trim();
}

function roleAnnotations(section) {
  const result = { owners: [], applicants: [] };
  const pattern = /(.{2,260}?)\s*\(\s*(Applicant|Owner)s?\s*\)/gi;
  let match;
  while ((match = pattern.exec(section))) {
    const value = cleanParty(match[1].replace(/^.*?\)\s*[|/;:-]\s*/g, ''));
    if (!value) continue;
    if (/^owner$/i.test(match[2])) result.owners.push(value);
    else result.applicants.push(value);
  }
  return result;
}

function labeledValue(text, label) {
  const boundary = '(?=\\s+(?:CONTACT PERSON|PROJECT DESCRIPTION|PROJECT LOCATION|CASE NUMBER|LEAD CITY AGENCY|EXEMPT STATUS|REQUESTED ENTITLEMENT|REPRESENTATIVE|APPLICANT|OWNER|TELEPHONE|EMAIL|SIGNATURE|DATE)\\b|$)';
  const match = text.match(new RegExp(`(?:^|\\s)${label}\\s*[:|-]\\s*(.{2,320}?)${boundary}`, 'i'));
  return cleanParty(match?.[1]);
}

function extractPlanningParties(text) {
  const flat = clean(String(text || '').replace(/\u0000/g, ' '));
  const owners = [];
  const applicants = [];
  const combined = flat.match(/NAME\s+OF\s+(?:THE\s+)?APPLICANT\s*\/\s*OWNER\s*:?\s*(.{2,700}?)(?=\s+(?:CONTACT PERSON|PROJECT DESCRIPTION|PROJECT LOCATION|EXEMPT STATUS|CASE NUMBER|LEAD CITY AGENCY|TELEPHONE|EMAIL|SIGNATURE)\b|$)/i);
  if (combined) {
    const annotated = roleAnnotations(combined[1]);
    owners.push(...annotated.owners);
    applicants.push(...annotated.applicants);
  }

  const owner = labeledValue(flat, '(?:PROPERTY\\s+)?OWNER(?:S|\\s+NAME)?');
  const applicant = labeledValue(flat, '(?:NAME\\s+OF\\s+(?:THE\\s+)?)?APPLICANT(?:S|\\s+NAME)?');
  if (owner && !/applicant/i.test(owner)) owners.push(owner);
  if (applicant && !/owner/i.test(applicant)) applicants.push(applicant);

  return {
    owners: unique(owners),
    applicants: unique(applicants),
  };
}

async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function fetchPdfBytes(url, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/pdf,*/*;q=0.8',
        'User-Agent': 'ParcelLA/3.0 planning party extraction',
      },
    });
    if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > maxBytes) throw new Error(`PDF exceeds ${Math.round(maxBytes / 1048576)} MB limit`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`PDF exceeds ${Math.round(maxBytes / 1048576)} MB limit`);
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractPdfText(url, options = {}) {
  const bytes = await fetchPdfBytes(
    url,
    Number(options.timeoutMs) || 8000,
    Number(options.maxBytes) || DEFAULT_MAX_PDF_BYTES,
  );
  const library = await pdfjs();
  const loadingTask = library.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    const pages = Math.min(document.numPages, Number(options.maxPages) || 10);
    const rows = [];
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      rows.push(content.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join(''));
      page.cleanup();
    }
    return rows.join('\n');
  } finally {
    await document.destroy();
  }
}

function documentPriority(document) {
  const type = clean(document.documentType || document.document_type).toLowerCase();
  const title = clean(document.title).toLowerCase();
  if (type === 'application' || /application|notice of exemption/.test(title)) return 0;
  if (type === 'determination' || /determination|decision|findings/.test(title)) return 1;
  if (type === 'cover_sheet' || /cover sheet|title sheet/.test(title)) return 2;
  return 3;
}

async function extractPlanningPartiesFromDocuments(documents, options = {}) {
  const candidates = [...(documents || [])]
    .filter(document => /^https:\/\//i.test(clean(document.url)))
    .sort((left, right) => documentPriority(left) - documentPriority(right))
    .slice(0, Number(options.maxDocuments) || 2);
  const owners = [];
  const applicants = [];
  const sources = [];
  for (const document of candidates) {
    try {
      const text = await extractPdfText(document.url, options);
      const parties = extractPlanningParties(text);
      owners.push(...parties.owners);
      applicants.push(...parties.applicants);
      if (parties.owners.length || parties.applicants.length) {
        sources.push({
          title: clean(document.title) || 'Planning document',
          url: document.url,
          documentType: clean(document.documentType || document.document_type) || 'other',
        });
      }
      if (owners.length && applicants.length) break;
    } catch (error) {
      if (options.onWarning) options.onWarning(document, error);
    }
  }
  return {
    owners: unique(owners),
    applicants: unique(applicants),
    sources,
    checkedAt: new Date().toISOString(),
  };
}

export {
  extractPdfText,
  extractPlanningParties,
  extractPlanningPartiesFromDocuments,
};
