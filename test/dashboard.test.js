import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../Model/user.js';
import WarehouseReceiving from '../Model/wareHouse.js';
import { WorkflowRecord } from '../Model/workflow.js';
import { getAccountDashboard } from '../Controller/dashboard.js';

afterEach(() => mock.restoreAll());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
for (const [role, field] of [['warehouse', 'receivedBy'], ['qc-test', 'qcAssignedTo'], ['production', 'createdBy']]) {
  test(`${role} dashboard scopes counts and records to authenticated account`, async () => {
    const id = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    mock.method(User, 'findById', (selected) => {
      assert.equal(String(selected), String(id));
      return { select: async () => ({ _id: id, role }) };
    });
    const model = role === 'production' ? WorkflowRecord : WarehouseReceiving;
    mock.method(model, 'aggregate', async (pipeline) => {
      if (role === 'warehouse' && pipeline[0].$group) {
        assert.equal(pipeline[0].$group._id, '$quantityUnit');
        assert.deepEqual(pipeline[0].$group.received, { $sum: '$receivedQuantity' });
        return [{ _id: 'Kg', received: 150, available: 100, batches: 2 }];
      }
      assert.deepEqual(pipeline[0], { $match: { [field]: id } });
      return [];
    });
    mock.method(model, 'find', (scope) => {
      assert.deepEqual(scope, { [field]: id });
      return { select() { return this; }, sort() { return this; }, limit: async () => [] };
    });
    const res = response();
    await getAccountDashboard({ user: { _id: id, role }, params: {}, query: { userId: otherId } }, res);
    assert.equal(res.body.success, true);
    if (role === 'warehouse') assert.equal(res.body.data.warehouseStock[0].received, 150);
  });
}
test('non-admin cannot request another account dashboard', async () => {
  const res = response();
  await getAccountDashboard({ user: { _id: new mongoose.Types.ObjectId(), role: 'warehouse' }, params: { id: String(new mongoose.Types.ObjectId()) } }, res);
  assert.equal(res.statusCode, 403);
});
