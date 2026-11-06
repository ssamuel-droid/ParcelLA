import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { isRecentPeriod } = await import('../api/routes/comps.js');
const { LAND_COMP_RECENCY_DAYS, buildLandCompBenchmarks } = await import('../src/data/landValue.js');

const DAY_MS = 86400000;
const asOf = new Date('2026-11-05T12:00:00Z');
const dateDaysBefore = days => new Date(asOf.getTime() - days * DAY_MS).toISOString().slice(0, 10);
const sale = days => ({
  address: `${days} Test Ave`,
  neighborhood: 'East Hollywood',
  project_type: 'Multifamily',
  sale_date: dateDaysBefore(days),
  sale_price: 15000000,
  units: 100,
});

assert.equal(LAND_COMP_RECENCY_DAYS, 730);
const benchmarks = buildLandCompBenchmarks([sale(729), sale(731)], { asOf });
const recent = benchmarks.groups['East Hollywood|Multifamily|ppu'] || [];
assert.deepEqual(recent.map(row => row.address), ['729 Test Ave']);

assert.equal(isRecentPeriod(new Date(Date.now() - 729 * DAY_MS).toISOString(), 730), true);
assert.equal(isRecentPeriod(new Date(Date.now() - 731 * DAY_MS).toISOString(), 730), false);

console.log('Two-year comp-recency tests passed');
