import { requireQc, checkDecision } from '../Service/workflowRules.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';
import Notification from '../Model/notification.js';
import { validateQcAssignee, notifyQcAssignment, updateReceivingStatus, markNotificationRead } from '../Service/warehouseReceivingService.js';
import { createMaterialReceiving, updateMaterialReceiving } from '../Controller/wareHouse.js';

afterEach(() => mock.restoreAll());
const owner = new mongoose.Types.ObjectId();
const reviewer = new mongoose.Types.ObjectId();
const otherReviewer = new mongoose.Types.ObjectId();
const documents = Object.fromEntries(['coa', 'invoice', 'packingList', 'otherRequiredDocuments'].map((field) => [field, { fileName: `${field}.pdf` }]));
const values = () => ({ grnNumber: 'MANUAL-123', materialType: 'API', materialCode: 'API-1', materialName: 'Material', supplierName: 'Supplier', poNumber: 'PO-1', invoiceNumber: 'INV-1', batchNo: 'B1', manufacturer: 'Manufacturer', receivedQuantity: 10, containers: 1, manufacturingDate: '2026-01-01', expiryDate: '2028-01-01', receivingDate: '2026-09-24', storageRequirement: 'Ambient', receivedBy: owner, qcAssignedTo: reviewer });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function existing(extra = {}) {
  const record = WarehouseReceiving.hydrate({ ...values(), documents, documentStatus: 'Documents OK', status: 'Quarantine', _id: new mongoose.Types.ObjectId(), ...extra });
  mock.method(record, 'save', async () => { await record.validate(); return record; });
  mock.method(record, 'populate', async () => record);
  mock.method(WarehouseReceiving, 'findById', async () => record);
  return record;
}

test('GRN is required and never auto generated; supplied values are trimmed', async () => {
  const record = new WarehouseReceiving({ ...values(), grnNumber: undefined });
  await assert.rejects(record.validate(), /grnNumber/);
  assert.equal(record.grnNumber, undefined);
  record.grnNumber = '  SUPPLIER-GRN-42  ';
  await record.validate();
  assert.equal(record.grnNumber, 'SUPPLIER-GRN-42');
  assert.equal(record.status, 'Document Hold');
});

test('complete documents start in Quarantine and QC decisions survive edits', async () => {
  const fresh = new WarehouseReceiving({ ...values(), documents });
  await fresh.validate();
  assert.equal(fresh.status, 'Quarantine');
  for (const status of ['Hold', 'Rejected', 'Approved', 'Under Test']) {
    const record = WarehouseReceiving.hydrate({ ...values(), documents, status });
    record.remarks = 'Warehouse edited receipt';
    await record.validate();
    assert.equal(record.status, status);
  }
});

test('document changes preserve Hold and prevent approval with missing documents', async () => {
  const record = WarehouseReceiving.hydrate({ ...values(), documents, status: 'Hold' });
  record.documents.coa = {};
  record.markModified('documents');
  await record.validate();
  assert.equal(record.status, 'Hold');
  record.status = 'Approved';
  await record.validate();
  assert.equal(record.status, 'Document Hold');
});

test('create rejects missing GRN before writing to database', async () => {
  const res = response();
  await createMaterialReceiving({ user: { role: 'warehouse', _id: owner }, body: { ...values(), grnNumber: '' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /grnNumber/);
});

test('create accepts manual GRN alias and excludes client supplied status and owner', async () => {
  let payload;
  mock.method(WarehouseReceiving, 'create', async (data) => { payload = data; return { ...data, status: 'Document Hold' }; });
  const res = response();
  await createMaterialReceiving({ user: { role: 'warehouse', _id: owner }, body: { ...values(), grnNumber: undefined, grn: ' MAN-99 ', qcAssignedTo: '', receivedBy: otherReviewer, status: 'Approved' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(payload.grnNumber, 'MAN-99');
  assert.equal(payload.receivedBy, owner);
  assert.equal(payload.status, undefined);
  assert.equal(payload.qcAssignedTo, null);
});

test('only active QC users or managers can be assigned', async () => {
  await assert.rejects(validateQcAssignee('invalid'), { statusCode: 400 });
  mock.method(User, 'findOne', async (query) => {
    assert.equal(query.status, 'Active');
    assert.deepEqual(query.role.$in, ['qc-test', 'admin']);
    return null;
  });
  await assert.rejects(validateQcAssignee(reviewer), { statusCode: 400 });
  assert.equal(await validateQcAssignee(''), null);
});

test('only a changed assignment creates a persistent notification', async () => {
  const record = { ...values(), _id: new mongoose.Types.ObjectId(), status: 'Quarantine' };
  let count = 0;
  mock.method(Notification, 'create', async (payload) => {
    count++;
    assert.equal(String(payload.recipient), String(reviewer));
    assert.equal(payload.materialReceiving, record._id);
    return { populate: async () => {}, toObject: () => payload };
  });
  await notifyQcAssignment(record, reviewer);
  assert.equal(count, 0);
  await notifyQcAssignment(record, otherReviewer);
  assert.equal(count, 1);
});

test('warehouse edit validates and persists reassignment and notifies new reviewer', async () => {
  const record = existing();
  mock.method(User, 'findOne', async () => ({ _id: otherReviewer }));
  let recipient;
  mock.method(Notification, 'create', async (payload) => {
    recipient = payload.recipient;
    return { populate: async () => {}, toObject: () => payload };
  });
  const res = response();
  await updateMaterialReceiving({ params: { id: record._id }, user: { role: 'warehouse', _id: owner }, body: { qcAssignedTo: String(otherReviewer) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(String(record.qcAssignedTo), String(otherReviewer));
  assert.equal(String(recipient), String(otherReviewer));
});

test('QC approvals require assigned access and a completed testing workflow', () => {
  const record = existing();
  assert.throws(() => requireQc(record, { role: 'warehouse' }), { statusCode: 403 });
  assert.throws(() => requireQc(record, { role: 'qc-test', _id: otherReviewer }), { statusCode: 403 });
  assert.throws(() => checkDecision(record, 'Hold', ''), { statusCode: 400 });
  assert.throws(() => checkDecision(record, 'Approved', ''), { statusCode: 409 });
  assert.doesNotThrow(() => checkDecision(record, 'Hold', 'Needs investigation'));
});

test('read notification update is scoped to authenticated recipient', async () => {
  const id = new mongoose.Types.ObjectId();
  mock.method(Notification, 'findOneAndUpdate', async (query) => {
    assert.equal(query.recipient, reviewer);
    assert.equal(query._id, id);
    return null;
  });
  await assert.rejects(markNotificationRead(id, reviewer), { statusCode: 404 });
});
