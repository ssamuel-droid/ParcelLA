/**
 * ParceLLA — Construction Draw Schedule (S-Curve)
 *
 * Models actual cash deployment over the construction period
 * using a beta distribution S-curve — slow start, fast middle, slow finish.
 *
 * This replaces the flat carry cost estimate with a proper
 * month-by-month interest calculation based on actual draws.
 *
 * Industry benchmarks (RSMeans / CBRE Construction Monitor):
 *   - Month 1-3:   mobilization, site work, foundation (~15% of hard costs)
 *   - Month 4-12:  framing, MEP rough-in, drywall (~55% of hard costs)
 *   - Month 13-18: finishes, fixtures, punch list (~30% of hard costs)
 *
 * Soft costs draw differently:
 *   - Permits/fees: front-loaded (paid at permit issuance)
 *   - A&E: pro-rata with construction progress
 *   - Contingency: back-loaded (drawn as needed)
 */

// ── S-curve generator ─────────────────────────────────────────────────────────
/**
 * Generate monthly draw percentages using a beta distribution approximation
 * @param {number} months — total construction period
 * @param {string} type   — 'standard' | 'front_loaded' | 'back_loaded'
 * @returns {number[]} Array of monthly draw percentages summing to 1.0
 */
export function generateSCurve(months, type = 'standard') {
  const points = Array.from({ length: months }, (_, i) => (i + 0.5) / months);

  // Beta distribution approximations by construction phase
  const PARAMS = {
    standard:     { alpha: 2.5, beta: 2.5 },   // symmetric bell
    front_loaded: { alpha: 1.5, beta: 3.0 },   // faster early draws
    back_loaded:  { alpha: 3.0, beta: 1.5 },   // finishes heavy
    residential:  { alpha: 2.0, beta: 2.8 },   // LA multifamily typical
  };

  const { alpha, beta } = PARAMS[type] ?? PARAMS.standard;

  // Incomplete beta function approximation
  function betaPDF(x, a, b) {
    return Math.pow(x, a - 1) * Math.pow(1 - x, b - 1);
  }

  const raw = points.map(x => betaPDF(x, alpha, beta));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(v => v / sum);
}

// ── Full draw schedule ─────────────────────────────────────────────────────────
/**
 * Build month-by-month draw schedule with interest accrual
 *
 * @param {Object} params
 * @param {number} params.hardCosts          — total hard costs
 * @param {number} params.softCosts          — total soft costs
 * @param {number} params.loanAmount         — construction loan amount
 * @param {number} params.equityRequired     — total equity (hard+soft − loan)
 * @param {number} params.interestRate       — annual rate (e.g. 0.065)
 * @param {number} params.constructionMonths — e.g. 18
 * @param {string} params.curveType          — 'residential' | 'standard'
 * @param {number} params.retainage          — % withheld from contractor (default 10%)
 * @returns {Object} Full draw schedule + summary
 */
export function buildDrawSchedule(params) {
  const {
    hardCosts,
    softCosts,
    loanAmount,
    equityRequired,
    interestRate     = 0.065,
    constructionMonths = 18,
    curveType        = 'residential',
    retainage        = 0.10,
  } = params;

  const monthlyRate = interestRate / 12;
  const totalCost   = hardCosts + softCosts;
  const ltc         = loanAmount / totalCost;

  // Generate S-curves for hard and soft costs separately
  const hardCurve = generateSCurve(constructionMonths, curveType);
  const softCurve = generateSCurve(constructionMonths, 'front_loaded'); // permits front-loaded

  // Retainage — withheld from contractor draws, released at completion
  const retainagePool = [];

  let loanBalance       = 0;
  let equityDrawn       = 0;
  let totalInterest     = 0;
  let cumulativeHard    = 0;
  let cumulativeSoft    = 0;
  let cumulativeRetain  = 0;

  const schedule = [];

  for (let mo = 0; mo < constructionMonths; mo++) {
    const hardDraw = hardCosts * hardCurve[mo];
    const softDraw = softCosts * softCurve[mo];
    const totalDraw = hardDraw + softDraw;

    // Retainage on hard costs only
    const retainHeld = hardDraw * retainage;
    const netDraw    = totalDraw - retainHeld;
    cumulativeRetain += retainHeld;

    // Equity drawn first, then loan
    const loanDraw   = Math.min(netDraw * ltc, loanAmount - loanBalance);
    const equityDraw = netDraw - loanDraw;

    // Interest accrues on outstanding loan balance mid-month
    const monthInterest = (loanBalance + loanDraw / 2) * monthlyRate;

    loanBalance   += loanDraw + monthInterest;
    equityDrawn   += equityDraw;
    totalInterest += monthInterest;
    cumulativeHard += hardDraw;
    cumulativeSoft += softDraw;

    schedule.push({
      month:            mo + 1,
      hardDraw:         Math.round(hardDraw),
      softDraw:         Math.round(softDraw),
      totalDraw:        Math.round(totalDraw),
      retainageHeld:    Math.round(retainHeld),
      netDraw:          Math.round(netDraw),
      loanDraw:         Math.round(loanDraw),
      equityDraw:       Math.round(equityDraw),
      monthInterest:    Math.round(monthInterest),
      loanBalance:      Math.round(loanBalance),
      equityDrawn:      Math.round(equityDrawn),
      cumulativeHard:   Math.round(cumulativeHard),
      cumulativeSoft:   Math.round(cumulativeSoft),
      pctComplete:      Math.round(cumulativeHard / hardCosts * 100),
    });
  }

  // Final month: release retainage
  const retainageRelease = Math.round(cumulativeRetain);
  const finalInterest    = loanBalance * monthlyRate;
  loanBalance           += retainageRelease * ltc + finalInterest;

  // Summary
  const flatCarryEstimate = loanAmount * interestRate * (constructionMonths / 12);
  const actualCarry       = Math.round(totalInterest + finalInterest);
  const carryDelta        = actualCarry - Math.round(flatCarryEstimate);

  return {
    schedule,
    summary: {
      totalHardCosts:    Math.round(hardCosts),
      totalSoftCosts:    Math.round(softCosts),
      totalCost:         Math.round(totalCost),
      loanAmount:        Math.round(loanAmount),
      equityRequired:    Math.round(equityRequired),
      constructionMonths,
      interestRate,
      retainage,
      totalInterestActual: actualCarry,
      totalInterestFlat:   Math.round(flatCarryEstimate),
      carryDelta,           // actual vs flat estimate difference
      retainageReleased:   retainageRelease,
      peakLoanBalance:     Math.round(Math.max(...schedule.map(s => s.loanBalance))),
      peakEquityDrawn:     Math.round(Math.max(...schedule.map(s => s.equityDrawn))),
      avgMonthlyDraw:      Math.round(totalCost / constructionMonths),
      curveType,
    },
    // Quarterly rollup for reporting
    quarterly: rollupQuarterly(schedule),
  };
}

function rollupQuarterly(schedule) {
  const quarters = [];
  for (let q = 0; q < Math.ceil(schedule.length / 3); q++) {
    const months = schedule.slice(q * 3, q * 3 + 3);
    quarters.push({
      quarter:       q + 1,
      hardDraw:      months.reduce((a, m) => a + m.hardDraw, 0),
      softDraw:      months.reduce((a, m) => a + m.softDraw, 0),
      totalDraw:     months.reduce((a, m) => a + m.totalDraw, 0),
      interest:      months.reduce((a, m) => a + m.monthInterest, 0),
      loanBalance:   months[months.length - 1]?.loanBalance ?? 0,
      pctComplete:   months[months.length - 1]?.pctComplete ?? 0,
    });
  }
  return quarters;
}

// ── Loan sizing calculator ─────────────────────────────────────────────────────
/**
 * Calculate maximum loan amount constrained by:
 *   1. LTC (loan-to-cost) — lender's cost-based limit
 *   2. DSCR (debt service coverage ratio) — income-based limit
 *   3. LTV at stabilization — value-based limit
 *
 * Returns the binding constraint and max loan under each test.
 */
export function calcMaxLoan(params) {
  const {
    totalCost,
    noi,
    stabilizedValue,
    targetDSCR   = 1.25,    // minimum DSCR lender requires
    maxLTC       = 0.65,    // max loan-to-cost
    maxLTV       = 0.70,    // max loan-to-stabilized-value
    loanRate     = 0.065,
    amortYears   = 30,
    iOPeriod     = true,    // interest-only during construction?
  } = params;

  // LTC constraint
  const loanByLTC = totalCost * maxLTC;

  // DSCR constraint — max loan where NOI / debt_service >= targetDSCR
  // Annual P&I payment on fully amortizing loan: PMT formula
  const monthlyRate = loanRate / 12;
  const n           = amortYears * 12;
  function pmt(principal) {
    if (iOPeriod) return principal * loanRate; // I/O = just interest
    return principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) /
           (Math.pow(1 + monthlyRate, n) - 1) * 12;
  }

  // Binary search for max loan where NOI / pmt(loan) >= targetDSCR
  let lo = 0, hi = totalCost;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (noi / pmt(mid) >= targetDSCR) lo = mid;
    else hi = mid;
  }
  const loanByDSCR = Math.round(lo);

  // LTV constraint
  const loanByLTV = stabilizedValue * maxLTV;

  // Binding constraint = minimum of all three
  const constraints = {
    ltc:  Math.round(loanByLTC),
    dscr: loanByDSCR,
    ltv:  Math.round(loanByLTV),
  };
  const maxLoan      = Math.min(...Object.values(constraints));
  const bindingTest  = Object.entries(constraints).find(([, v]) => v === maxLoan)[0];

  const dscrAtMax    = noi / pmt(maxLoan);
  const ltcAtMax     = maxLoan / totalCost;
  const ltvAtMax     = maxLoan / stabilizedValue;

  return {
    maxLoan,
    bindingConstraint: bindingTest,
    constraints,
    atMaxLoan: {
      dscr:    Math.round(dscrAtMax * 100) / 100,
      ltc:     Math.round(ltcAtMax * 1000) / 10,
      ltv:     Math.round(ltvAtMax * 1000) / 10,
      annualDS: Math.round(pmt(maxLoan)),
    },
    // Sensitivity: loan at each DSCR target
    dscrSensitivity: [1.15, 1.20, 1.25, 1.30, 1.35].map(target => {
      let lo2 = 0, hi2 = totalCost;
      for (let i = 0; i < 50; i++) {
        const mid = (lo2 + hi2) / 2;
        if (noi / pmt(mid) >= target) lo2 = mid; else hi2 = mid;
      }
      return { targetDSCR: target, maxLoan: Math.round(lo2),
               ltc: Math.round(lo2 / totalCost * 1000) / 10 };
    }),
  };
}
