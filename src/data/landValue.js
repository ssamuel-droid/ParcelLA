export const LAND_COMP_RECENCY_DAYS = 1095;

const APARTMENT_LAND_TYPES = new Set(['Multifamily', 'Mixed-Use']);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return String(value || '').trim();
}

function projectType(value) {
  const type = cleanText(value);
  if (/mixed/i.test(type)) return 'Mixed-Use';
  if (/condo|town/i.test(type)) return 'Condo/TH';
  if (/house|single/i.test(type)) return 'New House';
  return type || 'Multifamily';
}

function metricForProjectType(type) {
  return APARTMENT_LAND_TYPES.has(projectType(type)) ? 'ppu' : 'psf';
}

function groupKey(hood, type, metric) {
  return [cleanText(hood) || '*', cleanText(type) || '*', metric].join('|');
}

function daysOld(saleDate, asOf) {
  const t = saleDate ? new Date(saleDate).getTime() : NaN;
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, Math.round((asOf.getTime() - t) / 86400000));
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

function average(entries) {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (!totalWeight) return null;
  return entries.reduce((sum, e) => sum + e.value * e.weight, 0) / totalWeight;
}

function compUnitMetric(row) {
  const explicit = asNumber(row.price_per_unit ?? row.pricePerUnit);
  if (explicit) return explicit;
  const salePrice = asNumber(row.sale_price ?? row.salePrice);
  const units = asNumber(row.units);
  return salePrice && units ? salePrice / units : null;
}

function compSfMetric(row) {
  const explicit = asNumber(row.price_per_sf ?? row.pricePerSf);
  if (explicit) return explicit;
  const salePrice = asNumber(row.sale_price ?? row.salePrice);
  const units = asNumber(row.units);
  const avgUnitSf = asNumber(row.avg_unit_sf ?? row.avgUnitSf);
  const buildingSf = asNumber(row.building_sf ?? row.buildingSf);
  const sf = buildingSf || (units && avgUnitSf ? units * avgUnitSf : null);
  return salePrice && sf ? salePrice / sf : null;
}

function compWeight(ageDays) {
  if (!Number.isFinite(ageDays)) return 0.4;
  return Math.max(0.35, 1 - (ageDays / LAND_COMP_RECENCY_DAYS) * 0.65);
}

function addEntry(groups, key, entry) {
  if (!groups[key]) groups[key] = [];
  groups[key].push(entry);
}

export function buildLandCompBenchmarks(rows = [], options = {}) {
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const recencyDays = Number(options.recencyDays || LAND_COMP_RECENCY_DAYS);
  const cutoffTime = asOf.getTime() - recencyDays * 86400000;
  const groups = {};

  for (const row of rows || []) {
    const saleTime = row?.sale_date || row?.saleDate ? new Date(row.sale_date || row.saleDate).getTime() : NaN;
    if (!Number.isFinite(saleTime) || saleTime < cutoffTime) continue;

    const hood = cleanText(row.neighborhood || row.hood);
    const type = projectType(row.project_type || row.projectType || row.type);
    const age = daysOld(row.sale_date || row.saleDate, asOf);
    const base = {
      address: row.address || '',
      hood,
      type,
      saleDate: row.sale_date || row.saleDate || '',
      source: row.source || '',
      recorderDocumentNumber: row.recorder_document_number || row.recorderDocumentNumber || '',
      weight: compWeight(age),
    };

    const ppu = compUnitMetric(row);
    if (ppu && ppu > 10000 && ppu < 3000000) {
      const entry = { ...base, metric: 'ppu', value: ppu };
      addEntry(groups, groupKey(hood, type, 'ppu'), entry);
      addEntry(groups, groupKey(hood, '*', 'ppu'), entry);
      addEntry(groups, groupKey('*', type, 'ppu'), entry);
      addEntry(groups, groupKey('*', '*', 'ppu'), entry);
    }

    const psf = compSfMetric(row);
    if (psf && psf > 25 && psf < 5000) {
      const entry = { ...base, metric: 'psf', value: psf };
      addEntry(groups, groupKey(hood, type, 'psf'), entry);
      addEntry(groups, groupKey(hood, '*', 'psf'), entry);
      addEntry(groups, groupKey('*', type, 'psf'), entry);
      addEntry(groups, groupKey('*', '*', 'psf'), entry);
    }
  }

  return {
    asOf: asOf.toISOString(),
    recencyDays,
    groups,
  };
}

function summarizeBenchmark(entries) {
  const raw = entries.filter(e => Number.isFinite(e.value) && e.value > 0);
  if (!raw.length) return null;
  const med = median(raw.map(e => e.value));
  const filtered = med
    ? raw.filter(e => e.value >= med * 0.45 && e.value <= med * 1.8)
    : raw;
  const used = filtered.length ? filtered : raw;
  const weighted = average(used);
  const value = Math.round(weighted || med || 0);
  return {
    value,
    median: Math.round(med || value),
    count: used.length,
    rawCount: raw.length,
    comps: [...used]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map(e => ({
        address: e.address,
        hood: e.hood,
        type: e.type,
        saleDate: e.saleDate,
        metric: e.metric,
        value: Math.round(e.value),
        source: e.source,
        recorderDocumentNumber: e.recorderDocumentNumber,
      })),
  };
}

function pickBenchmark(benchmarks, hood, type, metric) {
  if (!benchmarks?.groups) return null;
  const keys = [
    { key: groupKey(hood, type, metric), label: 'same neighborhood and project type' },
    { key: groupKey(hood, '*', metric), label: 'same neighborhood' },
    { key: groupKey('*', type, metric), label: 'same project type citywide' },
    { key: groupKey('*', '*', metric), label: 'recent citywide sales' },
  ];

  let fallback = null;
  for (const item of keys) {
    const summary = summarizeBenchmark(benchmarks.groups[item.key] || []);
    if (!summary) continue;
    const picked = { ...summary, matchLabel: item.label };
    if (summary.count >= 3) return picked;
    if (!fallback) fallback = picked;
  }
  return fallback;
}

function subjectSf(site) {
  const explicit = asNumber(site.totalSF ?? site.totalSf ?? site.building_sf ?? site.buildingSf);
  if (explicit) return explicit;
  const units = asNumber(site.units);
  const avgUnitSf = asNumber(site.avg_unit_sf ?? site.avgUnitSf ?? site.usf);
  if (units && avgUnitSf) return units * avgUnitSf;
  return asNumber(site.lot_sf ?? site.lotSf ?? site.lot) || null;
}

export function estimateLandBasisFromComps(site, benchmarks, options = {}) {
  const type = projectType(site?.project_type || site?.projectType || site?.type);
  const hood = cleanText(site?.neighborhood || site?.hood);
  const metric = options.metric || metricForProjectType(type);
  const benchmark = pickBenchmark(benchmarks, hood, type, metric);
  if (!benchmark?.value) return null;

  const units = asNumber(site?.units);
  const sf = subjectSf(site);
  const unitBased = metric === 'ppu';
  const basisQuantity = unitBased ? units : sf;
  if (!basisQuantity) return null;

  return {
    value: Math.round(benchmark.value * basisQuantity),
    metric,
    metricLabel: unitBased ? 'price per unit' : 'price per SF',
    metricValue: benchmark.value,
    basisQuantity,
    compCount: benchmark.count,
    rawCompCount: benchmark.rawCount,
    matchLabel: benchmark.matchLabel,
    recencyDays: benchmarks.recencyDays || LAND_COMP_RECENCY_DAYS,
    source: 'recent_sales_comps',
    comps: benchmark.comps,
  };
}

