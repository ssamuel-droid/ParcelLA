const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(Number(value) || 0);
const money = value => Math.round(Number(value) || 0);

export const FEASIBILITY_USES = {
  apartment: { label: 'Apartments', group: 'housing', avgUnitSf: 825, efficiency: 0.82, hardCostPsf: 310, rentPsfMo: 4.0, capRate: 0.0525, opex: 0.35, vacancy: 0.05 },
  mixed_use: { label: 'Mixed-use', group: 'housing', avgUnitSf: 825, efficiency: 0.78, hardCostPsf: 345, rentPsfMo: 4.0, commercialRentPsfMo: 3.25, capRate: 0.0525, opex: 0.36, vacancy: 0.06 },
  condo: { label: 'Condominiums', group: 'for_sale', avgUnitSf: 1150, efficiency: 0.80, hardCostPsf: 365, salePsf: 825 },
  townhome: { label: 'Townhomes', group: 'for_sale', avgUnitSf: 1550, efficiency: 0.84, hardCostPsf: 335, salePsf: 750 },
  single_family: { label: 'Single-family homes', group: 'for_sale', avgUnitSf: 2500, efficiency: 0.90, hardCostPsf: 315, salePsf: 725 },
  office: { label: 'Office', group: 'commercial', efficiency: 0.85, hardCostPsf: 365, rentPsfMo: 4.25, capRate: 0.065, opex: 0.32, vacancy: 0.12 },
  retail: { label: 'Retail', group: 'commercial', efficiency: 0.90, hardCostPsf: 300, rentPsfMo: 3.75, capRate: 0.06, opex: 0.28, vacancy: 0.08 },
  industrial: { label: 'Industrial / warehouse', group: 'commercial', efficiency: 0.95, hardCostPsf: 225, rentPsfMo: 1.85, capRate: 0.0575, opex: 0.22, vacancy: 0.05 },
  light_manufacturing: { label: 'Light manufacturing', group: 'commercial', efficiency: 0.92, hardCostPsf: 255, rentPsfMo: 2.0, capRate: 0.06, opex: 0.24, vacancy: 0.06 },
  hotel: { label: 'Hotel', group: 'hospitality', avgUnitSf: 525, efficiency: 0.72, hardCostPsf: 425, adr: 245, occupancy: 0.74, capRate: 0.0725, opex: 0.67 },
};

const ZONE_RULES = [
  { match: /^R1/, family: 'single', far: 0.45, height: 33, stories: 2, lotPerUnit: 5000, uses: ['single_family'] },
  { match: /^R2/, family: 'low_res', far: 0.60, height: 33, stories: 2, lotPerUnit: 2500, uses: ['single_family', 'townhome', 'apartment'] },
  { match: /^RD([0-9.]+)/, family: 'multi', far: 1.5, height: 45, stories: 3, lotPerUnitFromZone: true, uses: ['apartment', 'townhome', 'condo'] },
  { match: /^R3/, family: 'multi', far: 3.0, height: 45, stories: 4, lotPerUnit: 800, uses: ['apartment', 'townhome', 'condo'] },
  { match: /^R4/, family: 'multi', far: 3.0, height: 45, stories: 5, lotPerUnit: 400, uses: ['apartment', 'townhome', 'condo'] },
  { match: /^R5/, family: 'multi', far: 6.0, height: 75, stories: 7, lotPerUnit: 200, uses: ['apartment', 'condo'] },
  { match: /^CR/, family: 'commercial', far: 1.5, height: 45, stories: 3, lotPerUnit: 800, uses: ['apartment', 'mixed_use', 'office', 'retail'] },
  { match: /^C1/, family: 'commercial', far: 1.5, height: 45, stories: 3, lotPerUnit: 800, uses: ['apartment', 'mixed_use', 'office', 'retail'] },
  { match: /^C2/, family: 'commercial', far: 3.0, height: 45, stories: 5, lotPerUnit: 400, uses: ['apartment', 'mixed_use', 'condo', 'office', 'retail', 'hotel'] },
  { match: /^C4/, family: 'commercial', far: 6.0, height: 75, stories: 8, lotPerUnit: 200, uses: ['apartment', 'mixed_use', 'condo', 'office', 'retail', 'hotel'] },
  { match: /^CM/, family: 'industrial', far: 1.5, height: 45, stories: 3, uses: ['office', 'retail', 'industrial', 'light_manufacturing'] },
  { match: /^M1/, family: 'industrial', far: 1.5, height: 45, stories: 3, uses: ['office', 'industrial', 'light_manufacturing'] },
  { match: /^M2/, family: 'industrial', far: 3.0, height: 60, stories: 4, uses: ['industrial', 'light_manufacturing'] },
  { match: /^M3/, family: 'industrial', far: 3.0, height: 60, stories: 4, uses: ['industrial', 'light_manufacturing'] },
];

export function normalizeZone(value = '') {
  return String(value).toUpperCase().replace(/\s+/g, '').replace(/^\[[^\]]+\]/, '').replace(/^\([^\)]+\)/, '');
}

export function zoneScreen(value = '') {
  const zone = normalizeZone(value);
  for (const rule of ZONE_RULES) {
    const match = zone.match(rule.match);
    if (!match) continue;
    const lotPerUnit = rule.lotPerUnitFromZone ? Math.max(200, Number(match[1]) * 1000) : rule.lotPerUnit;
    return { zone, ...rule, match: undefined, lotPerUnit: lotPerUnit || null, recognized: true };
  }
  return { zone: zone || 'UNKNOWN', family: 'unknown', far: 1.0, height: 35, stories: 2, lotPerUnit: null, uses: [], recognized: false };
}

function residentialProgram({ lotSf, use, rule, far, densityMultiplier = 1, heightBonus = 0, commercialShare = 0 }) {
  const profile = FEASIBILITY_USES[use];
  const grossSf = round(lotSf * far);
  const residentialGrossSf = round(grossSf * (1 - commercialShare));
  const unitCapacityByArea = Math.max(1, Math.floor((residentialGrossSf * profile.efficiency) / profile.avgUnitSf));
  const baseDensity = rule.lotPerUnit ? Math.max(1, Math.floor(lotSf / rule.lotPerUnit)) : unitCapacityByArea;
  const units = Math.max(1, Math.min(unitCapacityByArea, Math.floor(baseDensity * densityMultiplier)));
  return {
    grossSf,
    netSf: round(residentialGrossSf * profile.efficiency),
    units,
    avgUnitSf: profile.avgUnitSf,
    commercialSf: round(grossSf * commercialShare * 0.9),
    stories: Math.max(1, Math.ceil((grossSf / Math.max(lotSf * 0.72, 1)))),
    heightFt: Math.max(rule.height, rule.height + heightBonus),
    parkingSpaces: Math.round(units * 0.75),
  };
}

function commercialProgram({ lotSf, use, rule, far }) {
  const profile = FEASIBILITY_USES[use];
  const grossSf = round(lotSf * far);
  const netSf = round(grossSf * profile.efficiency);
  const rooms = use === 'hotel' ? Math.max(1, Math.floor(netSf / profile.avgUnitSf)) : 0;
  return {
    grossSf,
    netSf,
    units: rooms,
    rooms,
    commercialSf: netSf,
    stories: Math.max(1, Math.ceil(grossSf / Math.max(lotSf * 0.75, 1))),
    heightFt: rule.height,
    parkingSpaces: use === 'industrial' ? Math.round(netSf / 1000) : Math.round(netSf / 500),
  };
}

export function underwriteProgram(program, use, assumptions = {}) {
  const profile = { ...FEASIBILITY_USES[use], ...(assumptions.market || {}) };
  const landCost = money(assumptions.landCost || 0);
  const hardCostPsf = Number(assumptions.hardCostPsf || profile.hardCostPsf);
  const hardCosts = money(program.grossSf * hardCostPsf);
  const softCostPct = Number(assumptions.softCostPct ?? 0.20);
  const contingencyPct = Number(assumptions.contingencyPct ?? 0.05);
  const softCosts = money(hardCosts * softCostPct);
  const contingency = money(hardCosts * contingencyPct);
  const preCarry = landCost + hardCosts + softCosts + contingency;
  const ltc = Number(assumptions.ltc ?? 0.65);
  const interestRate = Number(assumptions.interestRate ?? 0.065);
  const constructionMonths = Number(assumptions.constructionMonths ?? (program.stories > 5 ? 24 : 18));
  const loanAmount = money(preCarry * ltc);
  const financing = money(loanAmount * interestRate * constructionMonths / 24);
  const totalCost = preCarry + financing;
  let grossRevenue = 0;
  let noi = 0;
  let exitValue = 0;

  if (profile.group === 'housing') {
    const residentialRent = program.netSf * Number(profile.rentPsfMo) * 12;
    const commercialRent = program.commercialSf * Number(profile.commercialRentPsfMo || 0) * 12;
    grossRevenue = residentialRent + commercialRent;
    noi = grossRevenue * (1 - Number(profile.vacancy)) * (1 - Number(profile.opex));
    exitValue = noi / Number(profile.capRate);
  } else if (profile.group === 'commercial') {
    grossRevenue = program.netSf * Number(profile.rentPsfMo) * 12;
    noi = grossRevenue * (1 - Number(profile.vacancy)) * (1 - Number(profile.opex));
    exitValue = noi / Number(profile.capRate);
  } else if (profile.group === 'hospitality') {
    grossRevenue = program.rooms * Number(profile.adr) * 365 * Number(profile.occupancy);
    noi = grossRevenue * (1 - Number(profile.opex));
    exitValue = noi / Number(profile.capRate);
  } else {
    grossRevenue = program.netSf * Number(profile.salePsf);
    exitValue = grossRevenue;
  }

  const profit = money(exitValue - totalCost);
  const equity = money(totalCost - loanAmount);
  return {
    landCost, hardCostPsf, hardCosts, softCosts, contingency, financing, totalCost,
    loanAmount, equity, grossRevenue: money(grossRevenue), noi: money(noi), exitValue: money(exitValue), profit,
    marginOnCost: totalCost ? profit / totalCost : 0,
    capOnCost: totalCost ? noi / totalCost : null,
    returnOnEquity: equity ? profit / equity : null,
    costPerSf: program.grossSf ? totalCost / program.grossSf : null,
    costPerUnit: program.units ? totalCost / program.units : null,
    assumptions: { softCostPct, contingencyPct, ltc, interestRate, constructionMonths, ...profile },
  };
}

function scenario({ id, label, category, description, program, use, assumptions, eligibility, requirements, incentives, sources, confidence = 'screening' }) {
  return {
    id, label, category, description, use, program,
    underwriting: underwriteProgram(program, use, assumptions),
    eligibility, requirements, incentives, sources, confidence,
  };
}

export function generateFeasibilityScenarios(input = {}) {
  const lotSf = clamp(Number(input.lotSf) || 7500, 1000, 2000000);
  const use = FEASIBILITY_USES[input.use] ? input.use : 'apartment';
  const profile = FEASIBILITY_USES[use];
  const rule = zoneScreen(input.zone);
  const inLosAngelesCity = input.jurisdiction === 'Los Angeles city' || input.inLosAngelesCity === true;
  const baseAllowed = rule.uses.includes(use);
  const baseFar = Number(input.baseFar || rule.far);
  const programFactory = (far, densityMultiplier = 1, heightBonus = 0) =>
    ['housing', 'for_sale'].includes(profile.group)
      ? residentialProgram({ lotSf, use, rule, far, densityMultiplier, heightBonus, commercialShare: use === 'mixed_use' ? 0.12 : 0 })
      : commercialProgram({ lotSf, use, rule, far });
  const sources = input.sources || [];
  const assumptions = input.assumptions || {};
  const affordableAssumptions = {
    ...assumptions,
    market: {
      ...(assumptions.market || {}),
      rentPsfMo: Number(assumptions.affordableRentPsfMo || 2.5),
      rentBasis: 'Screening restricted-rent blend; replace with the applicable LAHD schedule and utility allowance.',
    },
  };
  const scenarios = [];

  scenarios.push(scenario({
    id: 'by_right', label: 'By-right baseline', category: 'By right', use,
    description: 'Concept limited to the screened base-zone density, FAR and height before discretionary incentives.',
    program: programFactory(baseFar), assumptions,
    eligibility: baseAllowed ? 'potentially_eligible' : 'not_indicated',
    requirements: baseAllowed ? ['Verify use, overlays, setbacks, lot coverage, height district, parking and specific-plan standards.'] : [`${profile.label} is not indicated as a base-zone use in this preliminary screen.`],
    incentives: [], sources, confidence: rule.recognized ? 'screening' : 'low',
  }));

  if (profile.group === 'housing' && use !== 'single_family') {
    scenarios.push(scenario({
      id: 'state_density_bonus', label: 'State Density Bonus', category: 'Affordable incentive', use,
      description: 'Screening concept with a 50% density increase. Actual bonus, concessions and waivers depend on the affordability mix and current Government Code Section 65915.',
      program: programFactory(baseFar * 1.35, 1.5, 11), assumptions,
      eligibility: baseAllowed ? 'verify_affordability_mix' : 'verify_rezoning_or_state_path',
      requirements: ['Select the income-restricted unit mix.', 'Record affordability covenants.', 'Confirm replacement housing and tenant protections.', 'Confirm on-menu incentives and any requested waivers.'],
      incentives: ['Density increase', 'Parking relief', 'Up to four incentives for qualifying mixed-income projects', 'Potential development-standard waivers'],
      sources, confidence: 'screening',
    }));

    if (inLosAngelesCity) {
      scenarios.push(scenario({
        id: 'miip', label: 'MIIP / CHIP mixed-income', category: 'Local incentive', use,
        description: 'Los Angeles CHIP screening scenario for qualifying transit, corridor or opportunity-area sites.',
        program: programFactory(baseFar * 1.6, 1.8, 22), assumptions,
        eligibility: 'map_verification_required',
        requirements: ['Confirm MIIP eligibility in ZIMAS.', 'Select affordability set-aside.', 'Verify MARD, incentive area, resident protections and labor requirements.', 'Confirm FAR, height and waiver pathway.'],
        incentives: ['Potential density, FAR and height bonuses', 'Parking relief', 'Ministerial path for base and on-menu incentives'],
        sources, confidence: 'low',
      }));

      scenarios.push(scenario({
        id: 'ed1_ahip', label: 'ED1 + AHIP affordable', category: '100% affordable', use,
        description: '100% affordable concept using ED1 expedited processing and AHIP incentives. ED1 is a processing directive; AHIP and state law supply the land-use incentives.',
        program: programFactory(baseFar * 1.8, 2.0, 33), assumptions: affordableAssumptions,
        eligibility: 'affordable_and_site_verification_required',
        requirements: ['80-100% affordable housing structure; ED1 generally requires 100% affordable housing.', 'Confirm excluded sites and replacement-unit obligations.', 'Use restricted rent schedule in underwriting.', 'Confirm prevailing wage and applicable labor standards.'],
        incentives: ['ED1 expedited ministerial processing', 'AHIP density, FAR, height and parking incentives', 'Potential state-law waivers'],
        sources, confidence: 'low',
      }));
    }

    if (['commercial', 'industrial'].includes(rule.family)) {
      scenarios.push(scenario({
        id: 'ab2011', label: 'AB 2011 commercial conversion', category: 'State by-right', use,
        description: 'Housing on a qualifying commercial corridor under the Affordable Housing and High Road Jobs Act.',
        program: programFactory(Math.max(baseFar, 2.5), 1.35, 11), assumptions,
        eligibility: 'corridor_and_site_verification_required',
        requirements: ['Verify parcel is on an eligible commercial corridor.', 'Confirm environmental, industrial-use and adjacency exclusions.', 'Meet affordable housing and wage/labor standards.', 'Confirm objective development standards.'],
        incentives: ['Ministerial approval on qualifying sites', 'Residential use notwithstanding base commercial zoning'],
        sources, confidence: 'low',
      }));
    }

    scenarios.push(scenario({
      id: 'sb35', label: 'SB 35 streamlining', category: 'State streamlining', use,
      description: 'A streamlined approval path rather than an automatic density increase; modeled at the by-right program unless paired with another bonus.',
      program: programFactory(baseFar), assumptions,
      eligibility: 'jurisdiction_and_project_verification_required',
      requirements: ['Confirm jurisdiction housing-production status.', 'Meet affordability, objective standards, labor and site eligibility rules.', 'Complete tribal consultation where applicable.'],
      incentives: ['Ministerial review and statutory timelines when eligible'],
      sources, confidence: 'screening',
    }));
  }

  if (['single_family', 'townhome'].includes(use) && rule.family === 'single') {
    scenarios.push(scenario({
      id: 'sb9', label: 'SB 9 lot split / duplex', category: 'State by-right', use,
      description: 'Two-unit development and urban lot-split screen for qualifying single-family parcels.',
      program: { ...programFactory(Math.max(baseFar, 0.8), 4), units: lotSf >= 2400 ? 4 : 2 }, assumptions,
      eligibility: lotSf >= 2400 ? 'site_verification_required' : 'lot_size_concern',
      requirements: ['Confirm urbanized-area, ownership, tenant, historic, hazard and prior-lot-split requirements.', 'Verify local objective standards and access/utilities.'],
      incentives: ['Potential ministerial duplex and urban lot split'], sources, confidence: 'screening',
    }));
    scenarios.push(scenario({
      id: 'adu', label: 'Primary home + ADU/JADU', category: 'State by-right', use,
      description: 'Base home with accessory dwelling unit options subject to current state and local standards.',
      program: { ...programFactory(Math.max(baseFar, 0.55), 2), units: 2 }, assumptions,
      eligibility: 'potentially_eligible',
      requirements: ['Confirm existing/proposed primary dwelling, fire access, utilities and size/setback limits.'],
      incentives: ['Ministerial ADU processing', 'Reduced setbacks and parking in qualifying circumstances'], sources, confidence: 'screening',
    }));
  }

  return { use, useLabel: profile.label, zone: rule.zone, zoneRule: rule, lotSf, scenarios };
}
