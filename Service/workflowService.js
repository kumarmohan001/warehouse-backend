import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';
import Notification from '../Model/notification.js';
import { WorkflowRecord, WorkflowEvent, Sequence, Location } from '../Model/workflow.js';
import { emitNotification } from './socketService.js';
import { fail, allow, textValue, positive, amount, validDate, unexpired, requireState, requireQc, checkDecision, requisitionStatus } from './workflowRules.js';

export async function nextNumber(prefix, session) {
  const sequence = await Sequence.findOneAndUpdate({ _id: prefix }, { $inc: { value: 1 } }, { new: true, upsert: true, session });
  return `${prefix}${String(sequence.value).padStart(prefix === 'A' ? 4 : 6, '0')}`;
}

async function event(record, action, user, session, details = {}) {
  await WorkflowEvent.create([{
    number: await nextNumber('EVT-', session), entity: record._id, entityType: record.grnNumber ? 'receipt' : record.kind,
    reference: record.grnNumber || record.number, action, actor: user._id, details,
    quantity: details.quantity, unit: record.quantityUnit, note: details.note,
  }], { session });
}

async function notify(record, title, message, roles, page, session, recipients = []) {
  const users = recipients.length ? recipients : (await User.find({ role: { $in: [...roles, 'admin'] }, status: 'Active' }).select('_id').session(session)).map((user) => user._id);
  const ids = [...new Set(users.map(String))];
  if (!ids.length) return [];
  return Notification.create(ids.map((recipient) => ({ recipient, title, message,
    materialReceiving: record.grnNumber ? record._id : undefined, workflowRecord: record.grnNumber ? undefined : record._id,
    targetPage: page, targetRole: roles[0],
  })), { session, ordered: true });
}

// Stock, transaction, audit and durable notifications commit together. Socket events follow commit.
export async function transact(work) {
  let notifications = [];
  const result = await mongoose.connection.transaction(async (session) => {
    notifications = [];
    return work(session, notifications);
  });
  for (const notification of notifications) emitNotification(notification.toObject());
  return result;
}

async function receipt(id, session) {
  if (!mongoose.isValidObjectId(id)) fail(400, 'Invalid receipt ID.');
  const record = await WarehouseReceiving.findById(id).session(session);
  if (!record) fail(404, 'Receipt not found.');
  return record;
}
async function workflow(id, kind, session) {
  if (!mongoose.isValidObjectId(id)) fail(400, 'Invalid transaction ID.');
  const record = await WorkflowRecord.findOne({ _id: id, kind }).session(session);
  if (!record) fail(404, 'Transaction not found.');
  return record;
}
async function locationName(value, session) {
  const name = textValue(value, 'Storage location');
  if (!await Location.exists({ name }).session(session)) fail(400, 'Select an existing storage location.');
  return name;
}
function history(record, status, user, note) {
  record.statusHistory.push({ from: record.status, to: status, changedBy: user._id, note });
  record.status = status;
}
function ownRecord(record, user) {
  if (user.role !== 'admin' && String(record.createdBy) !== String(user._id)) fail(403, 'This transaction belongs to another production user.');
}
function confirmed(value) { if (value !== true) fail(400, 'Confirm physical verification before continuing.'); }

export async function recordSampling(id, user, values) {
  return transact(async (session) => {
    const record = await receipt(id, session);
    requireQc(record, user); requireState(record, ['Quarantine', 'Hold']);
    if (record.documentStatus !== 'Documents OK') fail(409, 'Complete receiving documents before sampling.');
    if (record.sampling?.number) fail(409, 'Sampling is already recorded for this batch.');
    const quantity = positive(values.quantity, 'Sample quantity');
    const containers = positive(values.containers, 'Containers sampled');
    if (quantity > record.receivedQuantity || !Number.isInteger(containers) || containers > record.containers) fail(400, 'Sample quantity and containers cannot exceed the received batch.');
    const samplingDate = validDate(values.samplingDate, 'Sampling date');
    if (samplingDate > new Date() || samplingDate < new Date(new Date(record.receivingDate).setHours(0, 0, 0, 0))) fail(400, 'Sampling date must be between receiving date and today.');
    if (!mongoose.isValidObjectId(values.sampledBy) || !await User.exists({ _id: values.sampledBy, status: 'Active', role: { $in: ['qc-test', 'admin'] } }).session(session)) fail(400, 'Select an active QC sampler.');
    record.sampling = { number: await nextNumber('A', session), quantity, containers, samplingDate, sampledBy: values.sampledBy,
      remarks: textValue(values.remarks, 'Sampling remarks', false), recordedBy: user._id, recordedAt: new Date() };
    if (!record.qcAssignedTo) record.qcAssignedTo = user._id;
    history(record, 'Under Test', user, 'Sample collected; batch blocked pending QC.');
    await record.save({ session });
    await event(record, 'Sampling recorded', user, session, { quantity, sampleNumber: record.sampling.number });
    return record;
  });
}

export async function recordTests(id, user, values) {
  return transact(async (session) => {
    const record = await receipt(id, session);
    requireQc(record, user); requireState(record, ['Under Test', 'Hold']);
    if (!record.sampling?.number) fail(409, 'Record sampling first.');
    if (!Array.isArray(values.tests) || !values.tests.length || values.tests.length > 100) fail(400, 'Provide between 1 and 100 test results.');
    const tests = values.tests.map((test) => {
      const remarks = textValue(test.remarks, 'Remarks', false, 10000);
      if (remarks.split(/\s+/).filter(Boolean).length > 250) fail(400, 'Test remarks must not exceed 250 words.');
      if (!['Pass', 'Fail'].includes(test.result)) fail(400, 'Each test must have a Pass or Fail result.');
      const testDate = validDate(test.testDate, 'Test date');
      if (testDate > new Date() || testDate < record.sampling.samplingDate) fail(400, 'Test date must be between sampling date and today.');
      return { testName: textValue(test.testName, 'Test name'), specification: textValue(test.specification, 'Specification'),
        requiredLimit: textValue(test.requiredLimit, 'Required limit'), actualResult: textValue(test.actualResult, 'Actual result'),
        testMethod: textValue(test.testMethod, 'Test method'), result: test.result, analyst: user._id, testDate, remarks, recordedAt: new Date() };
    });
    const previous = record.qc.tests.map((test) => test.toObject());
    record.qc.tests = tests;
    await record.save({ session });
    await event(record, 'QC test results saved', user, session, { previous, tests });
    return record;
  });
}

export async function qcDecision(id, user, values) {
  return transact(async (session, notifications) => {
    const record = await receipt(id, session);
    requireQc(record, user); requireState(record, ['Quarantine', 'Under Test', 'Hold']);
    const note = textValue(values.note, 'Decision remarks', false);
    checkDecision(record, values.status, note);
    record.qc.decision = values.status; record.qc.decisionBy = user._id; record.qc.decisionAt = new Date(); record.qc.decisionRemarks = note;
    history(record, values.status, user, note);
    await record.save({ session });
    await event(record, `QC ${values.status}`, user, session, { note });
    const instruction = values.status === 'Approved' ? 'Ready for warehouse verification.' : values.status === 'Rejected' ? 'Reject material. Stock remains blocked.' : 'Investigation required. Stock remains blocked.';
    notifications.push(...await notify(record, `QC ${values.status}: ${record.grnNumber}`, `${record.materialName}, batch ${record.batchNo}: ${values.status}. ${instruction} ${note}`, ['warehouse'], values.status === 'Approved' ? 'QC Approved Queue' : 'Warehouse Stock', session));
    return record;
  });
}

export async function acceptRawMaterial(id, user, values) {
  allow(user, ['warehouse']); confirmed(values.verified);
  return transact(async (session, notifications) => {
    const record = await receipt(id, session);
    requireState(record, ['Approved']); unexpired(record.expiryDate);
    if (record.qc?.decision !== 'Approved' || !record.sampling?.number) fail(409, 'Complete the QC workflow before warehouse acceptance.');
    checkDecision(record, 'Approved', '');
    const location = await locationName(values.location, session);
    record.verification = { acceptedBy: user._id, acceptedAt: new Date(), location, remarks: textValue(values.remarks, 'Verification remarks', false) };
    record.availableQuantity = record.receivedQuantity;
    history(record, 'Available', user, `Physically verified and accepted at ${location}.`);
    await record.save({ session });
    await event(record, 'Raw stock accepted', user, session, { quantity: record.receivedQuantity, location });
    notifications.push(...await notify(record, 'Raw material available for requisition', `${record.materialName} (${record.materialCode}), batch ${record.batchNo}: ${record.receivedQuantity} ${record.quantityUnit} accepted at ${location}. Create a requisition to request material.`, ['production'], 'Available Materials', session));
    return record;
  });
}

export async function createRequisition(user, values) {
  allow(user, ['production']);
  return transact(async (session, notifications) => {
    const materialCode = textValue(values.materialCode, 'Material code').toUpperCase();
    const material = await WarehouseReceiving.findOne({ materialCode }).session(session);
    if (!material) fail(400, 'Select a material recorded in receiving.');
    const quantityUnit = textValue(values.quantityUnit, 'Quantity unit');
    if (!await WarehouseReceiving.exists({ materialCode, quantityUnit }).session(session)) fail(400, 'Select the material quantity unit shown in inventory.');
    const [record] = await WorkflowRecord.create([{ kind: 'requisition', number: await nextNumber('MR-', session),
      materialCode, materialName: material.materialName, quantityUnit, quantity: positive(values.quantity, 'Required quantity'),
      productionOrder: textValue(values.productionOrder, 'Production order / batch'), remarks: textValue(values.remarks, 'Remarks', false),
      status: 'Pending', createdBy: user._id }], { session });
    await event(record, 'Production requisition created', user, session, { quantity: record.quantity });
    notifications.push(...await notify(record, 'Production material requested', `${record.number}: ${record.quantity} ${record.quantityUnit} ${record.materialName}`, ['warehouse'], 'Requisitions (Pending)', session));
    return record;
  });
}

export async function dispense(id, user, values) {
  allow(user, ['warehouse']); confirmed(values.verified);
  return transact(async (session, notifications) => {
    const record = await workflow(id, 'requisition', session);
    requireState(record, ['Pending', 'Partially Dispensed']);
    const stock = await receipt(values.receiptId, session);
    requireState(stock, ['Available']); unexpired(stock.expiryDate);
    if (!stock.verification?.acceptedAt || stock.qc?.decision !== 'Approved') fail(409, 'Only warehouse accepted, QC approved stock may be dispensed.');
    if (stock.materialCode !== record.materialCode || stock.quantityUnit !== record.quantityUnit) fail(400, 'Batch material and unit must match the requisition.');
    const quantity = positive(values.quantity, 'Dispensing quantity');
    const remaining = amount(record.quantity - record.issues.reduce((sum, item) => sum + item.quantity, 0));
    if (quantity > remaining || quantity > stock.availableQuantity) fail(409, 'Dispensing quantity exceeds the remaining request or available stock.');
    stock.availableQuantity = amount(stock.availableQuantity - quantity);
    await stock.save({ session });
    const number = await nextNumber('DSP-', session);
    record.issues.push({ number, receipt: stock._id, batchNo: stock.batchNo, location: stock.verification.location, quantity,
      dispensedBy: user._id, dispensedAt: new Date(), status: 'Sent to Production' });
    record.status = requisitionStatus(record);
    await record.save({ session });
    await event(stock, 'Material dispensed', user, session, { quantity: -quantity, requisition: record._id, dispensingNumber: number, balance: stock.availableQuantity });
    await event(record, 'Sent to production', user, session, { quantity, receipt: stock._id, dispensingNumber: number });
    notifications.push(...await notify(record, 'Material dispatched to production', `${number}: ${quantity} ${record.quantityUnit} ${record.materialName} against ${record.number}.`, ['production'], 'Receive Material', session, [record.createdBy]));
    return record;
  });
}

export async function receiveProduction(id, user, values) {
  allow(user, ['production']); confirmed(values.verified);
  return transact(async (session, notifications) => {
    const record = await workflow(id, 'requisition', session); ownRecord(record, user);
    const issue = record.issues.id(values.issueId);
    if (!issue || issue.status !== 'Sent to Production') fail(409, 'Select a dispensing awaiting production receipt.');
    if (!['Accept', 'Discrepancy'].includes(values.decision)) fail(400, 'Select Accept or Discrepancy.');
    const actual = Number(values.actualQuantity);
    if (values.actualQuantity === '' || values.actualQuantity === undefined || !Number.isFinite(actual) || actual < 0) fail(400, 'Actual received quantity must be zero or greater.');
    if (values.decision === 'Accept' && amount(actual) !== issue.quantity) fail(400, 'Record a discrepancy when received quantity differs from dispensed quantity.');
    issue.actualQuantity = amount(actual); issue.differenceQuantity = amount(actual - issue.quantity);
    issue.reason = textValue(values.reason, 'Discrepancy reason', values.decision === 'Discrepancy');
    issue.remarks = textValue(values.remarks, 'Remarks', false); issue.receivedBy = user._id; issue.receivedAt = new Date();
    issue.status = values.decision === 'Accept' ? 'Completed' : 'Discrepancy';
    record.status = requisitionStatus(record); await record.save({ session });
    await event(record, `Production ${issue.status}`, user, session, { dispensingNumber: issue.number, actualQuantity: actual, difference: issue.differenceQuantity, note: issue.reason });
    if (issue.status === 'Discrepancy') notifications.push(...await notify(record, 'Production receipt discrepancy', `${record.number} / ${issue.number}: ${issue.reason}`, ['warehouse'], 'Requisitions (Pending)', session));
    return record;
  });
}

export async function resolveDiscrepancy(id, user, values) {
  allow(user, ['warehouse']);
  return transact(async (session, notifications) => {
    const record = await workflow(id, 'requisition', session);
    const issue = record.issues.id(values.issueId);
    if (!issue || issue.status !== 'Discrepancy') fail(409, 'Select an unresolved discrepancy.');
    issue.resolution = textValue(values.reason, 'Resolution and corrective action'); issue.resolvedBy = user._id; issue.resolvedAt = new Date(); issue.status = 'Completed';
    record.status = requisitionStatus(record); await record.save({ session });
    await event(record, 'Discrepancy resolved', user, session, { dispensingNumber: issue.number, note: issue.resolution });
    notifications.push(...await notify(record, 'Discrepancy resolved', `${record.number}: ${issue.resolution}`, ['production'], 'Requisition Status', session, [record.createdBy]));
    return record;
  });
}

export async function createFgHandover(user, values) {
  allow(user, ['production']);
  return transact(async (session, notifications) => {
    const sourceIds = values.sourceRequisitions;
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some((id) => !mongoose.isValidObjectId(id))) fail(400, 'Select the completed production requisitions used for this FG batch.');
    for (const id of [...new Set(sourceIds)]) { const source = await workflow(id, 'requisition', session); ownRecord(source, user); requireState(source, ['Completed']); }
    const manufacturingDate = validDate(values.manufacturingDate, 'Manufacturing date');
    const expiryDate = validDate(values.expiryDate, 'Expiry date');
    if (expiryDate <= manufacturingDate || manufacturingDate > new Date()) fail(400, 'Use a valid manufacturing date and a later expiry date.');
    const [record] = await WorkflowRecord.create([{ kind: 'fg', number: await nextNumber('FG-', session),
      materialCode: textValue(values.materialCode, 'FG code').toUpperCase(), materialName: textValue(values.materialName, 'FG name'),
      batchNo: textValue(values.batchNo, 'FG batch'), quantity: positive(values.quantity, 'Manufactured quantity'),
      quantityUnit: textValue(values.quantityUnit, 'Quantity unit'), manufacturingDate, expiryDate, sourceRequisitions: [...new Set(sourceIds)],
      remarks: textValue(values.remarks, 'Remarks', false), status: 'Pending Documents', createdBy: user._id }], { session });
    await event(record, 'FG handover drafted', user, session, { sourceRequisitions: sourceIds });
    // Notification follows document upload and explicit submission.
    return record;
  });
}

export async function submitFg(id, user) {
  allow(user, ['production']);
  return transact(async (session, notifications) => {
    const record = await workflow(id, 'fg', session); ownRecord(record, user); requireState(record, ['Pending Documents']);
    if (!record.documents.length) fail(409, 'Upload the required FG documents before submitting.');
    record.status = 'Pending Verification'; await record.save({ session });
    await event(record, 'FG handover submitted', user, session);
    notifications.push(...await notify(record, 'Finished goods ready for handover', `${record.number}: ${record.materialName}, batch ${record.batchNo}.`, ['warehouse'], 'FG Receiving', session));
    return record;
  });
}

export async function acceptFg(id, user, values) {
  allow(user, ['warehouse']); confirmed(values.verified);
  return transact(async (session, notifications) => {
    const record = await workflow(id, 'fg', session); requireState(record, ['Pending Verification', 'Discrepancy']); unexpired(record.expiryDate);
    if (values.decision === 'Discrepancy') {
      record.discrepancyReason = textValue(values.reason, 'Discrepancy reason'); record.status = 'Discrepancy';
      await record.save({ session }); await event(record, 'FG discrepancy recorded', user, session, { note: record.discrepancyReason });
      notifications.push(...await notify(record, 'FG handover discrepancy', `${record.number}: ${record.discrepancyReason}`, ['production'], 'FG Handover', session, [record.createdBy]));
      return record;
    }
    if (values.decision !== 'Accept') fail(400, 'Select Accept or Discrepancy.');
    if (!record.documents.length) fail(409, 'FG documents are required.');
    const accepted = positive(values.quantity, 'Accepted quantity');
    if (accepted > record.quantity) fail(400, 'Accepted quantity cannot exceed manufactured quantity.');
    const remarks = textValue(values.remarks, 'Verification / discrepancy resolution', accepted !== record.quantity || record.status === 'Discrepancy');
    record.location = await locationName(values.location, session); record.acceptedQuantity = accepted; record.availableQuantity = accepted;
    record.verificationRemarks = remarks; record.verifiedBy = user._id; record.verifiedAt = new Date(); record.status = 'Available';
    await record.save({ session }); await event(record, 'FG accepted into stock', user, session, { quantity: accepted, manufacturedQuantity: record.quantity, note: remarks, location: record.location });
    notifications.push(...await notify(record, 'FG accepted by warehouse', `${record.number}: ${accepted} ${record.quantityUnit} accepted.`, ['production'], 'FG Handover', session, [record.createdBy]));
    return record;
  });
}

export async function createDispatch(user, values) {
  allow(user, ['warehouse']);
  return transact(async (session, notifications) => {
    const stock = await workflow(values.fgReceipt, 'fg', session); requireState(stock, ['Available']); unexpired(stock.expiryDate);
    const [record] = await WorkflowRecord.create([{ kind: 'dispatch', number: await nextNumber('DIS-', session),
      materialCode: stock.materialCode, materialName: stock.materialName, batchNo: stock.batchNo, quantityUnit: stock.quantityUnit,
      fgReceipt: stock._id, quantity: positive(values.quantity, 'Dispatch quantity'), customer: textValue(values.customer, 'Customer'),
      salesOrder: textValue(values.salesOrder, 'Sales order / invoice'), destination: textValue(values.destination, 'Destination'),
      dispatchDate: validDate(values.dispatchDate, 'Dispatch date'), remarks: textValue(values.remarks, 'Remarks', false), status: 'Pending', createdBy: user._id }], { session });
    await event(record, 'Dispatch requested', user, session, { quantity: record.quantity });
    notifications.push(...await notify(record, 'FG dispatch requested', `${record.number}: ${record.materialName} for ${record.customer}.`, ['warehouse'], 'FG Dispatch', session));
    return record;
  });
}

export async function confirmDispatch(id, user, values) {
  allow(user, ['warehouse']); confirmed(values.verified);
  return transact(async (session) => {
    const record = await workflow(id, 'dispatch', session); requireState(record, ['Pending']);
    const stock = await workflow(record.fgReceipt, 'fg', session); requireState(stock, ['Available']); unexpired(stock.expiryDate);
    if (record.quantity > stock.availableQuantity) fail(409, 'Insufficient finished goods stock.');
    stock.availableQuantity = amount(stock.availableQuantity - record.quantity); await stock.save({ session });
    record.status = 'Dispatched'; record.dispatchedBy = user._id; record.dispatchedAt = new Date(); await record.save({ session });
    await event(stock, 'FG dispatched', user, session, { quantity: -record.quantity, dispatch: record._id, customer: record.customer, balance: stock.availableQuantity });
    await event(record, 'Dispatch confirmed', user, session, { quantity: record.quantity, fgReceipt: stock._id });
    return record;
  });
}

export async function adjustStock(kind, id, user, values) {
  allow(user, []);
  return transact(async (session) => {
    const record = kind === 'raw' ? await receipt(id, session) : await workflow(id, 'fg', session);
    requireState(record, ['Available']);
    const quantity = Number(values.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) fail(400, 'Enter a non-zero adjustment quantity.');
    const note = textValue(values.reason, 'Adjustment reason and source reference');
    const balance = amount(record.availableQuantity + quantity);
    const original = record.grnNumber ? record.receivedQuantity : record.acceptedQuantity;
    if (balance < 0 || balance > original) fail(409, 'Adjusted balance must be between zero and the originally accepted quantity.');
    record.availableQuantity = balance; await record.save({ session });
    await event(record, 'Authorized stock adjustment', user, session, { quantity, balance, note });
    return record;
  });
}

export async function attachDocuments(kind, id, user, documents) {
  return transact(async (session) => {
    const record = kind === 'qc' ? await receipt(id, session) : await workflow(id, 'fg', session);
    if (kind === 'qc') { requireQc(record, user); requireState(record, ['Under Test', 'Hold']); if (!record.sampling?.number) fail(409, 'Record sampling first.'); }
    else { allow(user, ['production']); ownRecord(record, user); requireState(record, ['Pending Documents', 'Discrepancy']); }
    const target = kind === 'qc' ? record.qc.documents : record.documents;
    target.push(...documents.map((document) => ({ ...document, uploadedBy: user._id, uploadedAt: new Date() })));
    await record.save({ session });
    await event(record, 'Documents attached', user, session, { files: documents.map(({ kind, fileName }) => ({ kind, fileName })) });
    return record;
  });
}

export async function notifySamplingRequired(record) {
  if (record.status !== 'Quarantine') return;
  const notifications = await notify(record, 'New material received. Sampling required.', `${record.grnNumber}: ${record.materialName}, batch ${record.batchNo}. Open Sampling Details to collect a sample.`, ['qc-test'], 'Sampling', null, record.qcAssignedTo ? [record.qcAssignedTo] : []);
  for (const notification of notifications) emitNotification(notification.toObject());
}

export async function initializeWorkflow() {
  for (const model of [WarehouseReceiving, WorkflowRecord, WorkflowEvent, Sequence, Location, Notification]) await model.init();
  for (const prefix of ['EVT-', 'A', 'MR-', 'DSP-', 'FG-', 'DIS-']) await Sequence.updateOne({ _id: prefix }, { $setOnInsert: { value: 0 } }, { upsert: true });
}
