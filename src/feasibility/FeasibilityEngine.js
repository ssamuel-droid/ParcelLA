const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(Number(value) || 0);
const money = value => Math.round(Number(value) || 0);

export const FEASIBILITY_USES = {
  apartment: { label: 'Apartments', group: 'housing', avgUnitSf: 750, efficiency: 0.82, hardCostPsf: 310, rentPsfMo: 4.0, capRate: 0.0525, opex: 0.35, vacancy: 0.05 },
  mixed_use: { label: 'Mixed-use', group: 'housing', avgUnitSf: 750, efficiency: 0.78, hardCostPsf: 345, rentPsfMo: 4.0, commercialRentPsfMo: 3.25, capRate: 0.0525, opex: 0.36, vacancy: 0.06 },
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
  { match: /^C2/, family: 'commercial', far: 1.5, height: 45, stories: 5, lotPerUnit: 400, uses: ['apartment', 'mixed_use', 'condo', 'office', 'retail', 'hotel'] },
  { match: /^C4/, family: 'commercial', far: 1.5, height: 45, stories: 8, lotPerUnit: 200, uses: ['apartment', 'mixed_use', 'condo', 'office', 'retail', 'hotel'] },
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
  for (const baseRule of ZONE_RULES) {
    const match = zone.match(baseRule.match);
    if (!match) continue;
    const lotPerUnit = baseRule.lotPerUnitFromZone ? Math.max(200, Number(match[1]) * 1000) : baseRule.lotPerUnit;
    const heightDistrict = zone.match(/-(1(?:XL|VL|L)?|2|3|4)(?:-|$)/)?.[1] || null;
    let far = baseRule.far;
    if (['2', '3', '4'].includes(heightDistrict) && ['commercial', 'multi'].includes(baseRule.family)) far = Math.max(far, 6);
    return { zone, ...baseRule, match: undefined, far, heightDistrict, lotPerUnit: lotPerUnit || null, recognized: true };
  }
  return { zone: zone || 'UNKNOWN', family: 'unknown', far: 1.0, height: 35, stories: 2, lotPerUnit: null, uses: [], recognized: false };
}

function residentialProgram({ lotSf, use, rule, far, baseUnits, densityMultiplier = 1, densityMode = 'mard', heightBonus = 0, commercialShare = 0, avgUnitSf, parkingRatio = 0.75, exact = null }) {
  const profile = FEASIBILITY_USES[use];
  if (exact) {
    const grossSf = round(exact.grossSf);
    const units = round(exact.units);
    const netSf = round(exact.netSf || grossSf * profile.efficiency);
    return { grossSf, netSf, units, avgUnitSf: units ? round(netSf / units) : 0, commercialSf: round(exact.commercialSf || 0), stories: round(exact.stories || 1), heightFt: round(exact.heightFt || rule.height), parkingSpaces: round(exact.parkingSpaces || 0), far: lotSf ? grossSf / lotSf : null, baseUnits, densityMode: 'verified_project', physicalUnitCapacity: units };
  }
  const selectedAvgUnitSf = Number(avgUnitSf || profile.avgUnitSf);
  const grossSf = round(lotSf * far);
  const residentialGrossSf = round(grossSf * (1 - commercialShare));
  const netSf = round(residentialGrossSf * profile.efficiency);
  const physicalUnitCapacity = Math.max(1, Math.floor(netSf / selectedAvgUnitSf));
  const regulatoryUnits = Math.max(1, Math.ceil(baseUnits * densityMultiplier));
  const units = densityMode === 'floor_area' ? physicalUnitCapacity : regulatoryUnits;
  return { grossSf, netSf, units, avgUnitSf: units ? round(netSf / units) : selectedAvgUnitSf, assumedAvgUnitSf: selectedAvgUnitSf, physicalUnitCapacity, regulatoryUnits: densityMode === 'floor_area' ? null : regulatoryUnits, baseUnits, densityMode, far, commercialSf: round(grossSf * commercialShare * 0.9), stories: Math.max(1, Math.ceil(grossSf / Math.max(lotSf * 0.72, 1))), heightFt: Math.max(rule.height, rule.height + heightBonus), parkingSpaces: Math.round(units * parkingRatio) };
}

function commercialProgram({ lotSf, use, rule, far }) {
  const profile = FEASIBILITY_USES[use];
  const grossSf = round(lotSf * far);
  const netSf = round(grossSf * profile.efficiency);
  const rooms = use === 'hotel' ? Math.max(1, Math.floor(netSf / profile.avgUnitSf)) : 0;
  return { grossSf, netSf, units: rooms, rooms, commercialSf: netSf, far, stories: Math.max(1, Math.ceil(grossSf / Math.max(lotSf * 0.75, 1))), heightFt: rule.height, parkingSpaces: use === 'industrial' ? Math.round(netSf / 1000) : Math.round(netSf / 500) };
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
  let grossRevenue = 0, noi = 0, exitValue = 0;
  if (profile.group === 'housing') {
    grossRevenue = program.netSf * Number(profile.rentPsfMo) * 12 + program.commercialSf * Number(profile.commercialRentPsfMo || 0) * 12;
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
  return { landCost, hardCostPsf, hardCosts, softCosts, contingency, financing, totalCost, loanAmount, equity, grossRevenue: money(grossRevenue), noi: money(noi), exitValue: money(exitValue), profit, marginOnCost: totalCost ? profit / totalCost : 0, capOnCost: totalCost ? noi / totalCost : null, returnOnEquity: equity ? profit / equity : null, costPerSf: program.grossSf ? totalCost / program.grossSf : null, costPerUnit: program.units ? totalCost / program.units : null, assumptions: { softCostPct, contingencyPct, ltc, interestRate, constructionMonths, ...profile } };
}

function scenario({ id, label, category, description, program, use, assumptions, eligibility, requirements, incentives, sources, confidence = 'screening' }) {
  return { id, label, category, description, use, program, underwriting: underwriteProgram(program, use, assumptions), eligibility, requirements, incentives, sources, confidence };
}

export function generateFeasibilityScenarios(input = {}) {
  const lotSf = clamp(Number(input.lotSf) || 7500, 1000, 2000000);
  const use = FEASIBILITY_USES[input.use] ? input.use : 'apartment';
  const profile = FEASIBILITY_USES[use];
  const rule = { ...zoneScreen(input.zone), ...(input.zoneProfile || {}), zone: normalizeZone(input.zone) || 'UNKNOWN' };
  const inLosAngelesCity = input.jurisdiction === 'Los Angeles city' || input.inLosAngelesCity === true;
  const inSantaAna = input.jurisdiction === 'Santa Ana city' || input.inSantaAna === true;
  const inCalifornia = input.inCalifornia === true || inLosAngelesCity || inSantaAna;
  const baseAllowed = rule.uses.includes(use);
  const baseFar = Number(input.baseFar || rule.far);
  const baseUnits = Math.max(1, Math.ceil(Number(input.baseUnits) || (rule.lotPerUnit ? lotSf / rule.lotPerUnit : 1)));
  const avgUnitSf = Number(input.assumptions?.avgUnitSf || profile.avgUnitSf);
  const programFactory = (far, options = {}) => ['housing', 'for_sale'].includes(profile.group)
    ? residentialProgram({ lotSf, use, rule, far, baseUnits, avgUnitSf, commercialShare: use === 'mixed_use' ? 0.12 : 0, ...options })
    : commercialProgram({ lotSf, use, rule, far });
  const sources = input.sources || [];
  const assumptions = input.assumptions || {};
  const affordableAssumptions = { ...assumptions, market: { ...(assumptions.market || {}), rentPsfMo: Number(assumptions.affordableRentPsfMo || 2.5), rentBasis: input.affordableRentBasis || 'Restricted-rent screening blend; replace with the applicable local schedule, bedroom mix and utility allowance.' } };
  const scenarios = [];

  scenarios.push(scenario({ id: 'by_right', label: 'By-right zoning capacity', category: 'By right', use, description: 'Maximum Allowable Residential Density (MARD) from the base zone, shown separately from practical unit sizing and floor-area fit.', program: programFactory(baseFar), assumptions, eligibility: baseAllowed ? 'potentially_eligible' : 'not_indicated', requirements: baseAllowed ? ['Verify general-plan density, specific plans, overlays, setbacks, lot coverage, height district and parking.', 'Confirm unit mix fits within base FAR; MARD is a regulatory unit ceiling, not a plan check.'] : [`${profile.label} is not indicated as a base-zone use in this preliminary screen.`], incentives: [], sources, confidence: input.baseUnitsVerified ? 'verified' : rule.recognized ? 'screening' : 'low' }));

  if (input.approvedProject && ['housing', 'for_sale'].includes(profile.group)) {
    scenarios.push(scenario({ id: 'verified_project', label: 'Filed / approved project', category: 'City record', use, description: input.approvedProject.description || 'Program reported in an official City Planning determination or filing.', program: programFactory(baseFar, { exact: input.approvedProject }), assumptions, eligibility: 'verified_city_record', requirements: input.approvedProject.requirements || ['Review the controlling determination, conditions and approved plans.'], incentives: input.approvedProject.incentives || [], sources, confidence: 'verified' }));
  }

  if (profile.group === 'housing' && use !== 'single_family') {
    scenarios.push(scenario({ id: 'state_density_bonus', label: 'State Density Bonus - 50%', category: 'Affordable incentive', use, description: '50% density-bonus screen. The exact bonus and concessions depend on the affordability mix under Government Code Section 65915.', program: programFactory(Math.max(baseFar * 1.35, baseFar), { densityMultiplier: 1.5, heightBonus: 11 }), assumptions, eligibility: baseAllowed ? 'verify_affordability_mix' : 'verify_rezoning_or_state_path', requirements: ['Select the income-restricted unit mix.', 'Confirm replacement housing and tenant protections.', 'Test incentives and waivers needed to physically accommodate the bonus.'], incentives: ['Up to 50% base density bonus', 'Parking relief', 'Up to four incentives', 'Development-standard waivers where legally required'], sources }));
    scenarios.push(scenario({ id: 'state_density_bonus_ab1287', label: 'State DB + AB 1287 maximum screen', category: 'Affordable incentive', use, description: 'Upper-bound density screen for projects that qualify for an additional state density bonus. This is not automatic.', program: programFactory(Math.max(baseFar * 1.7, baseFar), { densityMultiplier: 2, heightBonus: 22 }), assumptions, eligibility: 'enhanced_affordability_mix_required', requirements: ['Verify the project qualifies for both the base and additional density bonus.', 'Model the required Very Low and Moderate Income set-asides.', 'Confirm FAR, height, open-space and setback waivers.'], incentives: ['Potential combined density bonus up to the statutory maximum', 'Additional incentives and waivers subject to the selected affordability mix'], sources, confidence: 'low' }));

    if (inLosAngelesCity) {
      scenarios.push(scenario({ id: 'miip', label: 'MIIP / CHIP mixed-income', category: 'Local incentive', use, description: 'Los Angeles mixed-income screen for qualifying transit, opportunity-corridor or corridor-transition sites.', program: programFactory(Math.max(baseFar * 1.6, 3), { densityMultiplier: 1.8, heightBonus: 22, parkingRatio: 0.5 }), assumptions, eligibility: 'zimas_incentive_map_verification_required', requirements: ['Confirm MIIP subarea in ZIMAS.', 'Select the affordability set-aside.', 'Verify MARD, resident protections, labor standards and requested waivers.'], incentives: ['Subarea-specific density, FAR and height bonuses', 'Parking relief', 'Ministerial review for base and on-menu incentives'], sources, confidence: 'low' }));
      scenarios.push(scenario({ id: 'ed1_ahip_citywide', label: 'ED1 + AHIP citywide', category: '100% affordable', use, description: '100% affordable project using ED1 processing and AHIP citywide incentives. ED1 expedites review; AHIP and state law provide development rights.', program: programFactory(Math.max(3, baseFar * 1.35), { densityMultiplier: 1.8, heightBonus: 22, parkingRatio: 0.5 }), assumptions: affordableAssumptions, eligibility: 'affordable_and_site_verification_required', requirements: ['Confirm 100% affordable eligibility and excluded sites.', 'Verify replacement-unit, covenant, labor and environmental-protection requirements.', 'Underwrite the actual LAHD rent schedule and utility allowance.'], incentives: ['State-law density bonus', 'AHIP FAR of at least 3.0:1 or 35% increase where applicable', 'Up to 22 feet / two stories', '0.5 parking spaces per unit, subject to state no-parking rules', 'Up to five incentives and potential waivers'], sources }));
      scenarios.push(scenario({ id: 'ed1_ahip_transit_vmt', label: 'ED1 + AHIP transit / Very Low VMT', category: '100% affordable', use, description: 'For qualifying sites within one-half mile of a Major Transit Stop or in a Very Low VMT area, residential density is limited by floor area rather than a fixed unit count.', program: programFactory(Math.max(4.5, baseFar * 1.5), { densityMode: 'floor_area', heightBonus: 33, parkingRatio: 0 }), assumptions: affordableAssumptions, eligibility: 'zimas_transit_or_vmt_map_verification_required', requirements: ['Confirm the parcel is in the applicable AHIP transit or Very Low VMT subarea.', 'Apply setbacks, yards, open space, building code and objective design standards.', 'Verify all requested incentives and waivers.'], incentives: ['Density limited by allowable floor area', 'FAR of at least 4.5:1 or 50% increase', 'Up to 33 feet / three stories', 'No minimum residential parking', 'Setback and development-standard relief through incentives/waivers'], sources }));
      scenarios.push(scenario({ id: 'ed1_ahip_opportunity', label: 'ED1 + AHIP opportunity area', category: '100% affordable', use, description: 'Higher/Moderate Opportunity Area screen. Qualifying density is limited by floor area rather than a fixed unit count.', program: programFactory(Math.max(4.65, baseFar * 1.55), { densityMode: 'floor_area', heightBonus: 33, parkingRatio: 0 }), assumptions: affordableAssumptions, eligibility: 'tcac_opportunity_map_verification_required', requirements: ['Confirm Higher or Moderate Opportunity Area status on the current TCAC/AHIP map.', 'Apply setbacks, open space, fire/life-safety and objective design standards.', 'Confirm affordability, labor, replacement-unit and covenant requirements.'], incentives: ['Density limited by allowable floor area', 'FAR of at least 4.65:1 or 55% increase', 'Up to 33 feet / three stories', 'No minimum residential parking where applicable', 'Up to five incentives and potential waivers'], sources }));
      scenarios.push(scenario({ id: 'sb79', label: 'SB 79 / LA phased implementation', category: 'Transit housing', use, description: 'Current transit-housing screen. Los Angeles adopted phased implementation and Low-Rise ordinances effective June 30, 2026, so the live ZIMAS eligibility map controls.', program: programFactory(Math.max(3, baseFar), { densityMode: 'floor_area', heightBonus: 22, parkingRatio: 0.5 }), assumptions, eligibility: 'current_zimas_sb79_map_verification_required', requirements: ['Confirm current SB 79 or Low-Rise eligibility in ZIMAS.', 'Identify transit tier and distance band.', 'Verify affordability, labor, tenant protection and site exclusions.'], incentives: ['Potential transit-based density, FAR and height standards', 'Can interact with State Density Bonus where eligible'], sources, confidence: 'low' }));
    }

    if (inCalifornia && !inLosAngelesCity) {
      scenarios.push(scenario({ id: 'sb79', label: 'SB 79 transit housing', category: 'Transit housing', use, description: 'California transit-oriented housing screen. Capacity depends on the applicable transit tier, distance band, local implementation and all statutory site rules.', program: programFactory(Math.max(3, baseFar), { densityMode: 'floor_area', heightBonus: 22, parkingRatio: 0.5 }), assumptions, eligibility: 'transit_tier_and_site_verification_required', requirements: ['Confirm the parcel is within a qualifying rail, bus rapid transit or major transit stop area.', 'Identify the statutory tier and distance band.', 'Verify local implementation, affordability, labor, tenant protection, hazard and site exclusions.'], incentives: ['Potential transit-based density, FAR and height standards', 'Potential interaction with State Density Bonus'], sources, confidence: 'low' }));
    }

    if (['commercial', 'industrial'].includes(rule.family)) {
      scenarios.push(scenario({ id: 'ab2011', label: 'AB 2011 commercial corridor', category: 'State by-right', use, description: 'Housing on a qualifying commercial corridor under the Affordable Housing and High Road Jobs Act.', program: programFactory(Math.max(baseFar, 2.5), { densityMultiplier: 1.35, heightBonus: 11 }), assumptions, eligibility: 'corridor_and_site_verification_required', requirements: ['Verify corridor and parcel eligibility.', 'Confirm environmental and industrial-use exclusions.', 'Meet affordability and labor standards.'], incentives: ['Ministerial approval on qualifying sites', 'Residential use notwithstanding qualifying commercial zoning'], sources, confidence: 'low' }));
    }
    scenarios.push(scenario({ id: 'sb35', label: 'SB 35 streamlining', category: 'State streamlining', use, description: 'Approval streamlining rather than an automatic density increase.', program: programFactory(baseFar), assumptions, eligibility: 'jurisdiction_and_project_verification_required', requirements: ['Confirm jurisdiction production status, affordability, objective standards, labor and site rules.'], incentives: ['Ministerial review and statutory timelines when eligible'], sources }));
  }

  if (['single_family', 'townhome'].includes(use) && rule.family === 'single') {
    scenarios.push(scenario({ id: 'sb9', label: 'SB 9 lot split / duplex', category: 'State by-right', use, description: 'Two-unit development and urban lot-split screen.', program: { ...programFactory(Math.max(baseFar, 0.8), { densityMultiplier: 4 }), units: lotSf >= 2400 ? 4 : 2 }, assumptions, eligibility: lotSf >= 2400 ? 'site_verification_required' : 'lot_size_concern', requirements: ['Confirm urbanized-area, ownership, tenant, historic, hazard and prior-lot-split rules.'], incentives: ['Potential ministerial duplex and urban lot split'], sources }));
    scenarios.push(scenario({ id: 'adu', label: 'Primary home + ADU/JADU', category: 'State by-right', use, description: 'Primary home with accessory dwelling unit options.', program: { ...programFactory(Math.max(baseFar, 0.55), { densityMultiplier: 2 }), units: 2 }, assumptions, eligibility: 'potentially_eligible', requirements: ['Confirm dwelling, fire access, utilities and size/setback limits.'], incentives: ['Ministerial ADU processing', 'Reduced setbacks and parking in qualifying circumstances'], sources }));
  }

  return { use, useLabel: profile.label, zone: rule.zone, zoneRule: rule, lotSf, baseUnits, scenarios };
}
