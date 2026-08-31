const ED1_DEFAULT_AMI_PCT = 80;

// 2026 CTCAC maximum multi-family tax-subsidy gross rents for Los Angeles County.
// These limits are effective May 1, 2026. A project-specific utility allowance
// must be deducted to determine the maximum tenant-paid rent.
const ED1_RENT_LIMITS_2026 = Object.freeze({
  80: Object.freeze({ studio: 2332, one: 2499, two: 2998, three: 3465 }),
});

const ED1_RENT_METADATA = Object.freeze({
  program: 'ED1',
  scheduleYear: 2026,
  effectiveDate: '2026-05-01',
  amiPct: ED1_DEFAULT_AMI_PCT,
  schedule: 'CTCAC Schedule IX',
  source: '2026 CTCAC Maximum Multi-Family Tax Subsidy Rents - Los Angeles County',
  sourceUrl: 'https://www.treasurer.ca.gov/sites/default/files/ctcac/2026%20Rent%20Limits%205-1-26%2B%20-%20ADA_0.pdf',
  assumption: 'Underwritten at the 80% AMI gross-rent ceiling for every unit; optional moderate-income units are not assumed.',
  caveat: 'The final LAHD covenant and entitlement control. Lower AMI tiers and the project-specific utility allowance can reduce tenant-paid rent.',
});

function text(value) {
  return String(value ?? '').trim();
}

function isEd1ProjectLike(site = {}) {
  if (site.isEd1 === true || site.is_ed1 === true) return true;
  const raw = site.raw_permit_data || site.rawPermitData || {};
  if (raw.is_ed1 === true || raw.isEd1 === true) return true;
  const searchable = [
    site.program,
    site.permitProgram,
    site.workDescription,
    site.work_description,
    site.projectDescription,
    raw.program,
    raw.permit_program,
    raw.work_description,
    raw.project_description,
  ].map(text).filter(Boolean).join(' ');
  return /(^|[^a-z0-9])ed[- ]?1([^a-z0-9]|$)|executive directive\s*1/i.test(searchable);
}

function normalizedMonthlyRents(value = {}) {
  const studio = Number(value.studio ?? value.s);
  const one = Number(value.one ?? value.o);
  const two = Number(value.two ?? value.t);
  const three = Number(value.three ?? value.th);
  if (![studio, one, two, three].every(amount => Number.isFinite(amount) && amount > 0)) return null;
  return { studio, one, two, three };
}

function resolveEd1Affordability(site = {}) {
  if (!isEd1ProjectLike(site)) return null;
  const raw = site.raw_permit_data || site.rawPermitData || {};
  const saved = site.ed1Affordability || site.ed1_affordability || raw.ed1_affordability || {};
  const savedRents = normalizedMonthlyRents(saved.monthlyRents || saved.monthly_rents || saved.rents || {});
  const amiPct = Number(saved.amiPct ?? saved.ami_pct ?? ED1_DEFAULT_AMI_PCT);
  const scheduleRents = ED1_RENT_LIMITS_2026[amiPct] || ED1_RENT_LIMITS_2026[ED1_DEFAULT_AMI_PCT];

  return {
    ...ED1_RENT_METADATA,
    ...saved,
    amiPct: ED1_RENT_LIMITS_2026[amiPct] ? amiPct : ED1_DEFAULT_AMI_PCT,
    monthlyRents: savedRents || { ...scheduleRents },
    grossRentLimits: true,
    utilityAllowanceDeducted: saved.utilityAllowanceDeducted === true || saved.utility_allowance_deducted === true,
  };
}

function rentsForSite(site = {}, marketRents = {}) {
  const profile = resolveEd1Affordability(site);
  if (profile) return { ...profile.monthlyRents };
  return normalizedMonthlyRents(marketRents) || { studio: 0, one: 0, two: 0, three: 0 };
}

module.exports = {
  ED1_DEFAULT_AMI_PCT,
  ED1_RENT_LIMITS_2026,
  ED1_RENT_METADATA,
  isEd1ProjectLike,
  resolveEd1Affordability,
  rentsForSite,
};
