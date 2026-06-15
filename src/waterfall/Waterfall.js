/**
 * ParceLLA — IRR Hurdle Waterfall
 *
 * Models a multi-tier promote structure with IRR hurdles:
 *
 *   Tier 0: Return of capital (1.0x) — LP gets 100%
 *   Tier 1: Pref return (8%) — LP gets 100%
 *   Tier 2: 1.0x–1.5x equity multiple — LP 80% / GP 20%
 *   Tier 3: 1.5x–2.0x equity multiple — LP 70% / GP 30%
 *   Tier 4: 2.0x+ equity multiple — LP 60% / GP 40%
 *
 * OR IRR-based hurdles (alternative structure):
 *   Below 8% IRR  → LP 100%
 *   8–12% IRR     → LP 80% / GP 20%
 *   12–18% IRR    → LP 70% / GP 30%
 *   18%+ IRR      → LP 60% / GP 40%
 *
 * Both structures are supported — pass waterfallType: 'multiple' or 'irr'
 */

import { calcIRR } from '../model/financialModel.js';

// ── Waterfall types ────────────────────────────────────────────────────────────
export const WATERFALL_PRESETS = {
  standard: {
    name: 'Standard (8% pref + 80/20)',
    prefReturn: 0.08,
    tiers: [
      { label: 'Return of capital', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'multiple', value: 1.0 } },
      { label: 'Preferred return (8%)', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'irr', value: 0.08 } },
      { label: 'Promote tier 1', lpPct: 0.80, gpPct: 0.20, threshold: { type: 'none' } },
    ],
  },
  institutional: {
    name: 'Institutional (8% pref + tiered promote)',
    prefReturn: 0.08,
    tiers: [
      { label: 'Return of capital', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'multiple', value: 1.0 } },
      { label: 'Preferred return (8%)', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'irr', value: 0.08 } },
      { label: 'Promote tier 1 (to 1.5x)', lpPct: 0.80, gpPct: 0.20, threshold: { type: 'multiple', value: 1.5 } },
      { label: 'Promote tier 2 (to 2.0x)', lpPct: 0.70, gpPct: 0.30, threshold: { type: 'multiple', value: 2.0 } },
      { label: 'Promote tier 3 (2.0x+)', lpPct: 0.60, gpPct: 0.40, threshold: { type: 'none' } },
    ],
  },
  irr_hurdles: {
    name: 'IRR hurdles (8/12/18%)',
    prefReturn: 0.08,
    tiers: [
      { label: 'Below 8% IRR',  lpPct: 1.00, gpPct: 0.00, irrMax: 0.08 },
      { label: '8–12% IRR',     lpPct: 0.80, gpPct: 0.20, irrMax: 0.12 },
      { label: '12–18% IRR',    lpPct: 0.70, gpPct: 0.30, irrMax: 0.18 },
      { label: '18%+ IRR',      lpPct: 0.60, gpPct: 0.40, irrMax: Infinity },
    ],
  },
  developer_friendly: {
    name: 'Developer-friendly (10% pref + 30% promote)',
    prefReturn: 0.10,
    tiers: [
      { label: 'Return of capital', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'multiple', value: 1.0 } },
      { label: 'Preferred return (10%)', lpPct: 1.00, gpPct: 0.00, threshold: { type: 'irr', value: 0.10 } },
      { label: 'Promote (30%)', lpPct: 0.70, gpPct: 0.30, threshold: { type: 'none' } },
    ],
  },
};

// ── Core waterfall calculation ─────────────────────────────────────────────────
/**
 * Calculate full waterfall distribution for a development deal
 *
 * @param {Object} model     — output from runModel()
 * @param {string} preset    — key from WATERFALL_PRESETS, or custom tiers
 * @param {Object} options   — { holdYears, lpEquityShare, gpEquityShare }
 */
export function runWaterfall(model, preset = 'institutional', options = {}) {
  const config = typeof preset === 'string'
    ? WATERFALL_PRESETS[preset]
    : preset;

  if (!config) throw new Error(`Unknown waterfall preset: ${preset}`);

  const {
    holdYears    = model.hold ?? 5,
    lpEquityShare = 0.90,
    gpEquityShare = 0.10,
  } = options;

  const totalEquity = model.equity;
  const lpEquity    = totalEquity * lpEquityShare;
  const gpEquity    = totalEquity * gpEquityShare;

  // Build annual cash flows (operating + exit)
  const annualCFBT = model.cfbt;
  const exitProceeds = model.ep;

  // Total proceeds available for distribution
  const totalCashFlows = Array(holdYears).fill(annualCFBT);
  totalCashFlows[holdYears - 1] += exitProceeds;

  const totalProceeds = totalCashFlows.reduce((a, b) => a + b, 0);

  // ── Multiple-based waterfall ─────────────────────────────────────────────────
  if (config.tiers[0]?.threshold) {
    return calcMultipleWaterfall(config, totalProceeds, totalEquity, lpEquity, gpEquity, totalCashFlows, holdYears);
  }

  // ── IRR-hurdle waterfall ─────────────────────────────────────────────────────
  return calcIRRHurdleWaterfall(config, annualCFBT, exitProceeds, lpEquity, gpEquity, holdYears);
}

function calcMultipleWaterfall(config, totalProceeds, totalEquity, lpEquity, gpEquity, cashFlows, holdYears) {
  let remaining = totalProceeds;
  let lpTotal   = 0;
  let gpTotal   = 0;
  const tierResults = [];

  for (const tier of config.tiers) {
    if (remaining <= 0) break;

    let tierAmount;
    if (tier.threshold.type === 'multiple') {
      tierAmount = Math.min(remaining, totalEquity * tier.threshold.value - (lpTotal + gpTotal));
    } else if (tier.threshold.type === 'irr') {
      // Amount needed to achieve the pref IRR on LP equity
      const targetReturn = lpEquity * tier.threshold.value * holdYears;
      tierAmount = Math.min(remaining, Math.max(0, targetReturn - lpTotal));
    } else {
      tierAmount = remaining; // catch-all
    }

    tierAmount = Math.max(0, Math.min(remaining, tierAmount));

    const lpShare = tierAmount * tier.lpPct;
    const gpShare = tierAmount * tier.gpPct;

    tierResults.push({
      label:     tier.label,
      amount:    Math.round(tierAmount),
      lpAmount:  Math.round(lpShare),
      gpAmount:  Math.round(gpShare),
      lpPct:     Math.round(tier.lpPct * 100),
      gpPct:     Math.round(tier.gpPct * 100),
    });

    lpTotal   += lpShare;
    gpTotal   += gpShare;
    remaining -= tierAmount;
  }

  const lpIRR = calcIRR([-lpEquity, ...Array(holdYears - 1).fill(0), lpTotal]) * 100;
  const gpIRR = calcIRR([-gpEquity, ...Array(holdYears - 1).fill(0), gpTotal]) * 100;

  return {
    config:       config.name,
    totalProceeds: Math.round(totalProceeds),
    totalEquity:  Math.round(totalEquity),
    lpEquity:     Math.round(lpEquity),
    gpEquity:     Math.round(gpEquity),
    lpTotal:      Math.round(lpTotal),
    gpTotal:      Math.round(gpTotal),
    lpMultiple:   Math.round(lpTotal / lpEquity * 100) / 100,
    gpMultiple:   Math.round(gpTotal / gpEquity * 100) / 100,
    lpIRR:        Math.round(lpIRR * 10) / 10,
    gpIRR:        Math.round(gpIRR * 10) / 10,
    tiers:        tierResults,
  };
}

function calcIRRHurdleWaterfall(config, annualCFBT, exitProceeds, lpEquity, gpEquity, holdYears) {
  // Determine which IRR tier the deal falls into
  const totalEquity = lpEquity + gpEquity;
  const totalCF = Array(holdYears).fill(annualCFBT);
  totalCF[holdYears - 1] += exitProceeds;
  const totalProceeds = totalCF.reduce((a, b) => a + b, 0);

  // Calculate unlevered project IRR first
  const projectIRR = calcIRR([-totalEquity, ...totalCF]) * 100;

  // Find applicable tier
  const tier = config.tiers.find(t => projectIRR < t.irrMax * 100) ?? config.tiers[config.tiers.length - 1];

  const lpTotal = totalProceeds * tier.lpPct;
  const gpTotal = totalProceeds * tier.gpPct;

  const lpIRR = calcIRR([-lpEquity, ...Array(holdYears-1).fill(annualCFBT * tier.lpPct),
    (annualCFBT + exitProceeds) * tier.lpPct]) * 100;
  const gpIRR = gpEquity > 0
    ? calcIRR([-gpEquity, ...Array(holdYears-1).fill(annualCFBT * tier.gpPct),
        (annualCFBT + exitProceeds) * tier.gpPct]) * 100
    : 0;

  return {
    config:        config.name,
    projectIRR:    Math.round(projectIRR * 10) / 10,
    appliedTier:   tier.label,
    totalProceeds: Math.round(totalProceeds),
    totalEquity:   Math.round(totalEquity),
    lpEquity:      Math.round(lpEquity),
    gpEquity:      Math.round(gpEquity),
    lpTotal:       Math.round(lpTotal),
    gpTotal:       Math.round(gpTotal),
    lpMultiple:    Math.round(lpTotal / lpEquity * 100) / 100,
    gpMultiple:    gpEquity > 0 ? Math.round(gpTotal / gpEquity * 100) / 100 : 0,
    lpIRR:         Math.round(lpIRR * 10) / 10,
    gpIRR:         Math.round(gpIRR * 10) / 10,
    tierBreakdown: config.tiers.map(t => ({
      label:  t.label,
      lpPct:  Math.round(t.lpPct * 100),
      gpPct:  Math.round(t.gpPct * 100),
      active: t === tier,
    })),
  };
}

// ── Waterfall comparison across presets ───────────────────────────────────────
export function compareWaterfalls(model) {
  return Object.entries(WATERFALL_PRESETS).map(([key, config]) => {
    try {
      const result = runWaterfall(model, key);
      return { preset: key, name: config.name, ...result };
    } catch (e) {
      return { preset: key, name: config.name, error: e.message };
    }
  });
}

// ── Format waterfall for display ──────────────────────────────────────────────
export function formatWaterfall(result) {
  const fmtM = n => n >= 1e6 ? '$' + (Math.round(n/1e5)/10) + 'M'
                  : n >= 1e3 ? '$' + Math.round(n/1e3) + 'K'
                  : '$' + Math.round(n);
  return {
    summary: {
      'LP equity invested':  fmtM(result.lpEquity),
      'GP equity invested':  fmtM(result.gpEquity),
      'Total proceeds':      fmtM(result.totalProceeds),
      'LP total return':     fmtM(result.lpTotal),
      'GP total return':     fmtM(result.gpTotal),
      'LP multiple':         result.lpMultiple + 'x',
      'GP multiple':         result.gpMultiple + 'x',
      'LP IRR':              result.lpIRR + '%',
      'GP IRR':              result.gpIRR + '%',
    },
    tiers: result.tiers ?? result.tierBreakdown,
  };
}
