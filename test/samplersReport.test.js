import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import { saveSamplersReport } from '../Controller/samplersReport.js';
import { getMaterialReceivingById } from '../Controller/wareHouse.js';

afterEach(() => mock.restoreAll());
const qc = { _id: new mongoose.Types.ObjectId(), role: 'qc-test', name: 'QC Analyst' };
const owner = new mongoose.Types.ObjectId();
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const values = () => ({ revision: 0, arNumber: 'AR-001', containersSampled: 2, quantityToBeSampled: 2, quantitySampled: 1, containerType: 'Bags', sealOfContainers: 'Intact', packingConditions: 'Good', sampledByName: 'Sampler A', samplingDate: day, remarks: 'Collected from batch.' });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function setup(extra = {}) {
  let persisted;
  const record = WarehouseReceiving.hydrate({ _id: new mongoose.Types.ObjectId(), __v: 0, grnNumber: 'GRN-SAMPLE', materialType: 'API', materialCode: 'API-1', materialName: 'Material A', supplierName: 'Supplier A', poNumber: 'PO-1', invoiceNumber: 'INV-1', batchNo: 'B1', manufacturer: 'Make A', receivedQuantity: 10, quantityUnit: 'Kg', containers: 3, manufacturingDate: '2025-01-01', expiryDate: '2030-01-01', receivingDate: day, storageRequirement: 'Ambient', receivedBy: owner, status: 'Document Hold', ...extra });
  mock.method(WarehouseReceiving, 'findById', async () => record);
  mock.method(record, 'save', async () => { await record.validate(); record.__v++; persisted = record.toObject(); return record; });
  return { record, reloaded: () => WarehouseReceiving.hydrate(persisted) };
}
async function save(record, body = values(), user = qc) {
  const res = response(); await saveSamplersReport({ params: { id: String(record._id) }, body, user }, res); return res;
}

test('report saves against the exact receipt with trusted stock fields and survives reload', async () => {
  const { record, reloaded } = setup();
  const res = await save(record, { ...values(), materialName: 'Forged', receivedQuantity: 999, recordedBy: owner });
  assert.equal(res.statusCode, 200);
  const saved = reloaded();
  assert.equal(saved.samplersReport.materialName, 'Material A');
  assert.equal(saved.samplersReport.receivedQuantity, 10);
  assert.equal(saved.samplersReport.batchNo, 'B1');
  assert.equal(saved.samplersReport.arNumber, 'AR-001');
  assert.equal(String(saved.samplersReport.recordedBy), String(qc._id));
  assert.equal(saved.samplersReport.quantitySampled, 1);
  assert.equal(saved.status, 'Document Hold');
  assert.equal(saved.sampling?.number, undefined);
  assert.equal(res.body.data.revision, 1);
});

test('only QC owner or admin may save; unassigned QC receipt is supported', async () => {
  const { record } = setup({ qcAssignedTo: new mongoose.Types.ObjectId() });
  assert.equal((await save(record)).statusCode, 403);
  assert.equal((await save(record, values(), { _id: owner, role: 'warehouse' })).statusCode, 403);
  assert.equal((await save(record, values(), { ...qc, role: 'admin' })).statusCode, 200);
});

test('report validates quantities, date, required conditions and stale revision', async () => {
  const { record } = setup();
  for (const invalid of [{ quantitySampled: 3 }, { quantityToBeSampled: 11 }, { quantitySampled: -1 }, { containersSampled: 4 }, { containersSampled: 1.5 }, { samplingDate: '2040-01-01' }, { samplingDate: '2000-01-01' }, { containerType: '' }]) {
    assert.equal((await save(record, { ...values(), ...invalid })).statusCode, 400, JSON.stringify(invalid));
  }
  assert.equal((await save(record, { ...values(), revision: 7 })).statusCode, 409);
  assert.equal(record.samplersReport, undefined);
});

test('report agrees with existing workflow sampling and preserves previous report on edit', async () => {
  const { record, reloaded } = setup({ sampling: { number: 'AR-001', quantity: 1, containers: 2, samplingDate: new Date(day) } });
  assert.equal((await save(record, { ...values(), arNumber: 'Wrong AR' })).statusCode, 409);
  assert.equal((await save(record)).statusCode, 200);
  assert.equal((await save(record, { ...values(), revision: 1, remarks: 'Corrected observations' })).statusCode, 200);
  assert.equal(reloaded().samplersReportHistory.length, 1);
  assert.equal(reloaded().samplersReportHistory[0].remarks, 'Collected from batch.');
  assert.equal(reloaded().samplersReport.remarks, 'Corrected observations');
});

test('missing receipt and conflicting save return clear errors', async () => {
  mock.method(WarehouseReceiving, 'findById', async () => null);
  assert.equal((await save({ _id: new mongoose.Types.ObjectId() })).statusCode, 404);
  mock.restoreAll();
  const { record } = setup();
  mock.method(record, 'save', async () => { throw Object.assign(new Error('Conflict'), { name: 'VersionError' }); });
  assert.equal((await save(record)).statusCode, 409);
});

test('QC record details include persisted samplers report', async () => {
  const { record } = setup(); await save(record);
  const query = { populate() { return this; }, then(resolve) { return Promise.resolve(record).then(resolve); } };
  mock.method(WarehouseReceiving, 'findById', () => query);
  const res = response(); await getMaterialReceivingById({ params: { id: record.id }, user: qc }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.record.samplersReport.arNumber, 'AR-001');
});

test('sampler signature is saved, preserved on omitted field, and removable explicitly', async () => {
  const { record, reloaded } = setup();
  const signatureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=';
  assert.equal((await save(record, { ...values(), signatureImage })).statusCode, 200);
  assert.equal(reloaded().samplersReport.signatureImage, signatureImage);
  assert.equal((await save(record, { ...values(), revision: 1 })).statusCode, 200);
  assert.equal(reloaded().samplersReport.signatureImage, signatureImage);
  assert.equal((await save(record, { ...values(), revision: 2, signatureImage: '' })).statusCode, 200);
  assert.equal(reloaded().samplersReport.signatureImage, '');
  assert.equal((await save(record, { ...values(), revision: 3, signatureImage: 'invalid' })).statusCode, 400);
});
