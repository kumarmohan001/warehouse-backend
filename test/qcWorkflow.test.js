import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';
import Notification from '../Model/notification.js';
import { WorkflowEvent, Sequence } from '../Model/workflow.js';
import { recordSampling, recordTests, qcDecision, attachDocuments } from '../Service/workflowService.js';
import { updateReceivingStatus } from '../Service/warehouseReceivingService.js';

afterEach(() => mock.restoreAll());
const qc = { _id: new mongoose.Types.ObjectId(), role: 'qc-test' };
const warehouse = { _id: new mongoose.Types.ObjectId(), role: 'warehouse' };
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const testResult = () => ({ testName: 'Identity', specification: 'Standard', requiredLimit: 'Match', actualResult: 'Match', testMethod: 'Method A', result: 'Pass', testDate: day, remarks: '' });

function setup() {
  const record = WarehouseReceiving.hydrate({ _id: new mongoose.Types.ObjectId(), grnNumber: 'GRN-QC', materialType: 'API', materialCode: 'API-1', materialName: 'Material A', supplierName: 'Supplier', poNumber: 'PO-1', invoiceNumber: 'INV-1', batchNo: 'B-1', manufacturer: 'Manufacturer', receivedQuantity: 10, containers: 2, manufacturingDate: '2025-01-01', expiryDate: '2030-01-01', receivingDate: day, storageRequirement: 'Ambient', receivedBy: warehouse._id, qcAssignedTo: qc._id, status: 'Quarantine', documentStatus: 'Documents OK', documents: Object.fromEntries(['coa', 'invoice', 'packingList', 'otherRequiredDocuments'].map((kind) => [kind, { fileName: `${kind}.pdf` }])) });
  const notifications = [];
  mock.method(mongoose.connection, 'transaction', async (work) => work(null));
  mock.method(WarehouseReceiving, 'findById', () => ({ session: async () => record }));
  mock.method(record, 'save', async () => { await record.validate(); return record; });
  mock.method(User, 'exists', () => ({ session: async () => ({ _id: qc._id }) }));
  mock.method(User, 'find', () => ({ select: () => ({ session: async () => [warehouse] }) }));
  let sequence = 0;
  mock.method(Sequence, 'findOneAndUpdate', async () => ({ value: ++sequence }));
  mock.method(WorkflowEvent, 'create', async () => []);
  mock.method(Notification, 'create', async (items) => {
    const documents = items.map((item) => new Notification(item));
    await Promise.all(documents.map((item) => item.validate()));
    notifications.push(...documents);
    return documents;
  });
  return { record, notifications };
}
const sampling = () => ({ quantity: 1, containers: 1, samplingDate: day, sampledBy: qc._id, remarks: 'Collected from batch B-1' });

test('sampling persists on the received batch, validates limits, and starts blocked testing', async () => {
  const { record } = setup();
  await assert.rejects(recordSampling(record.id, warehouse, sampling()), { statusCode: 403 });
  await assert.rejects(recordSampling(record.id, qc, { ...sampling(), quantity: 11 }), { statusCode: 400 });
  await assert.rejects(recordSampling(record.id, qc, { ...sampling(), containers: 3 }), { statusCode: 400 });
  const result = await recordSampling(record.id, qc, sampling());
  assert.equal(result.batchNo, 'B-1');
  assert.match(result.sampling.number, /^A\d{4}$/);
  assert.equal(result.status, 'Under Test');
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.toObject().sampling.remarks, sampling().remarks);
  await assert.rejects(recordSampling(record.id, qc, sampling()), { statusCode: 409 });
});

test('one saved passing result satisfies QC Result without a duplicate upload and notifies warehouse', async () => {
  const { record, notifications } = setup();
  await assert.rejects(updateReceivingStatus(record.id, qc, { status: 'Under Test' }), { statusCode: 400 });
  await assert.rejects(updateReceivingStatus(record.id, qc, { status: 'Approved' }), { statusCode: 409 });
  await recordSampling(record.id, qc, sampling());
  await assert.rejects(recordTests(record.id, qc, { tests: [{ ...testResult(), remarks: 'word '.repeat(251) }] }), { statusCode: 400 });
  await recordTests(record.id, qc, { tests: [{ ...testResult(), analyst: warehouse._id }] });
  assert.equal(String(record.qc.tests[0].analyst), String(qc._id));
  await assert.rejects(qcDecision(record.id, qc, { status: 'Approved' }), { statusCode: 409 });
  await attachDocuments('qc', record.id, qc, ['Test Report (COA)', 'Supporting Documents'].map((kind) => ({ kind, fileName: 'report.pdf', fileUrl: 'https://example.test/report.pdf' })));
  // Reload the saved record rather than approving the in-memory form state.
  const reloaded = WarehouseReceiving.hydrate(record.toObject());
  mock.method(WarehouseReceiving, 'findById', () => ({ session: async () => reloaded }));
  mock.method(reloaded, 'save', async () => { await reloaded.validate(); Object.assign(record, reloaded.toObject()); return reloaded; });
  assert.equal(reloaded.qc.tests.length, 1);
  assert.equal(reloaded.qc.documents.some((document) => document.kind === 'QC Result'), false);
  await qcDecision(record.id, qc, { status: 'Approved' });
  assert.equal(record.status, 'Approved');
  assert.equal(record.availableQuantity, 0);
  assert.equal(notifications.at(-1).targetPage, 'QC Approved Queue');
  assert.equal(notifications.at(-1).targetRole, 'warehouse');
  assert.equal(String(notifications.at(-1).materialReceiving), record.id);
});

test('failed tests cannot approve; hold and rejection remain blocked and notify warehouse', async () => {
  const { record, notifications } = setup();
  await recordSampling(record.id, qc, sampling());
  await recordTests(record.id, qc, { tests: [{ ...testResult(), result: 'Fail' }] });
  await assert.rejects(qcDecision(record.id, qc, { status: 'Approved' }), { statusCode: 409 });
  await qcDecision(record.id, qc, { status: 'Hold', note: 'Investigation' });
  assert.equal(record.status, 'Hold');
  await qcDecision(record.id, qc, { status: 'Rejected', note: 'Identity failed' });
  assert.equal(record.status, 'Rejected');
  assert.equal(record.availableQuantity, 0);
  assert.match(notifications.at(-1).message, /Reject material/);
});
