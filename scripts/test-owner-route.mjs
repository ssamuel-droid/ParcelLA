import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'owner-route-test-key';

const {
  fetchJsonWithRetry,
  normalizeAttomRecord,
  normalizeRentCastRecord,
  rentCastPropertyUrl,
  saleHistoryFromRecord,
} = await import('../api/routes/owners.js');

const originalFetch = globalThis.fetch;
let retryCalls = 0;
globalThis.fetch = async () => {
  retryCalls += 1;
  if (retryCalls === 1) {
    return new Response('Rate exceeded.', { status: 429 });
  }
  return Response.json([{ formattedAddress: '267 N Toyopa Dr, Pacific Palisades, CA 90272' }]);
};
const retriedPayload = await fetchJsonWithRetry('https://example.test/properties', 1000, {}, { baseDelayMs: 1 });
assert.equal(retryCalls, 2);
assert.equal(retriedPayload[0].formattedAddress, '267 N Toyopa Dr, Pacific Palisades, CA 90272');

retryCalls = 0;
globalThis.fetch = async () => {
  retryCalls += 1;
  return new Response('Unauthorized', { status: 401 });
};
await assert.rejects(
  fetchJsonWithRetry('https://example.test/properties', 1000, {}, { baseDelayMs: 1 }),
  /HTTP 401/
);
assert.equal(retryCalls, 1);
globalThis.fetch = originalFetch;

const exactUrl = rentCastPropertyUrl({ address: '267 N Toyopa Dr' });
assert.equal(exactUrl.searchParams.get('address'), '267 N Toyopa Dr, Los Angeles, CA');
assert.equal(exactUrl.searchParams.get('latitude'), null);

const rangeUrl = rentCastPropertyUrl({
  address: '6201-6229 W Sunset Blvd',
  lat: 34.0981,
  lng: -118.3245,
});
assert.equal(rangeUrl.searchParams.get('address'), null);
assert.equal(rangeUrl.searchParams.get('latitude'), '34.0981');
assert.equal(rangeUrl.searchParams.get('longitude'), '-118.3245');
assert.equal(rangeUrl.searchParams.get('limit'), '10');

const rentcast = normalizeRentCastRecord({
  formattedAddress: '267 N Toyopa Dr, Pacific Palisades, CA 90272',
  assessorID: '4412-003-010',
  owner: {
    names: ['Example Owner LLC'],
    type: 'Organization',
    mailingAddress: { formattedAddress: 'PO Box 100, Los Angeles, CA 90001' },
  },
  history: {
    '2025-02-01': { event: 'Sale', date: '2025-02-01T00:00:00.000Z', price: 5100000 },
    '2018-06-15': { event: 'Sale', date: '2018-06-15T00:00:00.000Z', price: 2800000 },
  },
});

assert.equal(rentcast.ownerName, 'Example Owner LLC');
assert.equal(rentcast.ownerType, 'Organization');
assert.equal(rentcast.saleHistory.length, 2);
assert.deepEqual(
  saleHistoryFromRecord(rentcast).map(sale => [sale.date, sale.price]),
  [['2025-02-01', 5100000], ['2018-06-15', 2800000]],
);

const attom = normalizeAttomRecord({
  property: [{
    identifier: { apn: '4412003010' },
    address: { oneLine: '267 N TOYOPA DR, PACIFIC PALISADES, CA 90272' },
    summary: { absenteeInd: 'Absentee Owner' },
    owner: {
      owner1: { firstnameandmi: 'EXAMPLE', lastname: 'HOLDINGS LLC' },
      mailingaddressoneline: 'PO BOX 100 LOS ANGELES CA 90001',
      ownerrelationshiprightscode: 'Company',
    },
    mortgage: {
      amount: 3200000,
      date: '2025-02-01T00:00:00.000Z',
      lender: { firstname: 'Example Bank' },
      interestrate: 6.25,
      term: 360,
    },
  }],
});

assert.equal(attom.ownerName, 'EXAMPLE HOLDINGS LLC');
assert.equal(attom.ownerType, 'Company');
assert.equal(attom.ownerOccupied, false);
assert.equal(attom.originalMortgage.amount, 3200000);
assert.equal(attom.originalMortgage.lender, 'Example Bank');
assert.equal(attom.originalMortgage.termMonths, 360);

console.log('Owner route normalization tests passed.');
