const assert = require('assert');
const {
  buildMatches,
  caseApns,
  completedCase,
  extractApns,
  filingCase,
  mergeExistingCaseData,
  mergeCases,
} = require('../.github/scripts/sync-planning-cases.cjs');

assert.deepStrictEqual(
  extractApns('5546-026-020, 5546-026-037 / 5546026041'),
  ['5546026020', '5546026037', '5546026041']
);
assert.deepStrictEqual(extractApns('12345678901234'), ['12345678901234']);

const filed = filingCase({
  attributes: {
    USER_CaseNumber: 'ZA-2026-1000',
    User_fld: '5546-026-020; 5546-026-037',
    USER_Address: '6201-6229 W Sunset Blvd',
  },
});
const completed = completedCase({
  attributes: {
    CaseNumber: 'ZA-2026-1000',
    APN: '5546-026-037, 5546-026-041',
    Address: '6215 W Sunset Blvd',
  },
});
const [planningCase] = mergeCases([filed], [completed]);

assert.deepStrictEqual(caseApns(planningCase), ['5546026037', '5546026041', '5546026020']);

const preservedCase = mergeExistingCaseData(filed, {
  case_number: 'ZA-2026-1000',
  apn: '5546026041',
  documents_checked_at: '2026-08-31T12:00:00.000Z',
  case_addresses: [{ address: '6215 W Sunset Blvd' }],
  related_case_numbers: ['ENV-2026-1001-CE'],
  zimas_pin: 'PIN-123',
  zimas_url: 'https://zimas.example/PIN-123',
  source_record: {
    apns: ['5546026041'],
    pdis: {
      applicant: 'Example Applicant',
      documentParties: { owners: ['Example Owner LLC'], applicants: [] },
    },
  },
});
assert.deepStrictEqual(preservedCase.source_record.pdis.documentParties.owners, ['Example Owner LLC']);
assert.deepStrictEqual(caseApns(preservedCase), ['5546026020', '5546026037', '5546026041']);
assert.equal(preservedCase.documents_checked_at, '2026-08-31T12:00:00.000Z');
assert.deepStrictEqual(preservedCase.related_case_numbers, ['ENV-2026-1001-CE']);
assert.equal(preservedCase.zimas_pin, 'PIN-123');

const matches = buildMatches([planningCase], [{
  id: 42,
  address: '6201-6229 W Sunset Blvd',
  apn: '5546026020',
  raw_permit_data: { apns: ['5546026020', '5546026041'] },
}]);

assert.equal(matches.length, 1);
assert.equal(matches[0].site_id, 42);
assert.equal(matches[0].case_number, 'ZA-2026-1000');
assert.equal(matches[0].match_method, 'apn');

console.log('Planning multi-APN tests passed.');
