const assert = require('assert');
const {
  normalizeRentCast,
  ownerNameParts,
  latestRentCastSale,
} = require('./enrich-owners.cjs');
const { compactPropertyRecord } = require('./monthly-property-enrichment.cjs');

const structured = {
  formattedAddress: '123 Test Ave, Los Angeles, CA 90001',
  owner: {
    names: [
      { firstName: 'Jane', lastName: 'Doe' },
      { companyName: 'Example Holdings LLC' },
    ],
  },
  history: {
    '2021-01-02': { event: 'Sale', date: '2021-01-02T00:00:00.000Z', price: 500000 },
    '2025-03-04': { event: 'Sale', date: '2025-03-04T00:00:00.000Z', price: 850000 },
  },
};

assert.deepStrictEqual(
  ownerNameParts(structured.owner.names),
  ['Jane Doe', 'Example Holdings LLC']
);
assert.strictEqual(latestRentCastSale(structured).price, 850000);

const ownerPatch = normalizeRentCast(structured);
assert.strictEqual(ownerPatch.owner_name, 'Jane Doe / Example Holdings LLC');
assert.strictEqual(ownerPatch.owner_last_sale_date, '2025-03-04');
assert.strictEqual(ownerPatch.owner_last_sale_amount, 850000);

const compact = compactPropertyRecord(structured);
assert.strictEqual(compact.ownerName, 'Jane Doe / Example Holdings LLC');
assert.strictEqual(compact.lastSaleDate, '2025-03-04');
assert.strictEqual(compact.lastSalePrice, 850000);
assert.notStrictEqual(compact.ownerName, '[object Object]');

console.log('Owner normalization tests passed.');
