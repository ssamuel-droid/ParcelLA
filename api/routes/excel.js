import { Router } from 'express';
import { requireAuth, requireActiveAccess } from '../middleware/auth.js';

const router = Router();

const NAVY = 'FF0F1F3D';
const BLUE = 'FF1A3560';
const SOFT = 'FFF3F6FA';
const LINE = 'FFE1E7EF';
const GREEN = 'FF1D9E75';
const RED = 'FFD94B4B';
const GOLD = 'FFB98B2F';

function text(value) {
  return String(value ?? '').trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  const n = num(value, 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pct(value) {
  const n = num(value, 0);
  return Math.abs(n) > 1 ? n / 100 : n;
}

function pctPoints(value) {
  return num(value, 0) / 100;
}

function pctFromBps(value) {
  return num(value, 0) / 10000;
}

function safeSheetName(value) {
  return text(value || 'Sheet').replace(/[\[\]\*\/\\\?\:]/g, ' ').slice(0, 31) || 'Sheet';
}

function safeFilename(value) {
  return text(value || 'ParceLLA_Underwriting')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || 'ParceLLA_Underwriting';
}

function columnLetter(index) {
  let n = index;
  let letters = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    n = Math.floor((n - mod) / 26);
  }
  return letters;
}

function q(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function ref(sheetName, row, col = 2) {
  return `${q(sheetName)}!$${columnLetter(col)}$${row}`;
}

function rangeRef(sheetName, row1, col1, row2, col2) {
  return `${q(sheetName)}!$${columnLetter(col1)}$${row1}:$${columnLetter(col2)}$${row2}`;
}

function cell(value, numFmt) {
  return { value, numFmt };
}

function blankUnlessPositive(value, numFmt) {
  const n = num(value, 0);
  return n > 0 ? cell(n, numFmt) : '';
}

function blankPct(value, numFmt = FMT.pct) {
  const n = pct(value);
  return n > 0 ? cell(n, numFmt) : '';
}

function formula(value, result = 0, numFmt) {
  return { formula: value, result, numFmt };
}

const FMT = {
  money: '$#,##0;[Red]($#,##0);-',
  whole: '#,##0',
  number: '#,##0.0',
  pct: '0.0%',
  pct2: '0.00%',
  date: 'yyyy-mm-dd',
};

function styleCell(c, role = 'body') {
  c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  c.alignment = { vertical: 'top', wrapText: true };
  c.font = { name: 'Aptos', size: 10, color: { argb: 'FF1B2533' } };
  if (role === 'title') {
    c.font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', wrapText: false };
  } else if (role === 'section') {
    c.font = { name: 'Aptos', size: 10, bold: true, color: { argb: NAVY } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFC9D3E2' } } };
  } else if (role === 'header') {
    c.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  } else if (role === 'input') {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFAE8' } };
    c.border = { bottom: { style: 'thin', color: { argb: GOLD } } };
  } else if (role === 'total') {
    c.font = { name: 'Aptos', size: 10, bold: true, color: { argb: NAVY } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EE' } };
  }
}

function writeRow(ws, values = [], role = 'body') {
  const row = ws.addRow([]);
  values.forEach((item, idx) => {
    const c = row.getCell(idx + 1);
    if (item && typeof item === 'object' && Object.hasOwn(item, 'formula')) {
      c.value = { formula: item.formula, result: item.result ?? 0 };
      if (item.numFmt) c.numFmt = item.numFmt;
    } else if (item && typeof item === 'object' && Object.hasOwn(item, 'value')) {
      c.value = item.value;
      if (item.numFmt) c.numFmt = item.numFmt;
    } else {
      c.value = item;
    }
    styleCell(c, role);
  });
  row.height = role === 'title' ? 24 : role === 'header' ? 20 : 18;
  return row;
}

function setupSheet(ws, widths = []) {
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  ws.properties.defaultRowHeight = 18;
  widths.forEach((width, idx) => {
    ws.getColumn(idx + 1).width = width;
  });
}

function setRightAligned(ws, cols = []) {
  cols.forEach(col => {
    ws.getColumn(col).alignment = { vertical: 'top', horizontal: 'right', wrapText: true };
  });
}

function compactOwner(owner = {}) {
  return {
    ownerName: text(owner.ownerName) || 'Not returned',
    lastSaleDate: text(owner.lastSaleDate || owner.recordingDate || owner.saleDate),
    lastSaleAmount: money(owner.lastSaleAmount || owner.salePrice || 0),
  };
}

function normalizeItems(items = []) {
  return items
    .map(item => ({
      name: text(item.name || item.label),
      weight: num(item.weight ?? item.pct, 0),
      note: text(item.note),
    }))
    .filter(item => item.name && item.weight > 0);
}

function addSchedule(ws, title, totalRef, items, totalResult, totalSfRef, unitsRef) {
  const normalized = normalizeItems(items);
  const weightTotal = normalized.reduce((sum, item) => sum + item.weight, 0) || 1;
  writeRow(ws, ['']);
  writeRow(ws, [title], 'section');
  writeRow(ws, ['Line item', '% of category', 'Cost', '$ / SF', '$ / Unit', 'Notes'], 'header');
  if (!normalized.length) {
    writeRow(ws, ['No detail provided yet', '', formula(`${totalRef}`, totalResult, FMT.money), '', '', 'Add line items here when the budget is known.']);
    writeRow(ws, [
      `${title} total`,
      cell(1, FMT.pct),
      formula(`${totalRef}`, totalResult, FMT.money),
      formula(`IFERROR(C${ws.rowCount + 1}/${totalSfRef},0)`, 0, FMT.money),
      formula(`IFERROR(C${ws.rowCount + 1}/${unitsRef},0)`, 0, FMT.money),
      'Formula subtotal',
    ], 'total');
    return;
  }
  normalized.forEach(item => {
    const pctValue = item.weight / weightTotal;
    const r = writeRow(ws, [
      item.name,
      cell(pctValue, FMT.pct),
      formula(`${totalRef}*B${ws.rowCount + 1}`, Math.round(totalResult * pctValue), FMT.money),
      formula(`IFERROR(C${ws.rowCount + 1}/${totalSfRef},0)`, 0, FMT.money),
      formula(`IFERROR(C${ws.rowCount + 1}/${unitsRef},0)`, 0, FMT.money),
      item.note,
    ]);
    r.getCell(2).numFmt = FMT.pct;
  });
  writeRow(ws, [
    `${title} total`,
    cell(1, FMT.pct),
    formula(`SUM(C${ws.rowCount - normalized.length + 1}:C${ws.rowCount})`, totalResult, FMT.money),
    formula(`IFERROR(C${ws.rowCount + 1}/${totalSfRef},0)`, 0, FMT.money),
    formula(`IFERROR(C${ws.rowCount + 1}/${unitsRef},0)`, 0, FMT.money),
    'Formula subtotal',
  ], 'total');
}

function tableRows(list = [], limit = 50) {
  return Array.isArray(list) ? list.slice(0, limit) : [];
}

router.post('/underwriting', requireAuth, requireActiveAccess, async (req, res, next) => {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const p = req.body || {};
    const site = p.site || {};
    const assumptions = p.assumptions || {};
    const costs = p.costs || {};
    const income = p.income || {};
    const valuation = p.valuation || {};
    const appraisal = p.appraisal || {};
    const owner = compactOwner(p.owner || {});
    const unitMix = tableRows(p.unitMix || [], 12);
    const schedules = p.schedules || {};
    const scenarios = tableRows(p.scenarios || [], 12);
    const salesComps = tableRows(p.salesComps || [], 50);
    const rentComps = tableRows(p.rentComps || [], 50);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ParceLLA';
    wb.created = new Date();
    wb.modified = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    wb.views = [{ activeTab: 0 }];

    const siteName = text(site.displayAddress || site.addr || 'Deal');
    const generated = text(p.generatedAt) || new Date().toISOString().slice(0, 10);
    const unitsValue = num(site.units, 0);
    const avgUnitSfValue = num(site.avgUnitSf || site.usf, 800);
    const totalSfValue = money(costs.totalSF || unitsValue * avgUnitSfValue);
    const landValue = money(costs.land || site.landBasis || site.askPrice || 0);
    const hardCostValue = money(costs.hardCosts || 0);
    const softCostValue = money(costs.softCosts || 0);
    const preCarryValue = landValue + hardCostValue + softCostValue;
    const carryCostValue = money(costs.carryCost || 0);
    const hardPsfValue = totalSfValue ? num(assumptions.hardCostPerSf ?? (hardCostValue / totalSfValue), 0) : num(assumptions.hardCostPerSf || costs.hardPerSf, 0);
    const softPctValue = hardCostValue ? num(assumptions.softCostPct ?? (softCostValue / hardCostValue), 0) : pct(assumptions.softCostPct || 0);
    const carryPctValue = preCarryValue ? num(assumptions.carryPct ?? (carryCostValue / preCarryValue), 0) : 0;
    const rentPremiumValue = pct(assumptions.rentPremiumPct);
    const summaryWs = wb.addWorksheet('Summary');

    const assumptionsWs = wb.addWorksheet('Assumptions');
    setupSheet(assumptionsWs, [30, 18, 52]);
    writeRow(assumptionsWs, ['ParceLLA Assumptions', siteName, generated], 'title');
    writeRow(assumptionsWs, ['Input', 'Value', 'Notes'], 'header');
    const A = {};
    const addAssumption = (key, label, value, numFmt, note = '') => {
      const row = writeRow(assumptionsWs, [label, cell(value, numFmt), note]);
      row.getCell(2).style = { ...row.getCell(2).style };
      styleCell(row.getCell(2), 'input');
      if (numFmt) row.getCell(2).numFmt = numFmt;
      A[key] = ref('Assumptions', row.number, 2);
      return row.number;
    };

    addAssumption('units', 'Units', unitsValue, FMT.whole, 'Editable unit count used throughout the workbook.');
    addAssumption('avgUnitSf', 'Average unit SF', avgUnitSfValue, FMT.whole, 'Net rentable SF per unit.');
    const totalSfRow = writeRow(assumptionsWs, ['Total rentable SF', formula(`${A.units}*${A.avgUnitSf}`, totalSfValue, FMT.whole), 'Formula: units x average unit SF.'], 'total');
    A.totalSf = ref('Assumptions', totalSfRow.number, 2);
    addAssumption('land', 'Land basis / acquisition price', landValue, FMT.money, text(site.landSource || assumptions.landSource || 'Asking price or imputed off-market land value.'));
    addAssumption('hardPsf', 'Hard cost / SF', hardPsfValue, FMT.money, 'Exact model input; formatted dollars may round on screen.');
    addAssumption('softPct', 'Soft costs / hard costs', softPctValue, FMT.pct, 'A&E, permits, fees, contingency, developer fee.');
    addAssumption('months', 'Construction months', num(assumptions.constructionMonths || costs.months || 18), FMT.whole, 'Used to size financing carry.');
    addAssumption('ltc', 'Loan-to-cost', pct(assumptions.loanToCostPct), FMT.pct, 'Debt sizing assumption.');
    addAssumption('rate', 'Interest rate', pct(assumptions.interestRatePct), FMT.pct, 'Interest-only debt service and carry.');
    addAssumption('carryPct', 'Financing carry / pre-carry cost', carryPctValue, FMT.pct, 'Derived from current site model so the budget ties to the app; edit to stress-test carry.');
    addAssumption('vacancy', 'Vacancy / credit loss', pct(assumptions.vacancyPct), FMT.pct, 'Applied to gross potential rent.');
    addAssumption('expenseRatio', 'Operating expenses / EGI', pct(assumptions.expenseRatioPct), FMT.pct, 'Stabilized operating expense ratio.');
    addAssumption('rentGrowth', 'Annual rent growth', pct(assumptions.rentGrowthPct), FMT.pct, 'Used for year-5 NOI.');
    addAssumption('entryCap', 'Entry cap rate', pct(assumptions.entryCap || valuation.entryCap || appraisal.entryCap), FMT.pct2, 'Driven by scored sales comps when available.');
    addAssumption('exitSpread', 'Exit cap spread', pctFromBps(assumptions.exitCapSpreadBps), FMT.pct2, 'Spread added to entry cap.');
    const exitCapRow = writeRow(assumptionsWs, ['Exit cap rate', formula(`${A.entryCap}+${A.exitSpread}`, pct(valuation.exitCap || appraisal.exitCap), FMT.pct2), 'Formula: entry cap + spread.'], 'total');
    A.exitCap = ref('Assumptions', exitCapRow.number, 2);
    addAssumption('otherIncomeUnit', 'Other income / unit / year', money(assumptions.otherIncomePerUnit || (num(site.units) ? num(income.otherIncome) / num(site.units) : 600)), FMT.money, 'Parking, laundry, storage, fees, and other ancillary income.');
    addAssumption('rentPremium', 'Plan rent premium / haircut', rentPremiumValue, FMT.pct, text(assumptions.planLabel || costs.planLabel || 'Selected plan'));

    const ownerWs = wb.addWorksheet('Owner & Sale');
    setupSheet(ownerWs, [28, 32]);
    writeRow(ownerWs, ['Owner & Sale', siteName], 'title');
    writeRow(ownerWs, ['Field', 'Value'], 'header');
    writeRow(ownerWs, ['Owner', owner.ownerName]);
    writeRow(ownerWs, ['Date sold', owner.lastSaleDate]);
    writeRow(ownerWs, ['Sale price', cell(owner.lastSaleAmount, FMT.money)]);

    const rentWs = wb.addWorksheet('Rent Roll');
    setupSheet(rentWs, [22, 12, 16, 16, 16, 18]);
    writeRow(rentWs, ['Rent Roll', siteName], 'title');
    writeRow(rentWs, ['Unit type', 'Units', 'Rent / month', 'Monthly rent', 'Annual rent', 'Source'], 'header');
    const rentStart = rentWs.rowCount + 1;
    let rentAnnualSubtotal = 0;
    unitMix.forEach(row => {
      const r = rentWs.rowCount + 1;
      rentAnnualSubtotal += money(row.annual);
      writeRow(rentWs, [
        text(row.label || row.type),
        cell(num(row.units, 0), FMT.whole),
        cell(money(row.rent || row.monthlyRent), FMT.money),
        formula(`B${r}*C${r}`, money(row.monthly), FMT.money),
        formula(`D${r}*12`, money(row.annual), FMT.money),
        text(row.source || assumptions.unitMixSource || ''),
      ]);
    });
    const targetBaseRent = rentPremiumValue === -1
      ? money(income.grossPotentialRent)
      : money(num(income.grossPotentialRent, 0) / (1 + rentPremiumValue));
    if (unitMix.length && Math.abs(targetBaseRent - rentAnnualSubtotal) >= 1) {
      const r = rentWs.rowCount + 1;
      writeRow(rentWs, [
        'Model adjustment',
        '',
        '',
        formula(`(${targetBaseRent}/12)-SUM(D${rentStart}:D${r - 1})`, money((targetBaseRent - rentAnnualSubtotal) / 12), FMT.money),
        formula(`${targetBaseRent}-SUM(E${rentStart}:E${r - 1})`, money(targetBaseRent - rentAnnualSubtotal), FMT.money),
        'Reconciles rounded unit counts/rents to the site underwriting model.',
      ]);
    }
    const rentEnd = Math.max(rentStart, rentWs.rowCount);
    const rentTotalRow = writeRow(rentWs, [
      'Total / blended',
      formula(`SUM(B${rentStart}:B${rentEnd})`, num(site.units, 0), FMT.whole),
      formula(`IFERROR(D${rentWs.rowCount + 1}/B${rentWs.rowCount + 1},0)`, 0, FMT.money),
      formula(`SUM(D${rentStart}:D${rentEnd})`, money(targetBaseRent / 12), FMT.money),
      formula(`SUM(E${rentStart}:E${rentEnd})`, targetBaseRent, FMT.money),
      text(assumptions.unitMixSource || ''),
    ], 'total');
    const rentAnnualRef = ref('Rent Roll', rentTotalRow.number, 5);

    const constructionWs = wb.addWorksheet('Construction Budget');
    setupSheet(constructionWs, [30, 14, 16, 16, 16, 44]);
    writeRow(constructionWs, ['Construction Budget', siteName], 'title');
    writeRow(constructionWs, ['Budget category', 'Cost', '$ / SF', '$ / Unit', '% of total', 'Notes'], 'header');
    const budgetRefs = {};
    const budgetRow = (key, label, costFormula, result, note, role = 'body') => {
      const r = constructionWs.rowCount + 1;
      writeRow(constructionWs, [
        label,
        formula(costFormula, money(result), FMT.money),
        formula(`IFERROR(B${r}/${A.totalSf},0)`, 0, FMT.money),
        formula(`IFERROR(B${r}/${A.units},0)`, 0, FMT.money),
        '',
        note,
      ], role);
      budgetRefs[key] = ref('Construction Budget', r, 2);
      return r;
    };
    budgetRow('land', 'Land basis', `${A.land}`, costs.land, text(site.landSource || assumptions.landSource || 'Land basis'));
    budgetRow('hard', 'Hard costs', `${A.totalSf}*${A.hardPsf}`, costs.hardCosts, 'Direct construction: framing, HVAC, plumbing, electrical, etc.');
    budgetRow('soft', 'Soft costs', `${budgetRefs.hard}*${A.softPct}`, costs.softCosts, 'Soft costs as a percentage of hard costs.');
    budgetRow('preCarry', 'Subtotal before carry', `${budgetRefs.land}+${budgetRefs.hard}+${budgetRefs.soft}`, num(costs.land) + num(costs.hardCosts) + num(costs.softCosts), 'Land + hard + soft costs.', 'section');
    budgetRow('carry', 'Financing carry', `${budgetRefs.preCarry}*${A.carryPct}`, costs.carryCost, 'Explicit carry load from the app model; adjust the carry assumption to stress-test timing/rates.');
    const totalCostRow = budgetRow('total', 'Total project cost', `${budgetRefs.land}+${budgetRefs.hard}+${budgetRefs.soft}+${budgetRefs.carry}`, costs.totalCost, 'Formula total underwriting basis.', 'total');
    constructionWs.getCell(`E${totalCostRow}`).value = 1;
    constructionWs.getCell(`E${totalCostRow}`).numFmt = FMT.pct;
    budgetRow('loan', 'Loan amount', `${budgetRefs.total}*${A.ltc}`, num(costs.totalCost) * pct(assumptions.loanToCostPct), 'Formula: total cost x loan-to-cost.');
    budgetRow('equity', 'Equity required', `${budgetRefs.total}-${budgetRefs.loan}`, num(costs.totalCost) * (1 - pct(assumptions.loanToCostPct)), 'Formula: total cost less loan.');
    addSchedule(constructionWs, 'Hard Cost Detail', budgetRefs.hard, schedules.hard || [], money(costs.hardCosts), A.totalSf, A.units);
    addSchedule(constructionWs, 'Soft Cost Detail', budgetRefs.soft, schedules.soft || [], money(costs.softCosts), A.totalSf, A.units);
    addSchedule(constructionWs, 'Financing / Carry Detail', budgetRefs.carry, schedules.carry || [], money(costs.carryCost), A.totalSf, A.units);

    const incomeWs = wb.addWorksheet('Income Statement');
    setupSheet(incomeWs, [32, 18, 18, 18, 42]);
    writeRow(incomeWs, ['Income Statement', siteName], 'title');
    writeRow(incomeWs, ['Line item', 'Annual amount', '$ / Unit', '% of EGI', 'Formula / notes'], 'header');
    const I = {};
    const incomeRowNumbers = {};
    const incRow = (key, label, f, result, pctFormula = '', note = '', role = 'body') => {
      const r = incomeWs.rowCount + 1;
      writeRow(incomeWs, [
        label,
        formula(f, money(result), FMT.money),
        formula(`IFERROR(B${r}/${A.units},0)`, 0, FMT.money),
        pctFormula ? formula(pctFormula, 0, FMT.pct) : '',
        note,
      ], role);
      I[key] = ref('Income Statement', r, 2);
      incomeRowNumbers[key] = r;
      return r;
    };
    incRow('gpr', 'Gross potential rent', `${rentAnnualRef}*(1+${A.rentPremium})`, income.grossPotentialRent, '', 'Rent roll annual total x plan rent adjustment.');
    incRow('vacancy', 'Vacancy loss', `${I.gpr}*${A.vacancy}`, income.vacancyLoss, `IFERROR(B${incomeWs.rowCount + 1}/${I.gpr},0)`, 'Gross potential rent x vacancy.', 'body');
    incRow('other', 'Other income', `${A.units}*${A.otherIncomeUnit}`, income.otherIncome, '', 'Other annual income per unit.');
    incRow('egi', 'Effective gross income', `${I.gpr}-${I.vacancy}+${I.other}`, income.effectiveGrossIncome, '1', 'GPR less vacancy plus other income.', 'total');
    const expenseTotalRow = incRow('opex', 'Total operating expenses', `${I.egi}*${A.expenseRatio}`, income.operatingExpenses, `IFERROR(B${incomeWs.rowCount + 1}/${I.egi},0)`, 'EGI x expense ratio.', 'section');
    const expenseDetail = income.expenseDetail || {};
    const defaultExpenseWeights = [
      ['Property taxes', 0.22, expenseDetail.propertyTaxes],
      ['Insurance', 0.09, expenseDetail.insurance],
      ['Utilities', 0.07, expenseDetail.utilities],
      ['Repairs & maintenance', 0.12, expenseDetail.repairsMaintenance],
      ['Payroll / admin', 0.16, expenseDetail.payrollAdmin],
      ['Management fee', 0.08, expenseDetail.managementFee],
      ['Marketing / turnover', 0.06, expenseDetail.marketingTurnover],
      ['Replacement reserves', 0.08, expenseDetail.replacementReserves],
      ['Other operating', 0.12, expenseDetail.otherOperating],
    ];
    const expenseAmountTotal = defaultExpenseWeights.reduce((sum, row) => sum + money(row[2]), 0);
    const expenseWeights = defaultExpenseWeights.map(([label, defaultWeight, amount]) => [
      label,
      expenseAmountTotal ? money(amount) / expenseAmountTotal : defaultWeight,
    ]);
    expenseWeights.forEach(([label, weight]) => {
      const r = incomeWs.rowCount + 1;
      writeRow(incomeWs, [
        label,
        formula(`${I.opex}*${weight}`, money(num(income.operatingExpenses) * weight), FMT.money),
        formula(`IFERROR(B${r}/${A.units},0)`, 0, FMT.money),
        formula(`IFERROR(B${r}/${I.egi},0)`, weight * pct(assumptions.expenseRatioPct), FMT.pct),
        'Expense allocation. Update the formula/percent if actuals differ.',
      ]);
    });
    incRow('noi', 'Net operating income', `${I.egi}-${I.opex}`, income.noi, `IFERROR(B${incomeWs.rowCount + 1}/${I.egi},0)`, 'Formula: EGI less total operating expenses.', 'total');
    incRow('debt', 'Debt service', `${budgetRefs.loan}*${A.rate}`, income.debtService, '', 'Formula: loan amount x interest rate.');
    incRow('cfbt', 'Cash flow before tax', `${I.noi}-${I.debt}`, income.cfbt, '', 'NOI less annual interest-only debt service.', 'total');
    const egiValue = num(income.effectiveGrossIncome, 0);
    const pctResult = key => {
      if (key === 'egi') return 1;
      if (!egiValue) return 0;
      const values = {
        gpr: income.grossPotentialRent,
        vacancy: income.vacancyLoss,
        other: income.otherIncome,
        opex: income.operatingExpenses,
        noi: income.noi,
        debt: income.debtService,
        cfbt: income.cfbt,
      };
      return num(values[key], 0) / egiValue;
    };
    ['gpr', 'vacancy', 'other', 'egi', 'opex', 'noi', 'debt', 'cfbt'].forEach(key => {
      const r = incomeRowNumbers[key];
      if (!r) return;
      const c = incomeWs.getCell(`D${r}`);
      c.value = { formula: key === 'egi' ? '1' : `IFERROR(B${r}/${I.egi},0)`, result: pctResult(key) };
      c.numFmt = FMT.pct;
      styleCell(c, key === 'egi' || key === 'noi' || key === 'cfbt' ? 'total' : 'body');
    });
    incomeWs.getCell(`B${expenseTotalRow}`).font = { name: 'Aptos', size: 10, bold: true, color: { argb: RED } };

    const valuationWs = wb.addWorksheet('Valuation');
    setupSheet(valuationWs, [32, 18, 46]);
    writeRow(valuationWs, ['Valuation', siteName], 'title');
    writeRow(valuationWs, ['Metric', 'Value', 'Formula / support'], 'header');
    const V = {};
    const valRow = (key, label, f, result, numFmt, note = '', role = 'body') => {
      const r = writeRow(valuationWs, [label, formula(f, result, numFmt), note], role);
      V[key] = ref('Valuation', r.number, 2);
      return r.number;
    };
    valRow('noi', 'NOI (stabilized)', `${I.noi}`, money(valuation.noi || income.noi), FMT.money, 'From income statement.');
    valRow('entryCap', 'Entry cap rate', `${A.entryCap}`, pct(valuation.entryCap || appraisal.entryCap), FMT.pct2, text(appraisal.capRateSource || 'Comp-driven when sales comp evidence is available.'));
    valRow('exitCap', 'Exit cap rate', `${A.exitCap}`, pct(valuation.exitCap || appraisal.exitCap), FMT.pct2, 'Entry cap plus exit cap spread.');
    valRow('year5Noi', 'Year 5 NOI', `${V.noi}*(1+${A.rentGrowth})^4`, money(valuation.year5Noi), FMT.money, 'NOI grown for four years.');
    valRow('stabilizedValue', 'Stabilized value at entry cap', `IFERROR(${V.noi}/${V.entryCap},0)`, money(num(income.noi) / Math.max(0.0001, pct(valuation.entryCap || appraisal.entryCap))), FMT.money, 'NOI / entry cap.');
    valRow('exitValue', 'Exit value', `IFERROR(${V.year5Noi}/${V.exitCap},0)`, money(valuation.exitValue), FMT.money, 'Year 5 NOI / exit cap.', 'total');
    valRow('totalCost', 'Total project cost', `${budgetRefs.total}`, money(costs.totalCost), FMT.money, 'From construction budget.');
    valRow('netProfit', 'Net profit / gap', `${V.exitValue}-${V.totalCost}`, money(valuation.netProfit), FMT.money, 'Exit value less total cost.', 'total');
    valRow('capOnCost', 'Cap on cost', `IFERROR(${V.noi}/${V.totalCost},0)`, pctPoints(valuation.capOnCost), FMT.pct, 'NOI / total project cost.');
    valRow('devSpread', 'Development spread', `IFERROR(${V.exitValue}/${V.totalCost}-1,0)`, pct(valuation.devSpreadPct), FMT.pct, 'Exit value / total cost - 1.');
    valRow('leveredIrr', 'Levered IRR', `IFERROR(IRR(${rangeRef('Cash Flow', 6, 2, 6, 7)}),0)`, pctPoints(valuation.leveragedIRR), FMT.pct, 'Formula references Cash Flow tab.');

    const cashWs = wb.addWorksheet('Cash Flow');
    setupSheet(cashWs, [22, 14, 14, 14, 14, 14, 14]);
    writeRow(cashWs, ['Cash Flow', siteName], 'title');
    writeRow(cashWs, ['Year', 0, 1, 2, 3, 4, 5], 'header');
    writeRow(cashWs, ['NOI', '', formula(`${I.noi}`, money(income.noi), FMT.money), formula(`${I.noi}*(1+${A.rentGrowth})`, money(income.noi), FMT.money), formula(`${I.noi}*(1+${A.rentGrowth})^2`, money(income.noi), FMT.money), formula(`${I.noi}*(1+${A.rentGrowth})^3`, money(income.noi), FMT.money), formula(`${V.year5Noi}`, money(valuation.year5Noi), FMT.money)]);
    writeRow(cashWs, ['Debt service', '', formula(`${I.debt}`, money(income.debtService), FMT.money), formula(`${I.debt}`, money(income.debtService), FMT.money), formula(`${I.debt}`, money(income.debtService), FMT.money), formula(`${I.debt}`, money(income.debtService), FMT.money), formula(`${I.debt}`, money(income.debtService), FMT.money)]);
    writeRow(cashWs, ['Sale proceeds', '', '', '', '', '', formula(`${V.exitValue}-${budgetRefs.loan}`, money(num(valuation.exitValue) - num(costs.totalCost) * pct(assumptions.loanToCostPct)), FMT.money)]);
    writeRow(cashWs, ['Total cash flow', formula(`-${budgetRefs.equity}`, -money(num(costs.totalCost) * (1 - pct(assumptions.loanToCostPct))), FMT.money), formula('C3-C4', 0, FMT.money), formula('D3-D4', 0, FMT.money), formula('E3-E4', 0, FMT.money), formula('F3-F4', 0, FMT.money), formula('G3-G4+G5', 0, FMT.money)], 'total');

    const scenarioWs = wb.addWorksheet('Scenarios');
    setupSheet(scenarioWs, [24, 14, 12, 12, 12, 16, 16, 16, 16, 16, 14, 42]);
    writeRow(scenarioWs, ['Construction Scenarios', siteName], 'title');
    writeRow(scenarioWs, ['Plan', 'Hard / SF', 'Soft %', 'Months', 'Rent impact', 'Total cost', 'NOI', 'Exit value', 'Net profit', 'Cost / unit', 'Cap on cost', 'Notes'], 'header');
    scenarios.forEach(row => {
      const r = scenarioWs.rowCount + 1;
      writeRow(scenarioWs, [
        text(row.label || row.plan),
        cell(money(row.hardPerSf), FMT.money),
        cell(pct(row.softPct), FMT.pct),
        cell(num(row.months, 18), FMT.whole),
        cell(pct(row.rentPremiumPct), FMT.pct),
        formula(`${A.land}+${A.totalSf}*B${r}+(${A.totalSf}*B${r})*C${r}+(${A.land}+${A.totalSf}*B${r}+(${A.totalSf}*B${r})*C${r})*${A.ltc}*${A.rate}*D${r}/12`, money(row.totalCost), FMT.money),
        formula(`((${rentAnnualRef}*(1+E${r}))*(1-${A.vacancy})+${A.units}*${A.otherIncomeUnit})*(1-${A.expenseRatio})`, money(row.noi), FMT.money),
        formula(`IFERROR((G${r}*(1+${A.rentGrowth})^4)/${A.exitCap},0)`, money(row.exitValue), FMT.money),
        formula(`H${r}-F${r}`, money(row.netProfit), FMT.money),
        formula(`IFERROR(F${r}/${A.units},0)`, money(row.costPerUnit), FMT.money),
        formula(`IFERROR(G${r}/F${r},0)`, pctPoints(row.capOnCost), FMT.pct),
        text(row.note),
      ]);
    });

    const salesWs = wb.addWorksheet('Sales Comps');
    setupSheet(salesWs, [28, 12, 18, 16, 14, 14, 14, 14, 14, 16, 14, 34]);
    writeRow(salesWs, ['Sales Comps', text(site.neighborhood || site.hood)], 'title');
    writeRow(salesWs, ['Address', 'Distance', 'Sale date', 'Sale price', 'Units', 'Avg SF', 'Year built', 'Cap rate', '$ / Unit', '$ / SF', 'Weight', 'Source / notes'], 'header');
    salesComps.forEach(c => {
      const r = salesWs.rowCount + 1;
      const cap = c.capRate || c.capRateNorm;
      writeRow(salesWs, [
        text(c.address),
        c.distanceMiles === undefined || c.distanceMiles === null ? '' : cell(num(c.distanceMiles, 0), FMT.number),
        text(c.saleDate || '').slice(0, 10),
        blankUnlessPositive(c.salePrice, FMT.money),
        blankUnlessPositive(c.units, FMT.whole),
        blankUnlessPositive(c.avgUnitSf, FMT.whole),
        blankUnlessPositive(c.yearBuilt, FMT.whole),
        blankPct(cap, FMT.pct2),
        formula(`IFERROR(D${r}/E${r},0)`, money(c.pricePerUnit || c.usablePricePerUnit), FMT.money),
        formula(`IFERROR(D${r}/(E${r}*F${r}),0)`, money(c.pricePerSf || c.usablePricePerSf), FMT.money),
        c.weightPct ? cell(pct(c.weightPct), FMT.pct) : '',
        text(c.source || c.notes || ''),
      ]);
    });

    const rentCompsWs = wb.addWorksheet('Rent Comps');
    setupSheet(rentCompsWs, [30, 12, 16, 12, 12, 14, 12, 12, 16, 44]);
    writeRow(rentCompsWs, ['Rent Comps', text(site.neighborhood || site.hood)], 'title');
    writeRow(rentCompsWs, ['Property / address', 'Distance', 'Period', 'Beds', 'Baths', 'Rent / mo', 'Unit SF', 'Rent / SF', 'Weight', 'Amenities / source'], 'header');
    rentComps.forEach(c => {
      const r = rentCompsWs.rowCount + 1;
      writeRow(rentCompsWs, [
        text(c.propertyName ? `${c.propertyName} - ${c.address || ''}` : c.address),
        c.distanceMiles === undefined || c.distanceMiles === null ? '' : cell(num(c.distanceMiles, 0), FMT.number),
        text(c.period || '').slice(0, 10),
        c.bedrooms === undefined || c.bedrooms === null ? '' : cell(num(c.bedrooms, 0), FMT.number),
        c.bathrooms === undefined || c.bathrooms === null ? '' : cell(num(c.bathrooms, 0), FMT.number),
        blankUnlessPositive(c.monthlyRent || c.usableMonthlyRent, FMT.money),
        blankUnlessPositive(c.unitSf, FMT.whole),
        formula(`IFERROR(F${r}/G${r},0)`, num(c.rentPerSf || c.usableRentPerSf, 0), '$0.00'),
        c.weightPct ? cell(pct(c.weightPct), FMT.pct) : '',
        text(c.amenities || c.source || ''),
      ]);
    });

    const appraisalWs = wb.addWorksheet('Appraisal Reconciliation');
    setupSheet(appraisalWs, [34, 16, 18, 48]);
    writeRow(appraisalWs, ['Appraisal Reconciliation', siteName], 'title');
    writeRow(appraisalWs, ['Approach', 'Weight', 'Value', 'Methodology'], 'header');
    const recRows = Array.isArray(appraisal.reconciliation) ? appraisal.reconciliation : [];
    recRows.forEach(row => {
      writeRow(appraisalWs, [
        text(row.label),
        cell(pct(row.weightPct), FMT.pct),
        cell(money(row.value), FMT.money),
        text(row.note),
      ]);
    });
    writeRow(appraisalWs, ['Reconciled value', 'n/a', formula(`SUMPRODUCT(B3:B${Math.max(3, appraisalWs.rowCount)},C3:C${Math.max(3, appraisalWs.rowCount)})`, money(appraisal.reconciled || appraisal.values?.reconciled), FMT.money), 'Formula: weighted reconciliation.'], 'total');
    writeRow(appraisalWs, ['Comp-driven entry cap', 'n/a', formula(`${V.entryCap}`, pct(appraisal.entryCap || valuation.entryCap), FMT.pct2), text(appraisal.capRateSource)]);
    writeRow(appraisalWs, ['Comp-driven exit cap', 'n/a', formula(`${V.exitCap}`, pct(appraisal.exitCap || valuation.exitCap), FMT.pct2), 'Entry cap plus exit cap spread.']);

    setupSheet(summaryWs, [30, 20, 44]);
    writeRow(summaryWs, ['ParceLLA Underwriting Summary', siteName, generated], 'title');
    writeRow(summaryWs, ['Metric', 'Value', 'Source / formula'], 'header');
    writeRow(summaryWs, ['Address', siteName, text(site.addressNote || '')]);
    writeRow(summaryWs, ['Neighborhood', text(site.hood || site.neighborhood), '']);
    writeRow(summaryWs, ['Project type', text(site.type), '']);
    writeRow(summaryWs, ['Units', formula(`${A.units}`, num(site.units, 0), FMT.whole), 'Assumptions tab']);
    writeRow(summaryWs, ['Owner', owner.ownerName, 'Owner & Sale tab']);
    writeRow(summaryWs, ['Date sold', owner.lastSaleDate, 'Owner & Sale tab']);
    writeRow(summaryWs, ['Sale price', cell(owner.lastSaleAmount, FMT.money), 'Owner & Sale tab']);
    writeRow(summaryWs, ['Total project cost', formula(`${V.totalCost}`, money(costs.totalCost), FMT.money), 'Construction Budget tab']);
    writeRow(summaryWs, ['NOI', formula(`${V.noi}`, money(income.noi), FMT.money), 'Income Statement tab']);
    writeRow(summaryWs, ['Exit value', formula(`${V.exitValue}`, money(valuation.exitValue), FMT.money), 'Valuation tab']);
    writeRow(summaryWs, ['Net profit / gap', formula(`${V.netProfit}`, money(valuation.netProfit), FMT.money), 'Exit value less total project cost.'], 'total');
    writeRow(summaryWs, ['Levered IRR', formula(`${V.leveredIrr}`, pctPoints(valuation.leveragedIRR), FMT.pct), 'Cash Flow tab']);
    writeRow(summaryWs, ['Cap on cost', formula(`${V.capOnCost}`, pctPoints(valuation.capOnCost), FMT.pct), 'NOI / total project cost']);
    writeRow(summaryWs, ['Comp-driven exit cap', formula(`${V.exitCap}`, pct(valuation.exitCap || appraisal.exitCap), FMT.pct2), text(appraisal.capRateSource || '')]);
    wb.worksheets.forEach(ws => {
      ws.eachRow(row => row.eachCell(c => {
        if (typeof c.value === 'number' || (c.value && typeof c.value === 'object' && Object.hasOwn(c.value, 'formula'))) {
          c.alignment = { vertical: 'top', horizontal: 'right', wrapText: true };
        }
      }));
      setRightAligned(ws, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
    const buffer = await wb.xlsx.writeBuffer();
    const filename = `ParceLLA_${safeFilename(siteName)}_${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}_Underwriting.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

export default router;
