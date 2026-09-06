import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'house-lot-test-key';
process.env.SUPABASE_ANON_KEY ||= 'house-lot-test-anon-key';

const { countyAddressParts, normalizedLotDetails } = await import('../api/routes/sites.js');

assert.deepEqual(countyAddressParts('16821 W Livorno Dr, Los Angeles, CA 90272'), {
  houseNo: '16821',
  street: 'LIVORNO DR',
  key: '16821|LIVORNO DR',
});

assert.deepEqual(normalizedLotDetails({
  external_property_record: { lotSize: 6269.7 },
}), {
  lotSf: 6270,
  source: 'Monthly property record',
});

assert.deepEqual(normalizedLotDetails({
  raw_permit_data: { lot_area: '3,383 SF' },
}), {
  lotSf: 3383,
  source: 'Permit source field',
});

assert.equal(normalizedLotDetails({
  lot_sf: 5000,
  status: 'off-market',
  permit_source_id: '123',
}).lotSf, null);

assert.deepEqual(normalizedLotDetails({
  lot_sf: 5000,
  raw_permit_data: { lot_sf_source: 'LA County Assessor parcel polygon' },
}), {
  lotSf: 5000,
  source: 'LA County Assessor parcel polygon',
});

console.log('House lot normalization tests passed.');
