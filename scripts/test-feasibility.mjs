import assert from 'node:assert/strict';
import { FEASIBILITY_USES, generateFeasibilityScenarios, normalizeZone, underwriteProgram, zoneScreen } from '../src/feasibility/FeasibilityEngine.js';

assert.equal(normalizeZone('[Q]C2-1VL'), 'C2-1VL');
assert.equal(zoneScreen('R4-1').lotPerUnit, 400);
assert.equal(zoneScreen('RD1.5-1').lotPerUnit, 1500);
assert.equal(zoneScreen('M1-1').family, 'industrial');
assert.ok(FEASIBILITY_USES.apartment && FEASIBILITY_USES.industrial && FEASIBILITY_USES.hotel);

const laApartment = generateFeasibilityScenarios({
  lotSf: 10000,
  zone: 'C2-1',
  use: 'apartment',
  jurisdiction: 'Los Angeles city',
  assumptions: { landCost: 3000000 },
});
assert.equal(laApartment.scenarios[0].id, 'by_right');
assert.ok(laApartment.scenarios.some(item => item.id === 'state_density_bonus'));
assert.ok(laApartment.scenarios.some(item => item.id === 'miip'));
assert.ok(laApartment.scenarios.some(item => item.id === 'ed1_ahip'));
assert.ok(laApartment.scenarios.some(item => item.id === 'ab2011'));
assert.ok(laApartment.scenarios.some(item => item.id === 'sb35'));
assert.ok(laApartment.scenarios.find(item => item.id === 'state_density_bonus').program.units > laApartment.scenarios[0].program.units);
assert.ok(laApartment.scenarios.find(item => item.id === 'ed1_ahip').underwriting.assumptions.rentPsfMo < laApartment.scenarios[0].underwriting.assumptions.rentPsfMo);

const industrial = generateFeasibilityScenarios({ lotSf: 20000, zone: 'M1-1', use: 'industrial', jurisdiction: 'Los Angeles city' });
assert.deepEqual(industrial.scenarios.map(item => item.id), ['by_right']);
assert.equal(industrial.scenarios[0].eligibility, 'potentially_eligible');
assert.ok(industrial.scenarios[0].program.grossSf > 0);

const outsideLa = generateFeasibilityScenarios({ lotSf: 9000, zone: 'C2', use: 'apartment', jurisdiction: 'Santa Monica city' });
assert.ok(!outsideLa.scenarios.some(item => item.id === 'miip'));
assert.ok(!outsideLa.scenarios.some(item => item.id === 'ed1_ahip'));
assert.ok(outsideLa.scenarios.some(item => item.id === 'state_density_bonus'));

const sfr = generateFeasibilityScenarios({ lotSf: 6000, zone: 'R1-1', use: 'single_family', jurisdiction: 'Los Angeles city' });
assert.ok(sfr.scenarios.some(item => item.id === 'sb9'));
assert.ok(sfr.scenarios.some(item => item.id === 'adu'));

const model = underwriteProgram({ grossSf: 20000, netSf: 17000, commercialSf: 17000, units: 0, stories: 1 }, 'industrial', { landCost: 2000000 });
assert.ok(model.hardCosts > 0);
assert.ok(model.totalCost > model.hardCosts);
assert.ok(model.exitValue > 0);
assert.equal(Number.isFinite(model.marginOnCost), true);

console.log('Feasibility engine tests passed.');
