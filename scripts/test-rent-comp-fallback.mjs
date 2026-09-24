import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
const { benchmarkRentRows } = await import('../api/routes/comps.js');

const rows = benchmarkRentRows('Pacoima', [
  { address: '', neighborhood: 'Silver Lake', bedroomType: 'one', monthlyRent: 2800 },
  { address: '', neighborhood: 'Pacoima', bedroomType: 'one', monthlyRent: 1973 },
]);

assert.equal(rows.length, 1);
assert.equal(rows[0].neighborhood, 'Pacoima');
assert.equal(rows[0].monthlyRent, 1973);

const staticRows = benchmarkRentRows('Pacoima', [
  { address: '', neighborhood: 'Silver Lake', bedroomType: 'one', monthlyRent: 2800 },
]);
assert.deepEqual(
  Object.fromEntries(staticRows.map(row => [row.bedroomType, row.monthlyRent])),
  { Studio: 1650, '1 BR': 1973, '2 BR': 2385, '3 BR': 3007 }
);

console.log('Rent-comp fallback tests passed');
