import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'owner-route-test-key';

const {
  fetchJsonWithRetry,
  normalizeAttomRecord,
  normalizeApns,
  normalizeCountyAssessorRecord,
  normalizeOwnerFeature,
  normalizeRentCastRecord,
  rentCastMatchedRecords,
  rentCastPropertyUrl,
  saleHistoryFromRecord,
} = await import('../api/routes/owners.js');

assert.deepEqual(
  normalizeApns('5546-026-020, 5546-026-037', ['5546026041', '5546-026-020']),
  ['5546026020', '5546026037', '5546026041'],
);
assert.deepEqual(normalizeApns('12345678901234'), ['12345678901234']);

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

const exactWithCoordinatesUrl = rentCastPropertyUrl({
  address: '267 N Toyopa Dr',
  locality: 'Pacific Palisades',
  zipCode: '90272',
  lat: 34.03214,
  lng: -118.52002,
});
assert.equal(exactWithCoordinatesUrl.searchParams.get('address'), '267 N Toyopa Dr, Pacific Palisades, CA 90272');
assert.equal(exactWithCoordinatesUrl.searchParams.get('latitude'), null);

const rangeUrl = rentCastPropertyUrl({
  address: '6201-6229 W Sunset Blvd',
  lat: 34.0981,
  lng: -118.3245,
}, 'coordinates');
assert.equal(rangeUrl.searchParams.get('address'), null);
assert.equal(rangeUrl.searchParams.get('latitude'), '34.0981');
assert.equal(rangeUrl.searchParams.get('longitude'), '-118.3245');
assert.equal(rangeUrl.searchParams.get('radius'), '0.12');
assert.equal(rangeUrl.searchParams.get('limit'), '50');

const parcelMatches = rentCastMatchedRecords([
  { assessorID: '5546-026-020', formattedAddress: '6201 W Sunset Blvd', latitude: 34.09811, longitude: -118.32451 },
  { assessorID: '5546-026-037', formattedAddress: '6229 W Sunset Blvd', latitude: 34.09815, longitude: -118.32456 },
  { assessorID: '9999-999-999', formattedAddress: '6200 W Sunset Blvd', latitude: 34.09812, longitude: -118.32452 },
], {
  address: '6201-6229 W Sunset Blvd',
  lat: 34.0981,
  lng: -118.3245,
  apns: ['5546026020', '5546026037'],
});
assert.deepEqual(parcelMatches.map(row => row.assessorID), ['5546-026-020', '5546-026-037']);

const countyOwner = normalizeOwnerFeature({
  attributes: {
    AIN: '5546026037',
    First_Owner_Name: 'EXAMPLE OWNER LLC',
    Last_Sale_Date: '20250131',
    Last_Sale_Amount: 5100000,
    Last_Sale_Verif_Key: 'A',
    Sale_Two_Date: '20180615',
    Sale_Two_Amount: 2800000,
    Sale_Two_Verif_Key: 'B',
    Sale_Three_Date: '20120120',
    Sale_Three_Amount: 1900000,
    Sale_Three_Verif_Key: 'C',
    LUDesc: 'Single Family Residence',
  },
});
assert.equal(countyOwner.ownerName, 'EXAMPLE OWNER LLC');
assert.equal(countyOwner.saleHistory.length, 3);
assert.equal(countyOwner.saleHistory[0].price, 5100000);
assert.equal(countyOwner.useDescription, 'Single Family Residence');

const countyPortalRecord = normalizeCountyAssessorRecord({
  Parcel: {
    AIN: '5546026020',
    SitusStreet: '6215 W SUNSET BLVD',
    SitusCity: 'LOS ANGELES CA',
    SitusZipCode: '90028-8704',
    UseType: 'Commercial',
    SqftMain: 4100,
    SqftLot: 41121,
    CurrentRoll_LandValue: 10250000,
    CurrentRoll_ImpValue: 50000,
  },
}, {
  Parcel_OwnershipHistory: [
    { RecordingDate: '11/08/2012', DTTSalePrice: '54875000', DocumentNumber: '1700936', DocumentTypeDesc: 'Sale for Consideration - Full DTT' },
    { RecordingDate: '04/13/2012', DTTSalePrice: '', DocumentNumber: '0558339', DocumentTypeDesc: 'Foreclosure' },
    { RecordingDate: '04/19/2007', DTTSalePrice: '70000000', DocumentNumber: '0938103', DocumentTypeDesc: 'Sale for Consideration - Full DTT' },
  ],
}, '5546026020');

assert.equal(countyPortalRecord.ownerName, null);
assert.equal(countyPortalRecord.apn, '5546026020');
assert.equal(countyPortalRecord.lotSize, 41121);
assert.deepEqual(
  countyPortalRecord.saleHistory.map(sale => [sale.date, sale.price]),
  [['2012-11-08', 54875000], ['2007-04-19', 70000000]],
);

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

const mergedSaleSources = saleHistoryFromRecord({
  saleHistory: [
    { date: '2022-05-18', price: 8400084, documentNumber: '0539388', source: 'LA County Assessor Portal' },
    { date: '2022-05-18', price: 8400000, source: 'RentCast property records' },
  ],
});
assert.equal(mergedSaleSources.length, 1);
assert.equal(mergedSaleSources[0].price, 8400084);
assert.equal(mergedSaleSources[0].documentNumber, '0539388');

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
