import assert from 'node:assert/strict';
import { generateFeasibilityScenarios } from '../src/feasibility/FeasibilityEngine.js';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
const { addressSuggestions, santaAnaParcelLookup, santaAnaZoneProfile } = await import('../api/routes/feasibility.js');

const suggestions = await addressSuggestions('201 e macarthur');
assert.ok(suggestions.some(item => /201 E Macarthur Blvd, Santa Ana/i.test(item.address)));

const parcels = await santaAnaParcelLookup('201 E MACARTHUR BLVD, SANTA ANA, CA, 92707');
assert.equal(parcels.length, 1);
assert.equal(parcels[0].apn, '411-072-08');
assert.equal(parcels[0].lotSf, 73405);
assert.equal(parcels[0].zone, 'SD43');
assert.equal(parcels[0].generalPlan, 'DC-2');
assert.equal(parcels[0].generalPlanDensity, 90);
assert.equal(parcels[0].generalPlanIntensity, 2);

const profile = santaAnaZoneProfile(parcels[0].zone, parcels[0]);
const baseUnits = Math.floor(parcels[0].lotSf * parcels[0].generalPlanDensity / 43560);
const result = generateFeasibilityScenarios({
  lotSf: parcels[0].lotSf,
  zone: parcels[0].zone,
  zoneProfile: profile,
  baseFar: parcels[0].generalPlanIntensity,
  baseUnits,
  use: 'apartment',
  jurisdiction: 'Santa Ana city',
  inSantaAna: true,
  inCalifornia: true,
});

assert.equal(result.baseUnits, 151);
assert.equal(result.scenarios[0].program.units, 151);
assert.ok(result.scenarios.some(item => item.id === 'state_density_bonus'));
assert.ok(result.scenarios.some(item => item.id === 'sb79'));
assert.ok(!result.scenarios.some(item => item.id.startsWith('ed1_ahip')));

const broadwayParcels = await santaAnaParcelLookup('1327 N BROADWAY, SANTA ANA, CA, 92706');
assert.equal(broadwayParcels.length, 1);
assert.equal(broadwayParcels[0].apn, '398-523-06');
assert.equal(broadwayParcels[0].lotSf, 16003);
assert.equal(broadwayParcels[0].zone, 'SP3-BC');
const broadway = generateFeasibilityScenarios({
  lotSf: broadwayParcels[0].lotSf,
  zone: broadwayParcels[0].zone,
  zoneProfile: santaAnaZoneProfile(broadwayParcels[0].zone, broadwayParcels[0]),
  baseFar: broadwayParcels[0].generalPlanIntensity,
  use: 'apartment',
  jurisdiction: 'Santa Ana city',
  inSantaAna: true,
  inCalifornia: true,
});
assert.equal(broadway.baseUnits, 0);
assert.equal(broadway.scenarios.find(item => item.id === 'ab2011').program.units, 12);
assert.equal(broadway.scenarios.find(item => item.id === 'ab2011_transit').program.units, 30);
assert.equal(broadway.scenarios.find(item => item.id === 'ab2011_affordable').program.units, 30);
assert.ok(!broadway.scenarios.some(item => item.id.startsWith('ed1_ahip')));

console.log('Santa Ana feasibility integration tests passed.');
