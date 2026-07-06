#!/usr/bin/env node

import { readFileSync } from 'fs';
import { basename } from 'path';
import { pathToFileURL } from 'url';

const DEFAULT_TAX_RATE = 0.0011;

function usage() {
  console.log(`Usage: npm run import:county-comps -- path/to/comps.csv [options]

Options:
  --dry-run              Preview rows without writing. Default.
  --commit               Write imported comps to Supabase.
  --min-units 5          Minimum units for multifamily filtering.
  --tax-rate 0.0011      Transfer-tax rate used to infer sale price.
  --source name          Source label. Default: la_county_public_record

Common CSV columns:
  apn, recorder_document_number, recording_date, document_type, address, city,
  zip, neighborhood, buyer, seller, transfer_tax, sale_price, units, building_sf,
  year_built, property_type, lat, lng, notes
`);
}

function parseArgs(argv) {
  const args = {
    csvPath: '',
    dryRun: true,
    commit: false,
    minUnits: 5,
    taxRate: DEFAULT_TAX_RATE,
    source: 'la_county_public_record',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.commit = false;
    } else if (arg === '--commit') {
      args.commit = true;
      args.dryRun = false;
    } else if (arg === '--min-units') {
      args.minUnits = Number(argv[++i] || args.minUnits);
    } else if (arg === '--tax-rate') {
      args.taxRate = Number(argv[++i] || args.taxRate);
    } else if (arg === '--source') {
      args.source = argv[++i] || args.source;
    } else if (!args.csvPath) {
      args.csvPath = arg;
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  const nonEmpty = rows.filter(r => r.some(v => String(v || '').trim() !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map(normalizeHeader);
  return nonEmpty.slice(1).map(values => {
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] === undefined ? '' : String(values[idx]).trim();
    });
    return record;
  });
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[#]/g, 'number')
    .replace(/[$]/g, 'dollars')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pick(row, names) {
  for (const name of names) {
    const key = normalizeHeader(name);
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[$,\s()]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function parseInteger(value) {
  const n = parseMoney(value);
  return n === null ? null : Math.round(n);
}

function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function cleanApn(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function buildAddress(row) {
  const full = pick(row, ['address', 'property_address', 'site_address', 'situs_address', 'street_address']);
  if (full) return full;
  return [
    pick(row, ['street_number', 'house_number']),
    pick(row, ['street_name']),
    pick(row, ['street_suffix']),
  ].filter(Boolean).join(' ');
}

function looksMultifamily({ units, propertyType, useCode }, minUnits) {
  const text = [propertyType, useCode].filter(Boolean).join(' ').toLowerCase();
  if (units && units >= minUnits) return true;
  return /\b(apartment|apartments|multifamily|multi family|multi-family|5\+|five or more)\b/.test(text);
}

function inferNeighborhood(row) {
  return pick(row, ['neighborhood', 'community', 'market', 'submarket', 'area']);
}

function inferSalePrice(row, taxRate) {
  const explicit = parseMoney(pick(row, ['sale_price', 'sales_price', 'consideration', 'purchase_price', 'amount']));
  if (explicit && explicit > 0) {
    return {
      salePrice: Math.round(explicit),
      method: 'reported_sale_price',
      confidence: 'high',
      transferTax: parseMoney(pick(row, ['transfer_tax', 'documentary_transfer_tax', 'doc_transfer_tax', 'county_transfer_tax', 'tax_amount'])),
    };
  }

  const transferTax = parseMoney(pick(row, [
    'transfer_tax',
    'documentary_transfer_tax',
    'doc_transfer_tax',
    'county_transfer_tax',
    'tax_amount',
  ]));
  if (transferTax && transferTax > 0 && taxRate > 0) {
    return {
      salePrice: Math.round(transferTax / taxRate),
      method: 'transfer_tax_inferred',
      confidence: 'medium',
      transferTax,
    };
  }

  return {
    salePrice: null,
    method: '',
    confidence: 'missing',
    transferTax,
  };
}

function mapCountyRecord(row, options) {
  const units = parseInteger(pick(row, ['units', 'unit_count', 'number_of_units', 'residential_units', 'no_units']));
  const buildingSf = parseInteger(pick(row, ['building_sf', 'building_area', 'gross_building_area', 'improvement_sf', 'living_area']));
  const propertyType = pick(row, ['property_type', 'use_type', 'land_use', 'property_use']);
  const useCode = pick(row, ['use_code', 'assessor_use_code', 'la_county_use_code']);
  const sale = inferSalePrice(row, options.taxRate);
  const saleDate = parseDate(pick(row, ['recording_date', 'recorded_date', 'sale_date', 'transfer_date', 'deed_date']));
  const address = buildAddress(row);

  const skipReasons = [];
  if (!looksMultifamily({ units, propertyType, useCode }, options.minUnits)) skipReasons.push('not multifamily');
  if (!address) skipReasons.push('missing address');
  if (!saleDate) skipReasons.push('missing sale/recording date');
  if (!sale.salePrice) skipReasons.push('missing sale price and transfer tax');

  const avgUnitSf = units && buildingSf ? Math.round(buildingSf / units) : null;
  const salePrice = sale.salePrice;

  return {
    skipReasons,
    comp: {
      address,
      neighborhood: inferNeighborhood(row) || null,
      zip: pick(row, ['zip', 'zipcode', 'postal_code']) || null,
      lat: parseMoney(pick(row, ['lat', 'latitude'])),
      lng: parseMoney(pick(row, ['lng', 'lon', 'longitude'])),
      project_type: 'Multifamily',
      units,
      avg_unit_sf: avgUnitSf,
      year_built: parseInteger(pick(row, ['year_built', 'built_year', 'yr_built'])),
      amenities: pick(row, ['amenities', 'features']) || null,
      sale_price: salePrice,
      sale_date: saleDate,
      cap_rate: parseMoney(pick(row, ['cap_rate', 'cap'])) || null,
      noi: parseInteger(pick(row, ['noi', 'net_operating_income'])) || null,
      price_per_unit: salePrice && units ? Math.round(salePrice / units) : null,
      price_per_sf: salePrice && buildingSf ? Math.round(salePrice / buildingSf) : null,
      buyer: pick(row, ['buyer', 'grantee', 'buyer_name', 'grantee_name']) || null,
      seller: pick(row, ['seller', 'grantor', 'seller_name', 'grantor_name']) || null,
      source: options.source,
      notes: [
        pick(row, ['notes', 'comments']),
        propertyType ? `Property type: ${propertyType}` : '',
        useCode ? `Use code: ${useCode}` : '',
      ].filter(Boolean).join(' | ') || null,
      apn: cleanApn(pick(row, ['apn', 'ain', 'parcel', 'parcel_number', 'assessor_parcel_number'])) || null,
      recorder_document_number: pick(row, ['recorder_document_number', 'document_number', 'instrument_number', 'recording_number', 'doc_number']) || null,
      document_type: pick(row, ['document_type', 'deed_type', 'instrument_type']) || null,
      transfer_tax: sale.transferTax ?? parseMoney(pick(row, ['transfer_tax', 'documentary_transfer_tax', 'doc_transfer_tax'])) ?? null,
      sale_price_confidence: sale.confidence,
      sale_price_method: sale.method,
      raw_record: row,
    },
  };
}

async function upsertComps(comps) {
  await import('dotenv/config').catch(() => {});
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --commit');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(supabaseUrl, serviceKey);
  const batchSize = 250;
  let imported = 0;

  for (let i = 0; i < comps.length; i += batchSize) {
    const batch = comps.slice(i, i + batchSize);
    const withDoc = batch.filter(row => row.recorder_document_number);
    const withoutDoc = batch.filter(row => !row.recorder_document_number);

    if (withDoc.length) {
      const { error } = await client
        .from('sold_comps')
        .upsert(withDoc, { onConflict: 'recorder_document_number' });
      if (error) throw error;
      imported += withDoc.length;
    }

    if (withoutDoc.length) {
      const { error } = await client
        .from('sold_comps')
        .insert(withoutDoc);
      if (error) throw error;
      imported += withoutDoc.length;
    }
  }

  return imported;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.csvPath) {
    usage();
    return options.help ? 0 : 1;
  }

  const text = readFileSync(options.csvPath, 'utf8');
  const rows = parseCsv(text);
  const mapped = rows.map(row => mapCountyRecord(row, options));
  const valid = mapped.filter(item => !item.skipReasons.length).map(item => item.comp);
  const skipped = mapped.filter(item => item.skipReasons.length);

  console.log(`County comp import: ${basename(options.csvPath)}`);
  console.log(`Rows read: ${rows.length}`);
  console.log(`Valid multifamily comps: ${valid.length}`);
  console.log(`Skipped rows: ${skipped.length}`);

  const skipCounts = {};
  for (const item of skipped) {
    for (const reason of item.skipReasons) skipCounts[reason] = (skipCounts[reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(skipCounts)) {
    console.log(`- ${reason}: ${count}`);
  }

  if (valid.length) {
    console.log('\nPreview:');
    for (const comp of valid.slice(0, 5)) {
      console.log(`- ${comp.sale_date} | ${comp.address} | ${comp.units || '?'} units | $${Number(comp.sale_price).toLocaleString()} | ${comp.sale_price_method}`);
    }
  }

  if (!options.commit) {
    console.log('\nDry run only. Add --commit to import into Supabase.');
    return 0;
  }

  const imported = await upsertComps(valid);
  console.log(`
Imported/updated ${imported} sold comps.`);
  return 0;
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(err => {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  });
}

export { parseCsv, mapCountyRecord, inferSalePrice };
