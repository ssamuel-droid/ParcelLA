import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'house-lot-test-key';
process.env.SUPABASE_ANON_KEY ||= 'house-lot-test-anon-key';

const { countyAddressParts, enrichPermitHouseLots, normalizedLotDetails } = await import('../api/routes/sites.js');

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

const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const params = new URLSearchParams(options?.body);
  assert.match(params.get('where') || '', /4415014008/);
  return new Response(JSON.stringify({
    features: [{
      attributes: {
        AIN: '4415014008',
        APN: '4415-014-008',
        SitusFullAddress: '16821 LIVORNO DR LOS ANGELES CA 90272',
        Shape__Area: 6269.74825,
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
try {
  const [enriched] = await enrichPermitHouseLots([{
    id: 2290280,
    address: '16821 W LIVORNO DR',
    raw_permit_data: { apn: '4415-014-008' },
  }], { persist: false });
  assert.equal(enriched.lot_sf, 6270);
  assert.equal(enriched.lot_sf_source, 'LA County Assessor parcel polygon');
  assert.deepEqual(enriched.raw_permit_data.apns, ['4415014008']);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('House lot normalization tests passed.');
