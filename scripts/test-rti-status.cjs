const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { statusIsRti } = require('../.github/scripts/sync-permits.cjs');

for (const status of ['Ready to Issue', 'PC Info Complete', 'RTI', 'Permit RTI']) {
  assert.equal(statusIsRti(status), true, `${status} should be RTI`);
}

for (const status of [
  'Not Ready to Issue',
  'PC Approved',
  'Approved',
  'Quality Review Completed',
  'Submitted for Quality Review',
  'Issued',
  '',
]) {
  assert.equal(statusIsRti(status), false, `${status || '(empty)'} should not be RTI`);
}

const appSource = readFileSync(require.resolve('../public/app.js'), 'utf8');
const listingCategory = appSource.match(/function listingCategory\(s\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(
  listingCategory.indexOf("if (s?.rti) return 'rti'") < listingCategory.indexOf("if (isOffMarketSite(s)) return 'off_market'"),
  'RTI must take priority over off-market in the exclusive listing filter'
);

console.log('RTI status classification passed.');
