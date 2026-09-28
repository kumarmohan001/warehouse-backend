import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qcCompletion } from '../../frontend/src/pages/shared/workflow/qcCompletion.js';

test('opening raw receipts with document objects does not crash QC completion', () => {
  const receipt = { documents: { coa: { fileUrl: 'https://example.test/coa.pdf' }, invoice: {}, packingList: {}, otherRequiredDocuments: {} }, qc: { tests: [], documents: [] } };
  const completion = qcCompletion(receipt);
  assert.equal(completion.uploadFg, false);
  assert.equal(completion.sampling, false);
  assert.deepEqual(completion.missingDocuments, ['Test Report (COA)', 'Supporting Documents']);
  assert.equal(qcCompletion(null).uploadFg, false);
});

test('finished goods attachment arrays still show upload completion', () => {
  assert.equal(qcCompletion({ documents: [{ fileUrl: 'https://example.test/fg.pdf' }] }).uploadFg, true);
  assert.equal(qcCompletion({ documents: [] }).uploadFg, false);
});
