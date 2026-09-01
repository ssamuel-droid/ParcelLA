import assert from 'node:assert/strict';
import { extractPlanningParties } from '../api/lib/planning-parties.js';

const palladium = extractPlanningParties(`
  NAME OF APPLICANT / OWNER:
  Elizabeth Kruis, Live Nation Entertainment (Applicant) / CH Palladium LLC &
  CH Palladium Holdings LLC (Owner)
  CONTACT PERSON (If different from Applicant/Owner above) TELEPHONE NUMBER
  Jonathan Lonner, Burns & Bouchard, Inc. (310) 802-4261
`);

assert.deepEqual(palladium.applicants, ['Elizabeth Kruis, Live Nation Entertainment']);
assert.deepEqual(palladium.owners, ['CH Palladium LLC & CH Palladium Holdings LLC']);

const separateLabels = extractPlanningParties(`
  APPLICANT: Example Development, Inc.
  OWNER: Sunset Property Holdings LLC
  REPRESENTATIVE: Example Planning Group
`);

assert.deepEqual(separateLabels.applicants, ['Example Development, Inc.']);
assert.deepEqual(separateLabels.owners, ['Sunset Property Holdings LLC']);

console.log('Planning party extraction tests passed.');
