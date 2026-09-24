const assert = require('node:assert/strict');
const {
  DEFAULT_MARKET_LAND_PER_DOOR,
  DEFAULT_ED1_LAND_PER_DOOR,
  perDoorLandBasis,
} = require('../src/data/landBasis.cjs');

assert.equal(DEFAULT_MARKET_LAND_PER_DOOR, 100000);
assert.equal(DEFAULT_ED1_LAND_PER_DOOR, 30000);
assert.deepEqual(
  perDoorLandBasis({ type: 'Multifamily', units: 205, isEd1: true }),
  {
    value: 6150000,
    source: 'default_ed1_per_door',
    metricLabel: 'price per door',
    metricValue: 30000,
    basisQuantity: 205,
    compCount: 0,
    matchLabel: 'ED1 default',
    comps: [],
  }
);
assert.equal(perDoorLandBasis({ type: 'Multifamily', units: 205 }).value, 20500000);
assert.equal(perDoorLandBasis({ type: 'New House', units: 1, isEd1: true }), null);

console.log('Land-basis tests passed');
