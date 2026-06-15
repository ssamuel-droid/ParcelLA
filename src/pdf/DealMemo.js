/**
 * ParceLLA — PDF Deal Memo Generator
 *
 * Generates a professional single-site deal package:
 *   Page 1: Executive summary — address, key metrics, recommendation
 *   Page 2: Cost waterfall + income model
 *   Page 3: 5-year cash flow + exit analysis
 *   Page 4: Sensitivity heatmaps
 *
 * Runtime: Node.js (server-side)
 * Dependencies: npm install puppeteer
 *
 * Usage:
 *   const { generateDealMemo } = require('./pdf/DealMemo');
 *   const pdf = await generateDealMemo(siteModel, overrides);
 *   res.set('Content-Type', 'application/pdf');
 *   res.send(pdf);
 */

const puppeteer = require('puppeteer');
const path      = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtM = n => n >= 1e6 ? '$' + (Math.round(n / 1e5) / 10) + 'M'
                : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K'
                : '$' + Math.round(n);
const fmtD = n => '$' + Math.round(n).toLocaleString();
const fmtP = n => (Math.round(n * 10) / 10) + '%';
const irrColor = v => v >= 18 ? '#1d9e75' : v >= 12 ? '#ef9f27' : '#e24b4a';
const qLabel   = v => v >= 18 ? 'Strong' : v >= 12 ? 'Moderate' : 'Weak';

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML(m, date) {
  const profitColor = m.netProfit > 0 ? '#1d9e75' : '#e24b4a';
  const barMax = m.totalCost;
  const bar = (v, color, label) => `
    <div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-bottom:2px">
        <span>${label}</span><span>${fmtD(v)}</span>
      </div>
      <div style="height:10px;background:#f0f0f0;border-radius:3px;overflow:hidden">
        <div style="width:${Math.round(v/barMax*100)}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
    </div>`;

  // Sensitivity grid
  const rds = [-0.10,-0.05,0,0.05,0.10];
  const cds = [-0.005,-0.0025,0,0.0025,0.005];
  const rdL = ['−10%','−5%','Base','+5%','+10%'];
  const cdL = ['+50bps','+25bps','Base','−25bps','−50bps'];

  function sensIRR(rd, cd) {
    const egr2 = m.egr * (1 + rd);
    const cap2 = Math.max(0.001, m.entryCap + cd);
    const noi2 = egr2 * (1 - m.opex / m.egr);
    const val2 = noi2 / cap2;
    const cfbt2 = noi2 - m.ds;
    const ev2 = val2 * Math.pow(1.03, 5);
    const ep2 = ev2 - m.loan * 1.01;
    const cfs = [-m.equity, cfbt2, cfbt2, cfbt2, cfbt2, cfbt2 + ep2];
    let r = 0.15;
    for (let i = 0; i < 100; i++) {
      let n = 0, d = 0;
      for (let t = 0; t < cfs.length; t++) {
        n += cfs[t] / Math.pow(1+r,t);
        d -= t * cfs[t] / Math.pow(1+r,t+1);
      }
      if (Math.abs(n) < 0.5) break;
      if (d) r -= n/d;
      r = Math.max(-0.9, Math.min(5, r));
    }
    return Math.round(r * 1000) / 10;
  }

  const sensRows = cds.map((cd, ci) => `
    <tr>
      <td style="background:#f5f5f5;font-weight:500;padding:4px 6px;font-size:9px">${cdL[ci]}</td>
      ${rds.map((rd, ri) => {
        const v = sensIRR(rd, cd);
        const bg = v >= 18 ? '#e1f5ee' : v >= 12 ? '#faeeda' : '#fcebeb';
        const fc = v >= 18 ? '#085041' : v >= 12 ? '#854f0b' : '#a32d2d';
        return `<td style="background:${bg};color:${fc};font-weight:500;text-align:center;padding:4px 6px;font-size:9px">${v}%</td>`;
      }).join('')}
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a1a; }
  .page { width: 816px; min-height: 1056px; padding: 36px 40px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .navy { background: #0f1f3d; color: white; }
  .gold { color: #c49a3c; }
  h1 { font-size: 20px; font-weight: 700; }
  h2 { font-size: 13px; font-weight: 700; margin: 0 0 10px; }
  h3 { font-size: 11px; font-weight: 700; color: #0f1f3d; background: #e6f1fb; padding: 5px 8px; margin: 16px 0 8px; border-left: 3px solid #0f1f3d; }
  .metric-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 12px 0; }
  .metric { background: #f5f5f5; border-radius: 6px; padding: 10px 12px; }
  .metric-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .metric-val { font-size: 18px; font-weight: 700; }
  .metric-sub { font-size: 9px; color: #888; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
  td, th { padding: 5px 7px; border-bottom: 0.5px solid #eee; }
  th { background: #0f1f3d; color: white; font-weight: 600; font-size: 9px; }
  tr.total td { font-weight: 700; border-top: 1px solid #ccc; border-bottom: none; padding-top: 7px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .disclaimer { font-size: 8px; color: #aaa; margin-top: 20px; padding-top: 10px; border-top: 0.5px solid #eee; }
  @media print { .page { page-break-after: always; } }
</style>
</head>
<body>

<!-- PAGE 1: EXECUTIVE SUMMARY -->
<div class="page">
  <div style="background:#0f1f3d;color:white;padding:20px 24px;margin:-36px -40px 24px;border-bottom:4px solid #c49a3c">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:10px;color:#c49a3c;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">ParceLLA — Deal Memo</div>
        <h1>${m.addr}</h1>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px">${m.hood}, Los Angeles · ${m.zone} · ${m.units} units · ${m.tSF.toLocaleString()} SF buildable</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:9px;color:rgba(255,255,255,0.5)">${date}</div>
        <div style="font-size:10px;color:#c49a3c;margin-top:4px">${m.rti ? '✓ RTI Approved' : m.isComp ? 'Off-market / Comp' : 'For Sale'}</div>
        <div style="font-size:11px;color:white;margin-top:2px">${m.isComp ? 'Land imputed' : fmtD(m.askPrice)}</div>
      </div>
    </div>
  </div>

  <div class="metric-grid">
    <div class="metric">
      <div class="metric-label">Net profit</div>
      <div class="metric-val" style="color:${profitColor};font-size:22px">${fmtM(m.netProfit)}</div>
      <div class="metric-sub">Exit value − all-in cost</div>
    </div>
    <div class="metric">
      <div class="metric-label">Levered IRR</div>
      <div class="metric-val" style="color:${irrColor(m.irrV)}">${m.irrV}%</div>
      <div class="metric-sub">5-yr hold · ${qLabel(m.irrV)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Cap rate on cost</div>
      <div class="metric-val">${fmtP(m.capOnCost)}</div>
      <div class="metric-sub">vs ${fmtP(m.entryCap * 100)} market cap</div>
    </div>
    <div class="metric">
      <div class="metric-label">Dev spread</div>
      <div class="metric-val">${m.devSpreadPct}%</div>
      <div class="metric-sub">${fmtM(m.devSpread)} above cost</div>
    </div>
    <div class="metric">
      <div class="metric-label">Total all-in cost</div>
      <div class="metric-val" style="font-size:14px">${fmtM(m.totalCost)}</div>
      <div class="metric-sub">${fmtD(Math.round(m.totalCost/m.units))}/unit</div>
    </div>
    <div class="metric">
      <div class="metric-label">Exit value</div>
      <div class="metric-val" style="font-size:14px">${fmtM(m.exitValue)}</div>
      <div class="metric-sub">NOI ÷ ${fmtP(m.exitCap * 100)} exit cap</div>
    </div>
    <div class="metric">
      <div class="metric-label">NOI (stabilized)</div>
      <div class="metric-val" style="font-size:14px">${fmtM(m.noi)}</div>
      <div class="metric-sub">${fmtD(Math.round(m.noi/m.units))}/unit/yr</div>
    </div>
    <div class="metric">
      <div class="metric-label">Equity multiple</div>
      <div class="metric-val">${m.eqMult}x</div>
      <div class="metric-sub">Cash-on-cash: ${m.coc}%</div>
    </div>
  </div>

  <h3>Site overview</h3>
  <div class="two-col">
    <table>
      <tr><td>Address</td><td style="font-weight:600">${m.addr}</td></tr>
      <tr><td>Neighborhood</td><td>${m.hood}</td></tr>
      <tr><td>Zoning</td><td>${m.zone}</td></tr>
      <tr><td>Lot size</td><td>${m.lot.toLocaleString()} SF</td></tr>
      <tr><td>Project type</td><td>${m.type}</td></tr>
      <tr><td>Status</td><td>${m.rti ? 'RTI Approved' : m.isComp ? 'Off-market' : 'For Sale'}</td></tr>
    </table>
    <table>
      <tr><td>Buildable units</td><td style="font-weight:600">${m.units}</td></tr>
      <tr><td>Avg unit size</td><td>${m.usf} SF</td></tr>
      <tr><td>Total buildable SF</td><td>${m.tSF.toLocaleString()} SF</td></tr>
      <tr><td>Land cost</td><td>${fmtD(m.landCost)}${m.isComp ? ' (imputed)' : ''}</td></tr>
      <tr><td>Hard cost/SF</td><td>$${m.hcpsf} (RSMeans 2024)</td></tr>
      <tr><td>Demolition</td><td>${m.demo ? 'Yes — $45,000' : 'No'}</td></tr>
    </table>
  </div>

  <h3>Capital stack</h3>
  <table>
    <tr><th>Source</th><th>Amount</th><th>% of Cost</th><th>Rate / Notes</th></tr>
    <tr><td>Construction Loan (65% LTC)</td><td>${fmtD(m.loan)}</td><td>${Math.round(m.loan/m.totalCost*100)}%</td><td>6.5% / 18-month I/O</td></tr>
    <tr><td>LP Equity (90%)</td><td>${fmtD(Math.round(m.equity*0.9))}</td><td>${Math.round(m.equity*0.9/m.totalCost*100)}%</td><td>8% pref return</td></tr>
    <tr><td>GP Equity (10%)</td><td>${fmtD(Math.round(m.equity*0.1))}</td><td>${Math.round(m.equity*0.1/m.totalCost*100)}%</td><td>20% promote above pref</td></tr>
    <tr class="total"><td>Total</td><td>${fmtD(m.totalCost)}</td><td>100%</td><td></td></tr>
  </table>

  <div class="disclaimer">
    This analysis was generated by ParceLLA using RSMeans 2024 construction cost data, LA submarket rent comps, and Prop 13 property tax modeling.
    All projections are estimates based on current market conditions and are subject to change. This is not investment advice.
    Prepared ${date}.
  </div>
</div>

<!-- PAGE 2: COST WATERFALL + INCOME MODEL -->
<div class="page">
  <div style="border-bottom:3px solid #0f1f3d;padding-bottom:10px;margin-bottom:16px">
    <div style="font-size:9px;color:#c49a3c;letter-spacing:1px;text-transform:uppercase">ParceLLA Deal Memo — Page 2</div>
    <h1 style="font-size:16px;color:#0f1f3d">${m.addr} — Development Budget & Income</h1>
  </div>

  <div class="two-col">
    <div>
      <h3>Cost waterfall</h3>
      ${bar(m.landCost, '#0f1f3d', 'Land' + (m.isComp ? ' (imputed)' : ''))}
      ${bar(m.hard, '#378add', `Hard costs ($${m.hcpsf}/SF)`)}
      ${bar(m.soft, '#1d9e75', `Soft costs (${Math.round(m.soft/m.hard*100)}%)`)}
      ${bar(m.carry, '#ef9f27', 'Financing carry')}
      ${m.demolition ? bar(m.demolition, '#e24b4a', 'Demolition') : ''}
      <table style="margin-top:8px">
        <tr class="total"><td>Total all-in cost</td><td style="text-align:right">${fmtD(m.totalCost)}</td></tr>
        <tr><td style="color:#888">Per unit</td><td style="text-align:right;color:#888">${fmtD(Math.round(m.totalCost/m.units))}</td></tr>
        <tr><td style="color:#888">Per buildable SF</td><td style="text-align:right;color:#888">$${Math.round(m.totalCost/m.tSF)}</td></tr>
      </table>

      <h3 style="margin-top:16px">Cost detail</h3>
      <table>
        <tr><td>Land / acquisition</td><td style="text-align:right">${fmtD(m.landCost)}</td></tr>
        <tr><td>Hard costs (RSMeans)</td><td style="text-align:right">${fmtD(m.hard)}</td></tr>
        <tr><td style="padding-left:14px;color:#666">Soft costs (${Math.round(m.soft/m.hard*100)}%)</td><td style="text-align:right;color:#666">${fmtD(m.soft)}</td></tr>
        <tr><td style="padding-left:14px;color:#666">Construction financing</td><td style="text-align:right;color:#666">${fmtD(m.carry)}</td></tr>
        ${m.demolition ? `<tr><td style="padding-left:14px;color:#666">Demolition</td><td style="text-align:right;color:#666">${fmtD(m.demolition)}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td style="text-align:right">${fmtD(m.totalCost)}</td></tr>
      </table>
    </div>

    <div>
      <h3>Year 1 income model</h3>
      <table>
        <tr><td>Blended rent/unit/mo</td><td style="text-align:right">${fmtD(m.blend)}</td></tr>
        <tr><td>Gross potential rent</td><td style="text-align:right">${fmtD(Math.round(m.blend*12*m.units))}</td></tr>
        <tr><td style="color:#e24b4a">Less: Vacancy (5%)</td><td style="text-align:right;color:#e24b4a">−${fmtD(Math.round(m.blend*12*m.units*0.05))}</td></tr>
        <tr><td>Effective gross income</td><td style="text-align:right;font-weight:600">${fmtD(m.egr)}</td></tr>
        <tr><td style="color:#e24b4a;padding-left:14px">Property tax (Prop 13)</td><td style="text-align:right;color:#e24b4a">−${fmtD(m.propTax)}</td></tr>
        <tr><td style="color:#e24b4a;padding-left:14px">Mgmt, insurance, maint.</td><td style="text-align:right;color:#e24b4a">−${fmtD(m.opex - m.propTax)}</td></tr>
        <tr class="total"><td>Net operating income</td><td style="text-align:right">${fmtD(m.noi)}</td></tr>
        <tr><td style="color:#888">Per unit / year</td><td style="text-align:right;color:#888">${fmtD(Math.round(m.noi/m.units))}</td></tr>
      </table>

      <h3 style="margin-top:16px">Valuation bridge</h3>
      <table>
        <tr><td>NOI</td><td style="text-align:right">${fmtD(m.noi)}</td></tr>
        <tr><td>Entry cap rate (${fmtP(m.entryCap*100)})</td><td style="text-align:right">${fmtD(m.stabValue)}</td></tr>
        <tr><td><strong>Exit cap rate (${fmtP(m.exitCap*100)})</strong></td><td style="text-align:right;font-weight:700">${fmtD(m.exitValue)}</td></tr>
        <tr><td style="color:#e24b4a">Less: all-in cost</td><td style="text-align:right;color:#e24b4a">−${fmtD(m.totalCost)}</td></tr>
        <tr class="total" style="color:${profitColor}"><td>Net profit</td><td style="text-align:right;font-size:14px">${fmtD(m.netProfit)}</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- PAGE 3: CASH FLOW + EXIT -->
<div class="page">
  <div style="border-bottom:3px solid #0f1f3d;padding-bottom:10px;margin-bottom:16px">
    <div style="font-size:9px;color:#c49a3c;letter-spacing:1px;text-transform:uppercase">ParceLLA Deal Memo — Page 3</div>
    <h1 style="font-size:16px;color:#0f1f3d">${m.addr} — 5-Year Hold Analysis</h1>
  </div>

  <h3>Year-by-year cash flow (5-year hold)</h3>
  <table>
    <tr>
      <th>Line item</th>
      <th style="text-align:right">Year 1</th>
      <th style="text-align:right">Year 2</th>
      <th style="text-align:right">Year 3</th>
      <th style="text-align:right">Year 4</th>
      <th style="text-align:right">Year 5</th>
    </tr>
    ${[1,2,3,4,5].reduce((rows, yr) => {
      const rg = 0.025;
      const egrY = m.egr * Math.pow(1 + rg, yr - 1);
      const ptY  = m.propTax * Math.pow(1.02, yr - 1);
      const opY  = ptY + egrY * 0.07 + m.units * 800 + m.units * 1200 + m.units * 400;
      const noiY = egrY - opY;
      const cfbtY = noiY - m.ds;
      rows.noi.push(Math.round(noiY));
      rows.cfbt.push(Math.round(cfbtY));
      rows.egi.push(Math.round(egrY));
      return rows;
    }, { noi: [], cfbt: [], egi: [], render() {
      return `
        <tr><td>Effective gross income</td>${this.egi.map(v=>`<td style="text-align:right">${fmtM(v)}</td>`).join('')}</tr>
        <tr><td>Net operating income</td>${this.noi.map(v=>`<td style="text-align:right;font-weight:600">${fmtM(v)}</td>`).join('')}</tr>
        <tr><td style="color:#e24b4a">Debt service</td>${[1,2,3,4,5].map(()=>`<td style="text-align:right;color:#e24b4a">−${fmtM(m.ds)}</td>`).join('')}</tr>
        <tr><td>Cash flow before tax</td>${this.cfbt.map(v=>`<td style="text-align:right;font-weight:600;color:${v>0?'#1d9e75':'#e24b4a'}">${fmtM(v)}</td>`).join('')}</tr>
      `;
    }}).render()}
  </table>

  <div class="two-col" style="margin-top:16px">
    <div>
      <h3>Exit analysis (year 5)</h3>
      <table>
        <tr><td>Year 5 NOI</td><td style="text-align:right">${fmtD(Math.round(m.noi * Math.pow(1.025, 4)))}</td></tr>
        <tr><td>Exit cap rate</td><td style="text-align:right">${fmtP(m.exitCap * 100)}</td></tr>
        <tr><td>Exit value</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(m.noi * Math.pow(1.025,4) / m.exitCap))}</td></tr>
        <tr><td style="color:#e24b4a">Less: loan payoff</td><td style="text-align:right;color:#e24b4a">−${fmtD(Math.round(m.loan * 0.98))}</td></tr>
        <tr class="total"><td>Net exit proceeds</td><td style="text-align:right">${fmtD(m.ep)}</td></tr>
      </table>

      <h3 style="margin-top:16px">Equity waterfall</h3>
      <table>
        <tr><td>Equity invested</td><td style="text-align:right">${fmtD(m.equity)}</td></tr>
        <tr><td>LP preferred (8%/yr)</td><td style="text-align:right">${fmtD(Math.round(m.equity * 0.08))}/yr</td></tr>
        <tr><td>LP / GP split (excess)</td><td style="text-align:right">80% / 20%</td></tr>
        <tr class="total"><td>Levered IRR</td><td style="text-align:right;color:${irrColor(m.irrV)};font-size:14px">${m.irrV}%</td></tr>
        <tr><td>Equity multiple</td><td style="text-align:right;font-weight:600">${m.eqMult}x</td></tr>
      </table>
    </div>

    <div>
      <h3>Return comparison</h3>
      <table>
        <tr><th>Metric</th><th style="text-align:right">This deal</th><th style="text-align:right">LA avg</th></tr>
        <tr><td>Levered IRR</td><td style="text-align:right;color:${irrColor(m.irrV)};font-weight:600">${m.irrV}%</td><td style="text-align:right;color:#888">14–16%</td></tr>
        <tr><td>Cap on cost</td><td style="text-align:right;font-weight:600">${fmtP(m.capOnCost)}</td><td style="text-align:right;color:#888">4.5–5.5%</td></tr>
        <tr><td>Dev spread</td><td style="text-align:right;font-weight:600">${m.devSpreadPct}%</td><td style="text-align:right;color:#888">10–20%</td></tr>
        <tr><td>Net profit/unit</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(m.netProfit/m.units))}</td><td style="text-align:right;color:#888">$50–80K</td></tr>
        <tr><td>Cost/unit</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(m.totalCost/m.units))}</td><td style="text-align:right;color:#888">$280–350K</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- PAGE 4: SENSITIVITY -->
<div class="page">
  <div style="border-bottom:3px solid #0f1f3d;padding-bottom:10px;margin-bottom:16px">
    <div style="font-size:9px;color:#c49a3c;letter-spacing:1px;text-transform:uppercase">ParceLLA Deal Memo — Page 4</div>
    <h1 style="font-size:16px;color:#0f1f3d">${m.addr} — Sensitivity Analysis</h1>
  </div>

  <h3>IRR sensitivity — rent delta vs cap rate delta</h3>
  <table>
    <tr>
      <th>Cap Δ \\ Rent Δ</th>
      ${rdL.map(r => `<th style="text-align:center">${r}</th>`).join('')}
    </tr>
    ${sensRows}
  </table>
  <div style="font-size:9px;color:#aaa;margin-top:4px;margin-bottom:16px">Green = IRR ≥18% · Amber = 12–18% · Red = &lt;12%</div>

  <h3>Scenario analysis</h3>
  <table>
    <tr><th>Scenario</th><th style="text-align:right">IRR</th><th style="text-align:right">Net profit</th><th style="text-align:right">Cap on cost</th><th>Assumptions</th></tr>
    ${[
      ['Bear',  0.90, 0.005, 1.08, 'Rents −10%, cap +50bps, costs +8%'],
      ['Base',  1.00, 0.000, 1.00, 'Current assumptions'],
      ['Bull',  1.08, -0.004, 0.95, 'Rents +8%, cap −40bps, costs −5%'],
    ].map(([name, rm, cd, cm]) => {
      const blend2 = m.blend * rm;
      const egr2   = blend2 * 12 * m.units * 0.95;
      const cap2   = Math.max(0.001, m.entryCap + cd);
      const noi2   = egr2 * (1 - m.opex / m.egr);
      const val2   = noi2 / cap2;
      let hard2    = m.hcpsf * m.tSF * cm;
      if (m.tSF > 50000) hard2 *= 0.95;
      const soft2  = hard2 * 0.18;
      const loan2  = (hard2 + soft2) * 0.65;
      const tc2    = m.landCost + hard2 + soft2 + loan2 * 0.065 * 1.5 + m.demolition;
      const cfbt2  = noi2 - loan2 * 0.065;
      const eq2    = tc2 - loan2;
      const ev2    = val2 * Math.pow(1.03, 5);
      const ep2    = ev2 - loan2 * 1.01;
      const cfs2   = [-eq2, cfbt2, cfbt2, cfbt2, cfbt2, cfbt2 + ep2];
      let r = 0.15;
      for (let i = 0; i < 100; i++) {
        let n = 0, d = 0;
        for (let t = 0; t < cfs2.length; t++) { n += cfs2[t]/Math.pow(1+r,t); d -= t*cfs2[t]/Math.pow(1+r,t+1); }
        if (Math.abs(n) < 0.5) break;
        if (d) r -= n/d;
        r = Math.max(-0.9, Math.min(5, r));
      }
      const irrS   = Math.round(r * 1000) / 10;
      const spr2   = Math.round(val2 - tc2);
      const coc2   = Math.round(noi2 / tc2 * 1000) / 10;
      const irrC   = irrColor(irrS);
      const isBold = name === 'Base' ? 'font-weight:700;' : '';
      return `<tr style="${isBold}background:${name==='Base'?'#f5f5f5':'white'}">
        <td>${name}</td>
        <td style="text-align:right;color:${irrC};font-weight:600">${irrS}%</td>
        <td style="text-align:right">${fmtM(spr2)}</td>
        <td style="text-align:right">${coc2}%</td>
        <td style="color:#666">${[,'Rents −10%, cap +50bps, costs +8%','Current assumptions','Rents +8%, cap −40bps, costs −5%'][['Bear','Base','Bull'].indexOf(name)+1]}</td>
      </tr>`;
    }).join('')}
  </table>

  <h3 style="margin-top:16px">Break-even analysis</h3>
  <table>
    <tr><td>Break-even rent/unit/mo</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(m.noi / m.units / 12 / (1 - m.opex / m.egr)))}</td></tr>
    <tr><td>Break-even cap rate (at current cost)</td><td style="text-align:right;font-weight:600">${fmtP(Math.round(m.noi / m.totalCost * 1000) / 10)}</td></tr>
    <tr><td>Max all-in cost (at 15% IRR target)</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(m.exitValue * 0.88))}</td></tr>
    <tr><td>Land overpayment tolerance</td><td style="text-align:right;font-weight:600">${fmtD(Math.round(Math.max(0, m.exitValue * 0.88 - m.totalCost)))}</td></tr>
  </table>

  <div class="disclaimer">
    Sensitivity analysis uses base-case assumptions with individual variable stress tests. IRR calculated using Newton-Raphson method over a 5-year levered cash flow.
    RSMeans 2024 LA Metro construction cost data. Prop 13 property tax at 1.25% of land cost escalating 2%/yr. Exit cap = entry cap + 25bps.
    This is not investment advice. ParceLLA · parcella.com · ${date}
  </div>
</div>

</body>
</html>`;
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generateDealMemo(siteModel, options = {}) {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = buildHTML(siteModel, date);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdf = await page.pdf({
    format:          'Letter',
    printBackground:  true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  await browser.close();
  return pdf;
}

// ── Express route handler ─────────────────────────────────────────────────────
async function dealMemoRoute(req, res) {
  try {
    const { siteId, overrides = {} } = req.body;

    // Import site data and run model
    const { SITES } = await import('../data/sites.js');
    const { runModel } = await import('../model/financialModel.js');

    const site = SITES.find(s => s.id === siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const model = runModel(site, overrides);
    const pdf   = await generateDealMemo(model);

    const filename = `ParceLLA_${site.address.replace(/\s+/g, '_')}.pdf`;
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':       pdf.length,
    });
    res.send(pdf);

  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
}

module.exports = { generateDealMemo, dealMemoRoute, buildHTML };
