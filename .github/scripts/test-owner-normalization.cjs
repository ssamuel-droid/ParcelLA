const assert = require('assert');
const {
  normalizeRegrid,
  normalizeRentCast,
  ownerNameParts,
  latestRentCastSale,
} = require('./enrich-owners.cjs');
const {
  compactAttomMortgage,
  compactPropertyRecord,
  normalizeApns,
  rentCastMatchedRecords,
  rentCastSaleHistory,
} = require('./monthly-property-enrichment.cjs');

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
assert.deepStrictEqual(
  rentCastSaleHistory(structured).map(sale => [sale.date, sale.price]),
  [['2025-03-04', 850000], ['2021-01-02', 500000]]
);

const ownerPatch = normalizeRentCast(structured);
assert.strictEqual(ownerPatch.owner_name, 'Jane Doe / Example Holdings LLC');
assert.strictEqual(ownerPatch.owner_last_sale_date, '2025-03-04');
assert.strictEqual(ownerPatch.owner_last_sale_amount, 850000);

const compact = compactPropertyRecord(structured);
assert.strictEqual(compact.ownerName, 'Jane Doe / Example Holdings LLC');
assert.strictEqual(compact.lastSaleDate, '2025-03-04');
assert.strictEqual(compact.lastSalePrice, 850000);
assert.strictEqual(compact.saleHistory.length, 2);
assert.notStrictEqual(compact.ownerName, '[object Object]');

assert.deepStrictEqual(normalizeApns('5546-026-020', ['5546026037']), ['5546026020', '5546026037']);
const matchedParcels = rentCastMatchedRecords([
  { assessorID: '5546-026-020', formattedAddress: '6201 W Sunset Blvd', latitude: 34.09811, longitude: -118.32451 },
  { assessorID: '5546-026-037', formattedAddress: '6229 W Sunset Blvd', latitude: 34.09815, longitude: -118.32456 },
  { assessorID: '9999-999-999', formattedAddress: '6200 W Sunset Blvd', latitude: 34.09812, longitude: -118.32452 },
], {
  address: '6201-6229 W Sunset Blvd',
  lat: 34.0981,
  lng: -118.3245,
  apns: ['5546026020', '5546026037'],
});
assert.deepStrictEqual(matchedParcels.map(row => row.assessorID), ['5546-026-020', '5546-026-037']);
assert.deepStrictEqual(
  rentCastMatchedRecords([
    { assessorID: '4412-003-010', formattedAddress: '267 N Toyopa Dr, Pacific Palisades, CA 90272' },
  ], { address: '267 N Toyopa Dr' }).map(row => row.assessorID),
  ['4412-003-010']
);

const mortgage = compactAttomMortgage({
  property: [{
    identifier: { attomId: 12345 },
    mortgage: {
      amount: 640000,
      date: '2025-03-04T00:00:00.000Z',
      lender: { firstname: 'Example Bank' },
      interestrate: 6.25,
      term: 360,
    },
  }],
});
assert.strictEqual(mortgage.amount, 640000);
assert.strictEqual(mortgage.date, '2025-03-04');
assert.strictEqual(mortgage.lender, 'Example Bank');
assert.strictEqual(mortgage.interestRate, 6.25);
assert.strictEqual(mortgage.termMonths, 360);

const noMortgage = compactAttomMortgage({ property: [{ mortgage: {} }] });
assert.strictEqual(noMortgage, null);

const deedOwnerPatch = normalizeRegrid({
  properties: {
    fields: {},
    enhancedOwnership: [{
      fields: {
        eo_deedowner: 'Current Deed Owner LLC',
        eo_deedowner2: 'Second Deed Owner',
      },
    }],
  },
});
assert.strictEqual(deedOwnerPatch.owner_name, 'Current Deed Owner LLC / Second Deed Owner');

console.log('Owner normalization tests passed.');
