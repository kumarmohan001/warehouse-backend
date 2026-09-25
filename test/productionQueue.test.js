import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowRecord } from '../Model/workflow.js';
import { list } from '../Controller/workflow.js';

afterEach(() => mock.restoreAll());
test('receiving queue includes outstanding issues even when another issue is discrepant, scoped to production owner', async () => {
  const expected = { kind: 'requisition', createdBy: 'production-owner', 'issues.status': 'Sent to Production' };
  mock.method(WorkflowRecord, 'countDocuments', async (query) => { assert.deepEqual(query, expected); return 1; });
  mock.method(WorkflowRecord, 'find', (query) => {
    assert.deepEqual(query, expected);
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, then(resolve) { return Promise.resolve([{ status: 'Discrepancy', issues: [{ status: 'Sent to Production' }] }]).then(resolve); } };
  });
  const res = { json(value) { this.body = value; return this; } };
  await list({ user: { role: 'production', _id: 'production-owner' }, params: { kind: 'requisition' }, query: { awaitingReceipt: 'true' } }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.records.length, 1);
});
