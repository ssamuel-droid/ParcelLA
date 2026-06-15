/**
 * ParceLLA — LA Density Bonus & ADU Modeling
 *
 * Calculates maximum allowable units under:
 *   1. California Density Bonus Law (Gov Code §65915) — up to 50% bonus units
 *   2. LA TOC (Transit-Oriented Communities) — tiers 1–4, up to 80% bonus
 *   3. SB 9 (2021) — lot splits + duplexes on SFR lots
 *   4. AB 2011 (2022) — multifamily by-right on commercial corridors
 *   5. ADU / JADU — always allowed on any lot
 *
 * Output: base units, bonus units, total units, and IRR uplift
 */

import { distanceMiles } from './DemandScore.js';

// ── LA Metro stations (for TOC tier calculation) ───────────────────────────────
// TOC tiers based on distance to high-frequency transit
const TRANSIT_NODES = [
  // Major rail stations (Tier 4 within 0.25mi)
  { name: 'Union Station',      lat: 34.0560, lng: -118.2365, type: 'major_rail' },
  { name: '7th/Metro Center',   lat: 34.0483, lng: -118.2589, type: 'major_rail' },
  { name: 'Wilshire/Vermont',   lat: 34.0625, lng: -118.2922, type: 'rail' },
  { name: 'Vermont/Beverly',    lat: 34.0756, lng: -118.2922, type: 'rail' },
  { name: 'Hollywood/Highland', lat: 34.1019, lng: -118.3397, type: 'rail' },
  { name: 'Culver City Station',lat: 34.0109, lng: -118.3896, type: 'rail' },
  { name: 'Expo/Western',       lat: 34.0271, lng: -118.3089, type: 'rail' },
  // Rapid bus lines (Tier 2–3)
  { name: 'Wilshire/Western',   lat: 34.0624, lng: -118.3089, type: 'rapid_bus' },
  { name: 'Vermont/Sunset',     lat: 34.0979, lng: -118.2919, type: 'rapid_bus' },
  { name: 'Sunset/Alvarado',    lat: 34.0814, lng: -118.2748, type: 'rapid_bus' },
];

// ── TOC tier definitions ───────────────────────────────────────────────────────
const TOC_TIERS = {
  4: {
    name: 'Tier 4',
    bonusPct:     0.80,    // 80% density bonus
    heightBonus:  22,      // +22ft allowed
    parkingReduc: 0.50,    // 50% parking reduction
    condition:    'Major rail station, 0.25 mile radius',
    distanceMi:   0.25,
    transitTypes: ['major_rail'],
  },
  3: {
    name: 'Tier 3',
    bonusPct:     0.65,
    heightBonus:  11,
    parkingReduc: 0.40,
    condition:    'Rail station, 0.25 mi OR major bus, 0.25 mi',
    distanceMi:   0.25,
    transitTypes: ['rail'],
  },
  2: {
    name: 'Tier 2',
    bonusPct:     0.50,
    heightBonus:  0,
    parkingReduc: 0.25,
    condition:    'Rail 0.5 mi OR rapid bus 0.25 mi',
    distanceMi:   0.5,
    transitTypes: ['rail', 'rapid_bus'],
  },
  1: {
    name: 'Tier 1',
    bonusPct:     0.35,
    heightBonus:  0,
    parkingReduc: 0,
    condition:    'Rail 0.75 mi OR rapid bus 0.5 mi',
    distanceMi:   0.75,
    transitTypes: ['rail', 'rapid_bus'],
  },
};

// ── California Density Bonus tiers (Gov Code §65915) ──────────────────────────
// Based on % of affordable units included
const CA_DENSITY_BONUS = [
  { affordablePct: 0.05, bonusPct: 0.225, incomeLevel: 'very-low' },
  { affordablePct: 0.10, bonusPct: 0.325, incomeLevel: 'very-low' },
  { affordablePct: 0.15, bonusPct: 0.425, incomeLevel: 'very-low' },
  { affordablePct: 0.20, bonusPct: 0.500, incomeLevel: 'very-low' },  // max 50%
  { affordablePct: 0.10, bonusPct: 0.225, incomeLevel: 'low' },
  { affordablePct: 0.20, bonusPct: 0.325, incomeLevel: 'low' },
  { affordablePct: 0.40, bonusPct: 0.500, incomeLevel: 'low' },
  { affordablePct: 0.10, bonusPct: 0.05,  incomeLevel: 'moderate' },
  { affordablePct: 0.20, bonusPct: 0.10,  incomeLevel: 'moderate' },
];

// ── TOC tier detector ─────────────────────────────────────────────────────────
export function detectTOCTier(lat, lng) {
  let bestTier = 0;
  let nearestNode = null;
  let nearestDist = Infinity;

  for (const node of TRANSIT_NODES) {
    const dist = distanceMiles(lat, lng, node.lat, node.lng);
    if (dist < nearestDist) { nearestDist = dist; nearestNode = node; }

    for (const [tier, def] of Object.entries(TOC_TIERS).reverse()) {
      if (def.transitTypes.includes(node.type) && dist <= def.distanceMi) {
        if (+tier > bestTier) bestTier = +tier;
      }
    }
  }

  return {
    tier:         bestTier,
    tierDef:      TOC_TIERS[bestTier] ?? null,
    nearestNode:  nearestNode?.name ?? 'None',
    nearestDist:  Math.round(nearestDist * 10) / 10,
    eligible:     bestTier > 0,
  };
}

// ── ADU allowances ────────────────────────────────────────────────────────────
export function calcADUAllowance(site) {
  const { lot, type, zone } = site;
  const adus = [];

  // Primary ADU — always allowed
  adus.push({ type: 'ADU', sqft: 1200, notes: 'Primary ADU — up to 1,200 SF allowed statewide' });

  // JADU — allowed on SFR lots
  if (['R1', 'R2', 'SFR+ADU'].includes(zone) || type === 'SFR+ADU') {
    adus.push({ type: 'JADU', sqft: 500, notes: 'Junior ADU — up to 500 SF, within existing structure' });
  }

  // Additional ADUs for multifamily (AB 68, SB 13)
  if (['Multifamily', 'Mixed-Use'].includes(type)) {
    const existingUnits = site.units ?? 0;
    const multiADUs = Math.min(25, Math.floor(existingUnits * 0.25));
    if (multiADUs > 0) {
      adus.push({
        type: `${multiADUs} detached ADUs`,
        sqft: 1200 * multiADUs,
        notes: `Up to 25% of existing units — AB 68/SB 13 (${multiADUs} units)`,
      });
    }
  }

  return adus;
}

// ── SB 9 analysis ─────────────────────────────────────────────────────────────
export function calcSB9(site) {
  const { zone, lot, type } = site;
  const isSFR = ['R1', 'R2', 'SFR+ADU'].includes(zone) || type === 'SFR+ADU';

  if (!isSFR || lot < 2400) {
    return { eligible: false, reason: 'SB 9 applies to SFR zones with lots ≥2,400 SF' };
  }

  return {
    eligible: true,
    baseUnits: 2,          // duplex on each resulting lot
    afterSplit: 4,          // 2 units × 2 lots after split
    adusAllowed: 2,         // 1 ADU + 1 JADU per lot
    totalPotential: 6,      // 4 base + 2 ADUs
    notes: 'SB 9 (2021): lot split → 2 lots → duplex each → 4 units + 2 ADUs = 6 total',
  };
}

// ── AB 2011 analysis ──────────────────────────────────────────────────────────
export function calcAB2011(site) {
  const { zone } = site;
  const commercialZones = ['C1', 'C2', 'C4', 'CR', 'CM', '[Q]C2'];
  const eligible = commercialZones.some(z => zone.includes(z));

  if (!eligible) {
    return { eligible: false, reason: 'AB 2011 applies to commercial zones (C1, C2, C4, etc.)' };
  }

  return {
    eligible: true,
    byRight: true,
    affordableReq: 0.15,    // 15% affordable units required
    notes: 'AB 2011 (2022): multifamily by-right on commercial corridors. 15% affordable required for full by-right.',
    streamlined: true,
    prevailingWage: true,   // wage requirement for 10+ units
  };
}

// ── Main density analysis ─────────────────────────────────────────────────────
export function analyzeDensity(site, options = {}) {
  const { lat, lng } = site.coordinates ?? { lat: 34.05, lng: -118.25 };
  const baseUnits    = site.units ?? 0;
  const lot          = site.lot ?? 0;

  // Detect TOC tier
  const toc = detectTOCTier(lat, lng);

  // ADU analysis
  const adus = calcADUAllowance(site);
  const aduUnits = adus.reduce((sum, a) => sum + (a.type.includes('ADU') ? 1 : 0) +
    (a.type.match(/^(\d+)/)?.[1] ? +a.type.match(/^(\d+)/)[1] : 0), 0);

  // SB 9
  const sb9 = calcSB9(site);

  // AB 2011
  const ab2011 = calcAB2011(site);

  // CA density bonus (best case — 20% very-low-income = 50% bonus)
  const caDensityBonus = options.affordablePct
    ? CA_DENSITY_BONUS.find(d => d.affordablePct >= (options.affordablePct ?? 0.20) &&
        d.incomeLevel === (options.incomeLevel ?? 'very-low'))
    : CA_DENSITY_BONUS[3]; // default: 20% VLI = 50% bonus

  // TOC bonus (takes precedence over CA density bonus — use higher of the two)
  const tocBonusPct  = toc.eligible ? TOC_TIERS[toc.tier].bonusPct : 0;
  const caBonusPct   = caDensityBonus?.bonusPct ?? 0;
  const bestBonusPct = Math.max(tocBonusPct, caBonusPct);

  const bonusUnits = Math.floor(baseUnits * bestBonusPct);
  const totalUnitsWithBonus = baseUnits + bonusUnits;
  const totalUnitsWithADU   = totalUnitsWithBonus + aduUnits;

  // Uplift summary
  const uplift = {
    baseUnits,
    tocBonusUnits:   toc.eligible ? Math.floor(baseUnits * tocBonusPct) : 0,
    caBonusUnits:    Math.floor(baseUnits * caBonusPct),
    bestBonusUnits:  bonusUnits,
    aduUnits,
    totalOptimized:  totalUnitsWithADU,
    pctIncrease:     baseUnits > 0 ? Math.round((totalUnitsWithADU / baseUnits - 1) * 100) : 0,
  };

  return {
    toc,
    caDensityBonus,
    adus,
    sb9,
    ab2011,
    uplift,
    recommendation: buildRecommendation(toc, sb9, ab2011, uplift, site),
  };
}

function buildRecommendation(toc, sb9, ab2011, uplift, site) {
  const lines = [];

  if (toc.tier >= 3) {
    lines.push(`TOC Tier ${toc.tier}: ${Math.round(TOC_TIERS[toc.tier].bonusPct * 100)}% density bonus — ${uplift.tocBonusUnits} additional units`);
  } else if (toc.tier >= 1) {
    lines.push(`TOC Tier ${toc.tier}: ${Math.round(TOC_TIERS[toc.tier].bonusPct * 100)}% density bonus — ${uplift.tocBonusUnits} additional units`);
  }

  if (uplift.aduUnits > 0) {
    lines.push(`ADU/JADU: ${uplift.aduUnits} additional unit${uplift.aduUnits > 1 ? 's' : ''} by right`);
  }

  if (ab2011.eligible) {
    lines.push('AB 2011: by-right approval on commercial corridor — eliminates discretionary review');
  }

  if (sb9.eligible) {
    lines.push(`SB 9: lot split could yield up to ${sb9.totalPotential} units on this parcel`);
  }

  return {
    lines,
    totalUplift: uplift.pctIncrease,
    priority:    uplift.pctIncrease >= 30 ? 'high' : uplift.pctIncrease >= 15 ? 'medium' : 'low',
  };
}

// ── IRR impact of density bonus ───────────────────────────────────────────────
export function densityBonusIRRImpact(baseModel, densityAnalysis, runModelFn) {
  const addedUnits = densityAnalysis.uplift.bestBonusUnits + densityAnalysis.uplift.aduUnits;
  if (addedUnits === 0) return null;

  // Re-run model with increased unit count
  const enhancedSite = {
    ...baseModel,
    units: baseModel.units + addedUnits,
    // Same land cost — density bonus is free
    // Soft costs scale with hard costs, hard costs scale with units
  };

  const enhanced = runModelFn(enhancedSite, {});

  return {
    baseUnits:     baseModel.units,
    bonusUnits:    addedUnits,
    enhancedUnits: enhancedSite.units,
    baseIRR:       baseModel.irrV,
    enhancedIRR:   enhanced.irrV,
    irrDelta:      Math.round((enhanced.irrV - baseModel.irrV) * 10) / 10,
    baseProfirt:   baseModel.netProfit,
    enhancedProfit: enhanced.netProfit,
    profitDelta:   enhanced.netProfit - baseModel.netProfit,
    affordable: densityAnalysis.caDensityBonus
      ? Math.ceil(enhancedSite.units * densityAnalysis.caDensityBonus.affordablePct)
      : 0,
  };
}
