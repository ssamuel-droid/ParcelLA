const assert = require('node:assert/strict');
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

console.log('RTI status classification passed.');
