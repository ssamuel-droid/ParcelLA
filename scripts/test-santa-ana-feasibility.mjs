import assert from 'node:assert/strict';
import { generateFeasibilityScenarios } from '../src/feasibility/FeasibilityEngine.js';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
const { santaAnaParcelLookup, santaAnaZoneProfile } = await import('../api/routes/feasibility.js');

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

console.log('Santa Ana feasibility integration tests passed.');
