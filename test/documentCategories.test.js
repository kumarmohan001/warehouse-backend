import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentCategories } from '../Service/documentCategories.js';
import { checkDecision } from '../Service/workflowRules.js';

test('one upload preserves separate COA and supporting document categories', () => {
  assert.deepEqual(documentCategories({ documentKinds: JSON.stringify(['Test Report (COA)', 'Supporting Documents']) }, 'qc', 2), ['Test Report (COA)', 'Supporting Documents']);
  assert.deepEqual(documentCategories({ documentKind: 'Supporting Documents' }, 'qc', 1), ['Supporting Documents']);
});

test('reject missing, invalid or mismatched categories instead of saving under a default', () => {
  for (const documentKinds of ['invalid json', '[]', '["FG Documents"]', '["Supporting Documents", "QC Result"]']) {
    assert.throws(() => documentCategories({ documentKinds }, 'qc', 1), { statusCode: 400 });
  }
});

test('approval accepts PDF COA and image supporting documents on the same batch', () => {
  const record = { sampling: { number: 'A0011' }, documentStatus: 'Documents OK', qc: { tests: [{ result: 'Pass' }], documents: [
    { kind: 'Test Report (COA)', fileName: 'report.pdf', fileUrl: 'https://example.test/report.pdf' },
    { kind: 'Supporting Documents', fileName: 'evidence.webp', fileUrl: 'https://example.test/evidence.webp' },
  ] } };
  assert.doesNotThrow(() => checkDecision(record, 'Approved', ''));
  record.qc.documents.pop();
  assert.throws(() => checkDecision(record, 'Approved', ''), /Supporting Documents/);
});
