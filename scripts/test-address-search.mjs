import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const {
  searchDbVariants,
  searchVariants,
  siteMatchesSearch,
  parseUnitStreetSearch,
} = await import('../api/routes/sites.js');
const require = createRequire(import.meta.url);
const { knownProjectMetadata } = require('../.github/scripts/underwrite.cjs');

assert.deepEqual(
  searchVariants('17829 W Halstead St'),
  ['17829 W Halstead St', '17829 W HALSTED St'],
);
assert.ok(searchDbVariants('Halstead').includes('HALSTED'));
assert.ok(searchDbVariants('17829 W Halstead St').includes('17829 W HALSTED St'));
assert.equal(siteMatchesSearch({ addr: '17829 W HALSTED ST', units: 232 }, 'Halstead'), true);
assert.equal(siteMatchesSearch({ addr: '17829 W HALSTED ST', units: 232 }, '17829 Halstead'), true);
assert.equal(siteMatchesSearch({ addr: '17830 W HALSTED ST', units: 12 }, '17829 Halstead'), false);

assert.deepEqual(parseUnitStreetSearch('192 on Wilbur'), { units: 192, street: 'Wilbur' });
assert.deepEqual(parseUnitStreetSearch('192 units Wilbur Ave'), { units: 192, street: 'Wilbur Ave' });
assert.deepEqual(parseUnitStreetSearch('192 Wilbur'), { units: 192, street: 'Wilbur' });
assert.ok(searchDbVariants('192 on Wilbur').includes('Wilbur'));
assert.equal(siteMatchesSearch({ addr: '7745 N WILBUR AVE', units: 189 }, '192 on Wilbur'), true);
assert.equal(siteMatchesSearch({ addr: '7745 N WILBUR AVE', units: 189 }, '192 Wilbur'), true);
assert.equal(siteMatchesSearch({ addr: '7947 N WILBUR AVE', units: 128 }, '192 Wilbur'), false);
assert.deepEqual(knownProjectMetadata({ permit_number: '23010-10000-01557' }), {
  neighborhood: 'Reseda',
  isEd1: true,
  planningCase: 'ADM-2023-4428-DB-ED1-VHCA',
  planningUnits: 190,
  preliminaryUnits: 202,
});

console.log('Address alias search tests passed');
