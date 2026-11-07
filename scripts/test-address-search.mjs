import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const {
  searchDbVariants,
  searchVariants,
  siteMatchesSearch,
} = await import('../api/routes/sites.js');

assert.deepEqual(
  searchVariants('17829 W Halstead St'),
  ['17829 W Halstead St', '17829 W HALSTED St'],
);
assert.ok(searchDbVariants('Halstead').includes('HALSTED'));
assert.ok(searchDbVariants('17829 W Halstead St').includes('17829 W HALSTED St'));
assert.equal(siteMatchesSearch({ addr: '17829 W HALSTED ST', units: 232 }, 'Halstead'), true);
assert.equal(siteMatchesSearch({ addr: '17829 W HALSTED ST', units: 232 }, '17829 Halstead'), true);
assert.equal(siteMatchesSearch({ addr: '17830 W HALSTED ST', units: 12 }, '17829 Halstead'), false);

console.log('Address alias search tests passed');
