/**
 * ParceLLA Financial Model
 * RSMeans-anchored development pro forma for LA multifamily / mixed-use sites
 */

import { RENTS, CAP_RATES, RSMEANS, SCALE_DISCOUNTS } from '../data/submarkets.js';

const DEFAULTS = {
  softPct:       0.18,   // % of hard costs
  vacancyRate:   0.05,   // 5% vacancy
  opexRatio:     0.38,   // 38% operating expense ratio (LA multifamily benchmark)
  ltc:           0.65,   // loan-to-cost
  interestRate:  0.065,  // 6.5% construction loan
  constructionMo: 18,    // months
  holdYears:     5,
  appreciationRate: 0.03,
  prefReturn:    0.08,   // LP preferred return
  lpSplit:       0.80,   // LP share of excess above pref
  gpSplit:       0.20,   // GP promote
  demolitionCost: 45000, // flat rate if demo required
  exitCapSpread:  0.0050, // 50bps cap rate expansion at exit (development premium)
};

/**
 * Newton-Raphson IRR solver
 */
export function calcIRR(cashflows, guess = 0.15) {
  let rate = guess;
  for (let i = 0; i < 200; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const pv = Math.pow(1 + rate, t);
      npv  += cashflows[t] / pv;
      dnpv -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(npv) < 0.50) break;
    if (dnpv !== 0) rate -= npv / dnpv;
    rate = Math.max(-0.90, Math.min(5.0, rate));
  }
  return rate;
}

/**
 * Calculate hard costs with RSMeans base and scale discounts
 */
export function calcHardCosts(projectType, totalSF, overridePerSF = null) {
  const basePerSF = overridePerSF ?? RSMEANS[projectType] ?? 285;
  let cost = basePerSF * totalSF;
  for (const { minSF, discount } of SCALE_DISCOUNTS) {
    if (totalSF > minSF) { cost *= (1 - discount); break; }
  }
  return Math.round(cost);
}

/**
 * Full development pro forma
 * @param {Object} site - site data
 * @param {Object} overrides - user overrides for any assumption
 * @returns {Object} complete financial model output
 */
export function runModel(site, overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  const { hood, type, price, units, avgUnitSF, hasDemo, unitMix } = site;

  const R   = RENTS[hood];
  const cap = CAP_RATES[hood];
  const totalSF = units * avgUnitSF;

  // ── COSTS ──────────────────────────────────────────────────────────────────
  const hardCosts   = calcHardCosts(type, totalSF, overrides.hardCostPerSF);
  const softCosts   = hardCosts * cfg.softPct;
  const loanAmount  = (hardCosts + softCosts) * cfg.ltc;
  const carryCost   = loanAmount * cfg.interestRate * (cfg.constructionMo / 12);
  const demolition  = hasDemo ? cfg.demolitionCost : 0;
  const totalCost   = price + hardCosts + softCosts + carryCost + demolition;

  // Soft cost breakdown
  const softDetail = {
    archEngineering: hardCosts * 0.06,
    permitsAndFees:  units * 2500,
    titleEscrowLegal: price * 0.015 + 35000,
    developerFee:    hardCosts * 0.03,
    contingency:     hardCosts * 0.05,
  };

  // ── INCOME ─────────────────────────────────────────────────────────────────
  const blendedRent = (
    (unitMix.studio ?? 0) * R.studio +
    (unitMix.one    ?? 0) * R.one    +
    (unitMix.two    ?? 0) * R.two    +
    (unitMix.three  ?? 0) * R.three
  );
  const grossPotentialRent  = blendedRent * 12 * units;
  const effectiveGrossIncome = grossPotentialRent * (1 - cfg.vacancyRate);
  const operatingExpenses   = effectiveGrossIncome * cfg.opexRatio;
  const noi                 = effectiveGrossIncome - operatingExpenses;

  // ── VALUATION ──────────────────────────────────────────────────────────────
  const stabilizedValue = noi / cap;
  const devSpread       = stabilizedValue - totalCost;
  const devSpreadPct    = devSpread / totalCost;
  const capRateOnCost   = noi / totalCost;

  // ── CASH FLOW ──────────────────────────────────────────────────────────────
  // Permanent loan: sized at 65% LTC, 30yr amortization at 6.5%
  const permRate    = cfg.interestRate;   // 6.5%
  const permMo      = permRate / 12;
  const permN       = 30 * 12;            // 30-year amortization
  // Monthly P&I payment
  const monthlyPI   = loanAmount * (permMo * Math.pow(1 + permMo, permN)) /
                      (Math.pow(1 + permMo, permN) - 1);
  const debtService = monthlyPI * 12;     // annual debt service
  const equity      = totalCost - loanAmount;
  const cfbt        = noi - debtService;
  const cocReturn   = cfbt / equity;

  // ── HOLD PERIOD & EXIT ─────────────────────────────────────────────────────
  const exitCapRate  = cap + (cfg.exitCapSpread ?? 0.0025);
  const exitValue    = noi / exitCapRate;
  // Remaining loan balance after 5 years of amortization
  const loanBalance5 = loanAmount * Math.pow(1 + permMo, 60) -
    monthlyPI * (Math.pow(1 + permMo, 60) - 1) / permMo;
  const exitProceeds = exitValue - loanBalance5;

  // Annual cash flows (levered)
  const cashflows = [-equity];
  for (let y = 1; y < cfg.holdYears; y++) cashflows.push(cfbt);
  cashflows.push(cfbt + exitProceeds);

  const leveragedIRR  = calcIRR(cashflows) * 100;
  const equityMultiple = exitProceeds / equity;

  // ── WATERFALL ──────────────────────────────────────────────────────────────
  const prefAmount  = equity * cfg.prefReturn;
  const afterPref   = Math.max(0, cfbt - prefAmount);
  const lpAnnual    = prefAmount + afterPref * cfg.lpSplit;
  const gpAnnual    = afterPref * cfg.gpSplit;

  // ── SENSITIVITY GRIDS ──────────────────────────────────────────────────────
  const rentDeltas = [-0.10, -0.05, 0, 0.05, 0.10];
  const capDeltas  = [-0.005, -0.0025, 0, 0.0025, 0.005];

  const irrSensitivity = capDeltas.map(cd =>
    rentDeltas.map(rd => {
      const noi2   = effectiveGrossIncome * (1 + rd) * (1 - cfg.opexRatio);
      const val2   = noi2 / Math.max(0.001, cap + cd);
      const cfbt2  = noi2 - debtService;
      const ep2    = val2 * Math.pow(1 + cfg.appreciationRate, cfg.holdYears) - loanAmount * 1.01;
      const cfs2   = [-equity, ...Array(cfg.holdYears - 1).fill(cfbt2), cfbt2 + ep2];
      return Math.round(calcIRR(cfs2) * 1000) / 10;
    })
  );

  return {
    // inputs echoed
    hood, type, price, units, avgUnitSF, totalSF, unitMix, cap,

    // costs
    hardCosts, softCosts, softDetail, carryCost, demolition, totalCost,
    loanAmount, equity,

    // income
    blendedRent, grossPotentialRent, effectiveGrossIncome, operatingExpenses, noi,

    // valuation
    stabilizedValue, devSpread, devSpreadPct, capRateOnCost, marketCapRate: cap,

    // cash flow
    debtService, cfbt, cocReturn,

    // returns
    leveragedIRR, equityMultiple, exitValue, exitProceeds,

    // waterfall
    prefAmount, lpAnnual, gpAnnual,

    // sensitivity
    irrSensitivity, rentDeltas, capDeltas,

    // convenience
    pricePerUnit: price / units,
    costPerUnit:  totalCost / units,
    costPerSF:    totalCost / totalSF,
  };
}

/**
 * Scenario runner — bear / base / bull
 */
export function runScenarios(site, baseOverrides = {}) {
  return {
    bear: runModel(site, { ...baseOverrides,
      hardCostPerSF: (RSMEANS[site.type] ?? 285) * 1.08,
      vacancyRate: 0.08,
    }),
    base: runModel(site, baseOverrides),
    bull: runModel(site, { ...baseOverrides,
      hardCostPerSF: (RSMEANS[site.type] ?? 285) * 0.95,
      vacancyRate: 0.04,
    }),
  };
}
