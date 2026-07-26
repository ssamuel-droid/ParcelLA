/**
 * ParceLLA Financial Model
 * RSMeans-anchored development pro forma for LA multifamily / mixed-use sites
 */

import { RENTS, CAP_RATES, RSMEANS, SCALE_DISCOUNTS } from '../data/submarkets.js';

const DEFAULTS = {
  softPct:       0.18,   // % of hard costs
  vacancyRate:   0.05,   // 5% vacancy
  opexRatio:     0.35,   // 35% operating expense ratio for new/stabilized LA multifamily
  ltc:           0.65,   // loan-to-cost
  interestRate:  0.065,  // 6.5% construction loan
  constructionMo: 18,    // months
  holdYears:     5,
  appreciationRate: 0.03,
  prefReturn:    0.08,   // LP preferred return
  lpSplit:       0.80,   // LP share of excess above pref
  gpSplit:       0.20,   // GP promote
  demolitionCost: 45000, // flat rate if demo required
  exitCapSpread:  0.0025, // 25bps cap rate expansion at exit
  otherIncomePerUnit: 600, // parking/laundry/storage and miscellaneous annual income
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
  if (overrides.hcpsf != null && overrides.hardCostPerSF == null) cfg.hardCostPerSF = +overrides.hcpsf;
  if (overrides.sc != null && overrides.softPct == null) cfg.softPct = +overrides.sc / 100;
  if (overrides.rate != null && overrides.interestRate == null) cfg.interestRate = +overrides.rate;
  if (overrides.months != null && overrides.constructionMo == null) cfg.constructionMo = +overrides.months;
  if (overrides.ltc != null) cfg.ltc = +overrides.ltc;
  const { hood, type, price, units, avgUnitSF, hasDemo, unitMix } = site;

  const R   = RENTS[hood] ?? RENTS['Koreatown'];  // fallback to Koreatown if hood not found
  const cap = CAP_RATES[hood] ?? CAP_RATES['Koreatown'];
  if (!RENTS[hood]) console.warn(`[model] Unknown hood: "${hood}" — using Koreatown fallback`);
  const totalSF = units * avgUnitSF;

  // ── COSTS ──────────────────────────────────────────────────────────────────
  const hardCostOverride = cfg.hardCostPerSF != null ? +cfg.hardCostPerSF : null;
  const hardCosts    = calcHardCosts(type, totalSF, hardCostOverride);
  const softCosts    = hardCosts * cfg.softPct;
  const demolition   = hasDemo ? cfg.demolitionCost : 0;
  // Size loan on pre-carry cost basis (standard construction loan sizing)
  const preLoanCost  = price + hardCosts + softCosts + demolition;
  const loanAmount   = preLoanCost * cfg.ltc;
  const carryCost    = loanAmount * cfg.interestRate * (cfg.constructionMo / 12);
  const totalCost    = preLoanCost + carryCost;

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
  const vacancyLoss         = grossPotentialRent * cfg.vacancyRate;
  const otherIncome         = (cfg.otherIncomePerUnit ?? 0) * units;
  const effectiveGrossIncome = grossPotentialRent - vacancyLoss + otherIncome;
  const operatingExpenses   = effectiveGrossIncome * cfg.opexRatio;
  const noi                 = effectiveGrossIncome - operatingExpenses;
  const expenseDetail = {
    propertyTaxes:       operatingExpenses * 0.22,
    insurance:           operatingExpenses * 0.08,
    utilities:           operatingExpenses * 0.08,
    repairsMaintenance:  operatingExpenses * 0.12,
    payrollAdmin:        operatingExpenses * 0.16,
    managementFee:       operatingExpenses * 0.08,
    marketingTurnover:   operatingExpenses * 0.06,
    replacementReserves: operatingExpenses * 0.08,
    otherOperating:      operatingExpenses * 0.12,
  };

  // ── VALUATION ──────────────────────────────────────────────────────────────
  const stabilizedValue = noi / cap;
  const capRateOnCost   = noi / totalCost;

  // ── CASH FLOW ──────────────────────────────────────────────────────────────
  // Development deals: interest-only during hold period (5yr)
  // Typical perm loan is I/O for 3-5 years then converts
  const permRate    = cfg.interestRate;   // 6.5%
  const debtService = loanAmount * permRate;  // I/O annual debt service
  const equity      = totalCost - loanAmount;
  const cfbt        = noi - debtService;
  const cocReturn   = cfbt / equity;

  // ── HOLD PERIOD & EXIT ─────────────────────────────────────────────────────
  const exitCapRate  = cap + (cfg.exitCapSpread ?? 0.0025);
  const year5Noi     = noi * Math.pow(1 + cfg.appreciationRate, Math.max(0, cfg.holdYears - 1));
  const exitValue    = year5Noi / exitCapRate;
  const devSpread    = exitValue - totalCost;
  const devSpreadPct = devSpread / totalCost;
  // Loan balance at exit (I/O — principal unchanged)
  const exitProceeds = exitValue - loanAmount;

  // Annual cash flows (levered)
  // IRR cashflows: equity in at start, CFBT each year, equity + net profit at exit
  const cashflows = [-equity];
  for (let y = 1; y < cfg.holdYears; y++) {
    const yearNoi = noi * Math.pow(1 + cfg.appreciationRate, y - 1);
    cashflows.push(yearNoi - debtService);
  }
  cashflows.push((year5Noi - debtService) + exitProceeds);  // exitProceeds = exit - loan (equity return)

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
    blendedRent, grossPotentialRent, vacancyLoss, otherIncome, effectiveGrossIncome, operatingExpenses, expenseDetail, noi, year5Noi,

    // valuation
    stabilizedValue, devSpread, devSpreadPct, capRateOnCost, marketCapRate: cap, exitCapRate,

    // cash flow
    debtService, cfbt, cocReturn,

    // returns
    leveragedIRR, equityMultiple, exitValue, exitProceeds,
    netProfit: exitValue - totalCost,  // true development profit

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
