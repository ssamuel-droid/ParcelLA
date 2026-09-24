const assert = require('node:assert/strict');
const {
  ED1_RENT_LIMITS_2026,
  rentsForSite,
} = require('../src/data/affordableRents.cjs');

const ed1Site = { isEd1: true };
const pacoimaMarket = { studio: 1550, one: 1950, two: 2550, three: 3350 };

assert.deepEqual(
  rentsForSite(ed1Site, pacoimaMarket),
  pacoimaMarket,
  'ED1 underwriting must not exceed achievable local market rent'
);

assert.deepEqual(
  rentsForSite(ed1Site, { studio: 3000, one: 3200, two: 3800, three: 4500 }),
  ED1_RENT_LIMITS_2026[80],
  'ED1 underwriting must not exceed the restricted-rent ceiling'
);

assert.deepEqual(
  rentsForSite({ isEd1: false }, pacoimaMarket),
  pacoimaMarket,
  'Unrestricted projects should continue to use local market rents'
);

console.log('ED1 rent-cap tests passed');
