import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../Model/user.js';
import WarehouseReceiving from '../Model/wareHouse.js';
import Notification from '../Model/notification.js';
import { WorkflowRecord, WorkflowEvent, Location, Sequence } from '../Model/workflow.js';
import * as flow from '../Service/workflowService.js';
import { updateMaterialReceiving, deleteMaterialReceiving, updateDocumentCheck } from '../Controller/wareHouse.js';

test('complete material workflow with real MongoDB transactions and concurrency', { timeout: 240000 }, async (t) => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  t.after(async () => { await mongoose.disconnect(); await replica.stop(); });
  await mongoose.connect(replica.getUri(), { dbName: 'workflow_integration' });
  await Promise.all([User, WarehouseReceiving, Notification, WorkflowRecord, WorkflowEvent, Location, Sequence].map((model) => model.init()));
  // Initialize sequence documents before testing concurrent first writes.
  await Sequence.insertMany(['EVT-', 'A', 'MR-', 'DSP-', 'FG-', 'DIS-'].map((_id) => ({ _id, value: 0 })));
  const users = {};
  for (const role of ['warehouse', 'qc-test', 'production', 'admin']) users[role] = await User.create({ name: role, email: `${role}@example.test`, password: 'unused-test-hash', role, status: 'Active' });
  const wh = users.warehouse, qc = users['qc-test'], production = users.production, admin = users.admin;
  const location = await Location.create({ name: 'WH-A / Rack-01', createdBy: wh._id });
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const mfg = new Date(Date.now() - 365 * 86400000), expiry = new Date(Date.now() + 365 * 86400000);
  const requiredDocuments = Object.fromEntries(['coa', 'invoice', 'packingList', 'otherRequiredDocuments'].map((name) => [name, { fileName: `${name}.pdf`, fileUrl: `https://example.test/${name}.pdf` }]));
  const qcDocuments = ['Test Report (COA)', 'QC Result', 'Supporting Documents'].map((kind) => ({ kind, fileName: `${kind}.pdf`, fileUrl: 'https://example.test/report.pdf' }));
  let grn = 0;
  const createRaw = (quantity = 1000, documents = requiredDocuments) => WarehouseReceiving.create({ grnNumber: `MANUAL-${++grn}`, materialType: 'API', materialCode: 'API-001', materialName: 'Material A', supplierName: 'Supplier', poNumber: 'PO-1', invoiceNumber: 'INV-1', batchNo: `BATCH-${grn}`, manufacturer: 'Manufacturer', receivedQuantity: quantity, quantityUnit: 'Kg', containers: 10, manufacturingDate: mfg, expiryDate: expiry, receivingDate: yesterday, storageRequirement: 'Ambient', receivedBy: wh._id, qcAssignedTo: qc._id, documents });
  const tests = [{ testName: 'Identity', specification: 'Matches standard', requiredLimit: 'Match', actualResult: 'Match', testMethod: 'Validated method', result: 'Pass', testDate: today, remarks: 'Verified.' }];
  async function approveRaw(record) {
    await flow.recordSampling(record.id, qc, { quantity: 1, containers: 1, samplingDate: today, sampledBy: qc.id });
    await flow.recordTests(record.id, qc, { tests });
    await flow.attachDocuments('qc', record.id, qc, qcDocuments);
    return flow.qcDecision(record.id, qc, { status: 'Approved' });
  }

  const raw = await createRaw();
  await t.test('receiving remains blocked; notification opens Sampling; documents and roles are enforced', async () => {
    assert.equal(raw.status, 'Quarantine'); assert.equal(raw.availableQuantity, 0);
    await flow.notifySamplingRequired(raw);
    const notification = await Notification.findOne({ materialReceiving: raw._id });
    assert.equal(notification.targetPage, 'Sampling'); assert.equal(String(notification.recipient), qc.id);
    await assert.rejects(flow.recordSampling(raw.id, production, { quantity: 1 }), { statusCode: 403 });
    const blocked = await createRaw(10, {});
    await assert.rejects(flow.recordSampling(blocked.id, qc, { quantity: 1, containers: 1, samplingDate: today, sampledBy: qc.id }), { statusCode: 409 });
    await assert.rejects(flow.acceptRawMaterial(raw.id, wh, { verified: true, location: location.name }), { statusCode: 409 });
  });
  await t.test('sampling and test documents gate approval and preserve analyst identity', async () => {
    let result = await flow.recordSampling(raw.id, qc, { quantity: 1, containers: 1, samplingDate: today, sampledBy: qc.id });
    assert.equal(result.status, 'Under Test'); assert.match(result.sampling.number, /^A\d+$/);
    await assert.rejects(flow.recordSampling(raw.id, qc, { quantity: 1 }), { statusCode: 409 });
    await flow.recordTests(raw.id, qc, { tests });
    await assert.rejects(flow.qcDecision(raw.id, qc, { status: 'Approved' }), { statusCode: 409 });
    await flow.attachDocuments('qc', raw.id, qc, qcDocuments);
    result = await flow.qcDecision(raw.id, qc, { status: 'Approved' });
    assert.equal(result.availableQuantity, 0); assert.equal(String(result.qc.tests[0].analyst), qc.id);
    assert.ok(await Notification.exists({ targetRole: 'warehouse', materialReceiving: raw._id }));
    await assert.rejects(flow.recordTests(raw.id, qc, { tests }), { statusCode: 409 });
  });
  await t.test('warehouse acceptance needs a location and cannot double-credit stock', async () => {
    await assert.rejects(flow.acceptRawMaterial(raw.id, qc, { verified: true, location: location.name }), { statusCode: 403 });
    await assert.rejects(flow.acceptRawMaterial(raw.id, wh, { verified: true, location: 'Unknown' }), { statusCode: 400 });
    const result = await flow.acceptRawMaterial(raw.id, wh, { verified: true, location: location.name });
    assert.equal(result.availableQuantity, 1000); assert.equal(result.status, 'Available');
    assert.ok(await Notification.exists({ recipient: production._id, materialReceiving: raw._id, targetPage: 'Available Materials' }));
    await assert.rejects(flow.acceptRawMaterial(raw.id, wh, { verified: true, location: location.name }), { statusCode: 409 });
  });

  const request = await flow.createRequisition(production, { materialCode: 'API-001', quantityUnit: 'Kg', quantity: 250, productionOrder: 'PROD-001' });
  let issued;
  await t.test('requests do not deduct stock; confirmed dispensing deducts exactly once', async () => {
    assert.equal((await WarehouseReceiving.findById(raw.id)).availableQuantity, 1000);
    issued = await flow.dispense(request.id, wh, { receiptId: raw.id, quantity: 250, verified: true });
    assert.equal(issued.status, 'Sent to Production'); assert.match(issued.issues[0].number, /^DSP-/);
    assert.equal((await WarehouseReceiving.findById(raw.id)).availableQuantity, 750);
    await assert.rejects(flow.dispense(request.id, wh, { receiptId: raw.id, quantity: 250, verified: true }), { statusCode: 409 });
  });
  await t.test('production discrepancies do not alter warehouse stock and require resolution', async () => {
    await assert.rejects(flow.receiveProduction(request.id, production, { issueId: issued.issues[0].id, decision: 'Accept', actualQuantity: 240, verified: true }), { statusCode: 400 });
    const discrepant = await flow.receiveProduction(request.id, production, { issueId: issued.issues[0].id, decision: 'Discrepancy', actualQuantity: 240, reason: 'Ten kg short', verified: true });
    assert.equal(discrepant.issues[0].differenceQuantity, -10); assert.equal(discrepant.status, 'Discrepancy');
    assert.equal((await WarehouseReceiving.findById(raw.id)).availableQuantity, 750);
    assert.ok(await Notification.exists({ recipient: wh._id, workflowRecord: request._id, targetPage: 'Requisitions (Pending)' }));
    const resolved = await flow.resolveDiscrepancy(request.id, wh, { issueId: issued.issues[0].id, reason: 'Weighing discrepancy investigated and accepted by production.' });
    assert.equal(resolved.status, 'Completed'); assert.equal((await WarehouseReceiving.findById(raw.id)).availableQuantity, 750);
    assert.ok(resolved.issues[0].reason); assert.ok(resolved.issues[0].resolution);
  });

  const fg = await flow.createFgHandover(production, { materialCode: 'FG-001', materialName: 'Finished A', batchNo: 'FG-BATCH-01', quantity: 5000, quantityUnit: 'Nos', manufacturingDate: today, expiryDate: expiry, sourceRequisitions: [request.id] });
  await t.test('FG requires documents and physical acceptance before becoming stock', async () => {
    assert.equal(fg.availableQuantity, 0);
    await assert.rejects(flow.submitFg(fg.id, production), { statusCode: 409 });
    await flow.attachDocuments('fg', fg.id, production, [{ kind: 'FG Documents', fileName: 'FG.pdf', fileUrl: 'https://example.test/FG.pdf' }]);
    await flow.submitFg(fg.id, production);
    assert.equal((await WorkflowRecord.findById(fg.id)).availableQuantity, 0);
    assert.ok(await Notification.exists({ recipient: wh._id, workflowRecord: fg._id, targetPage: 'FG Receiving' }));
    await assert.rejects(flow.acceptFg(fg.id, production, { decision: 'Accept', quantity: 5000, location: location.name, verified: true }), { statusCode: 403 });
    const discrepancy = await flow.acceptFg(fg.id, wh, { decision: 'Discrepancy', reason: 'Packing requires inspection', verified: true });
    assert.equal(discrepancy.status, 'Discrepancy');
    assert.equal(discrepancy.availableQuantity, 0);
    assert.ok(await Notification.exists({ recipient: production._id, workflowRecord: fg._id, title: 'FG handover discrepancy' }));
    await assert.rejects(flow.acceptFg(fg.id, wh, { decision: 'Accept', quantity: 5000, location: location.name, verified: true }), { statusCode: 400 });
    const accepted = await flow.acceptFg(fg.id, wh, { decision: 'Accept', quantity: 5000, location: location.name, verified: true, remarks: 'Packing inspected and discrepancy resolved.' });
    assert.equal(accepted.availableQuantity, 5000); assert.equal(accepted.status, 'Available');
    await assert.rejects(flow.acceptFg(fg.id, wh, { decision: 'Accept', quantity: 5000, location: location.name, verified: true }), { statusCode: 409 });
  });
  await t.test('dispatch request does not deduct; confirmation deducts once and records customer', async () => {
    const dispatch = await flow.createDispatch(wh, { fgReceipt: fg.id, quantity: 1000, customer: 'Customer A', salesOrder: 'SO-01', destination: 'Delhi', dispatchDate: today });
    assert.equal((await WorkflowRecord.findById(fg.id)).availableQuantity, 5000);
    assert.ok(await Notification.exists({ recipient: wh._id, workflowRecord: dispatch._id, targetPage: 'FG Dispatch' }));
    await assert.rejects(flow.confirmDispatch(dispatch.id, production, { verified: true }), { statusCode: 403 });
    await assert.rejects(flow.confirmDispatch(dispatch.id, wh, { verified: false }), { statusCode: 400 });
    const result = await flow.confirmDispatch(dispatch.id, wh, { verified: true });
    assert.equal(result.status, 'Dispatched'); assert.equal((await WorkflowRecord.findById(fg.id)).availableQuantity, 4000);
    await assert.rejects(flow.confirmDispatch(dispatch.id, wh, { verified: true }), { statusCode: 409 });
    assert.ok(await WorkflowEvent.exists({ entity: fg._id, 'details.customer': 'Customer A' }));
  });

  await t.test('insufficient FG stock prevents dispatch without changing inventory', async () => {
    const dispatch = await flow.createDispatch(wh, { fgReceipt: fg.id, quantity: 4001, customer: 'Customer B', salesOrder: 'SO-02', destination: 'Mumbai', dispatchDate: today });
    await assert.rejects(flow.confirmDispatch(dispatch.id, wh, { verified: true }), { statusCode: 409 });
    assert.equal((await WorkflowRecord.findById(fg.id)).availableQuantity, 4000);
    assert.equal((await WorkflowRecord.findById(dispatch.id)).status, 'Pending');
    assert.equal(await WorkflowEvent.countDocuments({ entity: dispatch._id, action: 'Dispatch confirmed' }), 0);
  });

  await t.test('only admin can edit pending dispatch quantity without changing FG inventory', async () => {
    const dispatch = await flow.createDispatch(wh, { fgReceipt: fg.id, quantity: 4001, customer: 'Edit customer', salesOrder: 'SO-EDIT', destination: 'Delhi', dispatchDate: today });
    const values = { previousQuantity: 4001, quantity: 50, reason: 'Correct requested quantity' };
    for (const user of [wh, production, qc]) await assert.rejects(flow.editDispatchQuantity(dispatch.id, user, values), { statusCode: 403 });
    for (const quantity of [0, -1, true, 'invalid', 0.0000001]) await assert.rejects(flow.editDispatchQuantity(dispatch.id, admin, { ...values, quantity }), { statusCode: 400 });
    await assert.rejects(flow.editDispatchQuantity(dispatch.id, admin, { ...values, reason: '' }), { statusCode: 400 });
    await assert.rejects(flow.editDispatchQuantity(dispatch.id, admin, { ...values, previousQuantity: 4000 }), { statusCode: 409 });
    const updated = await flow.editDispatchQuantity(dispatch.id, admin, values);
    assert.equal(updated.quantity, 50);
    assert.equal(updated.number, dispatch.number);
    assert.equal(updated.status, 'Pending');
    assert.equal((await WorkflowRecord.findById(fg.id)).availableQuantity, 4000);
    assert.ok(await WorkflowEvent.exists({ entity: dispatch._id, actor: admin._id, action: 'Dispatch quantity updated', 'details.previousQuantity': 4001, 'details.quantity': 50, note: values.reason }));
    assert.ok(await Notification.exists({ recipient: wh._id, workflowRecord: dispatch._id, title: 'FG dispatch quantity updated' }));
    await assert.rejects(flow.editDispatchQuantity(dispatch.id, admin, values), { statusCode: 409 });
    // Set up a closed request to check immutability without changing fixture stock.
    await WorkflowRecord.updateOne({ _id: dispatch._id }, { $set: { status: 'Dispatched' } });
    await assert.rejects(flow.editDispatchQuantity(dispatch.id, admin, { ...values, previousQuantity: 50, quantity: 49 }), { statusCode: 409 });
  });

  await t.test('concurrent dispensing prevents overselling and rolls back losing transaction', async () => {
    const stock = await createRaw(100); await approveRaw(stock); await flow.acceptRawMaterial(stock.id, wh, { verified: true, location: location.name });
    const first = await flow.createRequisition(production, { materialCode: stock.materialCode, quantityUnit: 'Kg', quantity: 80, productionOrder: 'P-CONCURRENT-1' });
    const second = await flow.createRequisition(production, { materialCode: stock.materialCode, quantityUnit: 'Kg', quantity: 80, productionOrder: 'P-CONCURRENT-2' });
    const results = await Promise.allSettled([first, second].map((record) => flow.dispense(record.id, wh, { receiptId: stock.id, quantity: 80, verified: true })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await WarehouseReceiving.findById(stock.id)).availableQuantity, 20);
    const requests = await WorkflowRecord.find({ _id: { $in: [first._id, second._id] } });
    assert.equal(requests.reduce((sum, record) => sum + record.issues.length, 0), 1);
  });
  await t.test('QC Hold/Rejected and expired stock stay blocked', async () => {
    const stock = await createRaw(10);
    await flow.qcDecision(stock.id, qc, { status: 'Hold', note: 'Investigation' });
    await assert.rejects(flow.acceptRawMaterial(stock.id, wh, { verified: true, location: location.name }), { statusCode: 409 });
    await flow.recordSampling(stock.id, qc, { quantity: 1, containers: 1, samplingDate: today, sampledBy: qc.id });
    await flow.recordTests(stock.id, qc, { tests: [{ ...tests[0], result: 'Fail', actualResult: 'Mismatch' }] });
    await assert.rejects(flow.qcDecision(stock.id, qc, { status: 'Approved' }), { statusCode: 409 });
    await flow.qcDecision(stock.id, qc, { status: 'Rejected', note: 'Identity failed' });
    await assert.rejects(flow.acceptRawMaterial(stock.id, wh, { verified: true, location: location.name }), { statusCode: 409 });
    await WarehouseReceiving.updateOne({ _id: raw._id }, { $set: { expiryDate: yesterday } });
    const pending = await flow.createRequisition(production, { materialCode: raw.materialCode, quantityUnit: 'Kg', quantity: 1, productionOrder: 'EXPIRED' });
    await assert.rejects(flow.dispense(pending.id, wh, { receiptId: raw.id, quantity: 1, verified: true }), { statusCode: 409 });
  });
  await t.test('completed records are immutable and adjustments require admin plus audit reason', async () => {
    const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const deleted = res(); await deleteMaterialReceiving({ user: wh, params: { id: raw.id } }, deleted); assert.equal(deleted.code, 409);
    const edited = res(); await updateMaterialReceiving({ user: wh, params: { id: raw.id }, body: { receivedQuantity: 2000 } }, edited); assert.equal(edited.code, 409);
    const docs = res(); await updateDocumentCheck({ user: wh, params: { id: raw.id }, body: { documents: requiredDocuments } }, docs); assert.equal(docs.code, 409);
    await assert.rejects(flow.adjustStock('fg', fg.id, wh, { quantity: -1, reason: 'Damage' }), { statusCode: 403 });
    const adjusted = await flow.adjustStock('fg', fg.id, admin, { quantity: -10, reason: 'Damage report ADJ-01' });
    assert.equal(adjusted.availableQuantity, 3990);
    assert.ok(await WorkflowEvent.exists({ entity: fg._id, action: 'Authorized stock adjustment', actor: admin._id }));
    assert.equal(await WorkflowEvent.countDocuments({ actor: { $exists: false } }), 0);
  });
});
