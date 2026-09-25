import mongoose from 'mongoose';
import { documentCategories } from '../Service/documentCategories.js';
import { unlink } from 'node:fs/promises';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';
import { WorkflowRecord, WorkflowEvent, Location } from '../Model/workflow.js';
import * as service from '../Service/workflowService.js';
import { allow, fail, textValue } from '../Service/workflowRules.js';
import { uploadWarehouseDocument, deleteWarehouseDocument } from '../Service/cloudinaryService.js';

export const endpoint = (work) => async (req, res) => {
  try { return res.json({ success: true, data: await work(req) }); }
  catch (error) {
    if (error.code === 11000 || error.name === 'VersionError') return res.status(409).json({ success: false, message: 'The record changed or the reference already exists. Refresh and try again.' });
    if (error.name === 'CastError' || error.name === 'ValidationError') return res.status(400).json({ success: false, message: 'Check the supplied fields and record IDs.' });
    if (error.code === 20 || /Transaction numbers are only allowed/.test(error.message)) return res.status(503).json({ success: false, message: 'Stock transactions require MongoDB Atlas or a replica set. Configure a transaction-capable database.' });
    if (!error.statusCode) console.error('Workflow error:', error.message);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to complete this workflow action. No stock changes were committed.' });
  }
};

function scoped(user, kind) {
  if (!['requisition', 'fg', 'dispatch'].includes(kind)) fail(400, 'Invalid transaction type.');
  allow(user, kind === 'dispatch' ? ['warehouse'] : ['warehouse', 'production']);
  return { kind, ...(user.role === 'production' ? { createdBy: user._id } : {}) };
}
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const populateRecord = (query) => query.populate('createdBy verifiedBy dispatchedBy', 'name email role').populate('issues.dispensedBy issues.receivedBy issues.resolvedBy', 'name email role').populate('sourceRequisitions', 'number materialCode materialName productionOrder issues status').populate('fgReceipt', 'number materialName batchNo availableQuantity location expiryDate');

export const list = endpoint(async (req) => {
  const query = scoped(req.user, req.params.kind);
  if (req.query.awaitingReceipt === 'true' && req.params.kind === 'requisition') query['issues.status'] = 'Sent to Production';
  if (req.query.status) query.status = { $in: String(req.query.status).split(',') };
  if (req.query.search) query.$or = ['number', 'materialCode', 'materialName', 'batchNo', 'customer', 'productionOrder'].map((key) => ({ [key]: { $regex: escaped(String(req.query.search).slice(0, 100)), $options: 'i' } }));
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = 20;
  const total = await WorkflowRecord.countDocuments(query);
  const records = await populateRecord(WorkflowRecord.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit));
  return { records, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
});
export const detail = endpoint(async (req) => {
  const record = await populateRecord(WorkflowRecord.findOne({ ...scoped(req.user, req.params.kind), _id: req.params.id }));
  if (!record) fail(404, 'Transaction not found.');
  return { record };
});

export const lookups = endpoint(async (req) => {
  allow(req.user, ['warehouse', 'production', 'qc-test']);
  const locations = await Location.find().sort({ name: 1 });
  const qcUsers = await User.find({ status: 'Active', role: { $in: ['qc-test', 'admin'] } }).select('name email role');
  const materials = await WarehouseReceiving.aggregate([{ $group: { _id: { code: '$materialCode', unit: '$quantityUnit' }, name: { $first: '$materialName' } } }, { $sort: { '_id.code': 1 } }]);
  return { locations, qcUsers, materials: materials.map((item) => ({ materialCode: item._id.code, quantityUnit: item._id.unit, materialName: item.name })) };
});
export const availableBatches = endpoint(async (req) => {
  allow(req.user, ['warehouse', 'production']);
  const query = { status: 'Available', 'qc.decision': 'Approved', 'verification.acceptedAt': { $ne: null }, availableQuantity: { $gt: 0 }, expiryDate: { $gt: new Date() } };
  if (req.query.materialCode) query.materialCode = req.query.materialCode;
  if (req.query.quantityUnit) query.quantityUnit = req.query.quantityUnit;
  const records = await WarehouseReceiving.find(query).select('grnNumber materialCode materialName batchNo availableQuantity quantityUnit expiryDate verification').sort({ expiryDate: 1 });
  return { records };
});
export const addLocation = endpoint(async (req) => {
  allow(req.user, ['warehouse']);
  const name = textValue(req.body.name, 'Location name', true, 100);
  const location = await service.transact(async (session) => {
    const [created] = await Location.create([{ name, createdBy: req.user._id }], { session });
    await WorkflowEvent.create([{ number: await service.nextNumber('EVT-', session), entity: created._id, entityType: 'location', reference: name, action: 'Location created', actor: req.user._id }], { session });
    return created;
  });
  return { location };
});
export const summary = endpoint(async (req) => {
  allow(req.user, ['warehouse', 'production', 'qc-test']);
  const raw = await WarehouseReceiving.aggregate([{ $group: { _id: { status: '$status', unit: '$quantityUnit' }, quantity: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, '$availableQuantity', '$receivedQuantity'] } }, count: { $sum: 1 } } }, { $sort: { '_id.status': 1 } }]);
  const scope = req.user.role === 'production' ? { createdBy: req.user._id } : {};
  const transactions = await WorkflowRecord.aggregate([{ $match: scope }, { $group: { _id: { kind: '$kind', status: '$status', unit: '$quantityUnit' }, count: { $sum: 1 }, quantity: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, '$availableQuantity', '$quantity'] } } } }]);
  return { raw, transactions };
});

export const auditEvents = endpoint(async (req) => {
  allow(req.user, ['warehouse']);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const query = req.query.search ? { $or: ['reference', 'number', 'action', 'note'].map((field) => ({ [field]: { $regex: escaped(String(req.query.search).slice(0, 100)), $options: 'i' } })) } : {};
  const total = await WorkflowEvent.countDocuments(query);
  const events = await WorkflowEvent.find(query).populate('actor', 'name email role').sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30);
  return { events, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 30)) } };
});

export const trace = endpoint(async (req) => {
  allow(req.user, ['warehouse', 'production', 'qc-test']);
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) fail(400, 'Invalid traceability ID.');
  const raw = await WarehouseReceiving.findById(id).select('_id');
  const root = raw || await WorkflowRecord.findById(id);
  if (!root) fail(404, 'Record not found.');
  if (req.user.role === 'production' && (raw || String(root.createdBy) !== String(req.user._id))) fail(403, 'Traceability is available for your own transactions.');
  const ids = new Set([String(id)]);
  if (!raw) {
    if (root.fgReceipt) ids.add(String(root.fgReceipt));
    for (const source of root.sourceRequisitions || []) ids.add(String(source));
    for (const issue of root.issues || []) ids.add(String(issue.receipt));
  }
  // Expand both source and downstream links across raw receipt, production, FG and dispatch.
  for (let level = 0; level < 4; level++) {
    const records = await WorkflowRecord.find({ $or: [{ _id: { $in: [...ids] } }, { 'issues.receipt': { $in: [...ids] } }, { sourceRequisitions: { $in: [...ids] } }, { fgReceipt: { $in: [...ids] } }] });
    const oldSize = ids.size;
    for (const record of records) {
      ids.add(String(record._id));
      if (record.fgReceipt) ids.add(String(record.fgReceipt));
      for (const source of record.sourceRequisitions || []) ids.add(String(source));
      for (const issue of record.issues || []) ids.add(String(issue.receipt));
    }
    if (oldSize === ids.size) break;
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const query = { entity: { $in: [...ids] } };
  const total = await WorkflowEvent.countDocuments(query);
  const events = await WorkflowEvent.find(query).populate('actor', 'name email role').sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50);
  const receipts = await WarehouseReceiving.find({ _id: { $in: [...ids] } }).select('grnNumber supplierName materialCode materialName batchNo receivedQuantity quantityUnit status receivedBy createdAt');
  return { events, receipts, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 50)) } };
});

export const uploadDocuments = endpoint(async (req) => {
  const uploaded = [];
  try {
    const kind = req.params.kind;
    if (!['qc', 'fg'].includes(kind)) fail(400, 'Invalid document target.');
    allow(req.user, kind === 'qc' ? ['qc-test'] : ['production']);
    if (!req.files?.length) fail(400, 'Select at least one file.');
    const categories = documentCategories(req.body, kind, req.files.length);
    for (const [index, file] of req.files.entries()) uploaded.push({ ...await uploadWarehouseDocument(file), kind: categories[index] });
    const record = await service.attachDocuments(kind, req.params.id, req.user, uploaded);
    return { record };
  } catch (error) {
    await Promise.allSettled(uploaded.map(deleteWarehouseDocument));
    throw error;
  } finally {
    await Promise.allSettled((req.files || []).map((file) => unlink(file.path)));
  }
});

export const actions = {
  sampling: service.recordSampling, tests: service.recordTests, decision: service.qcDecision, acceptRaw: service.acceptRawMaterial,
  dispense: service.dispense, receive: service.receiveProduction, resolve: service.resolveDiscrepancy,
  submitFg: service.submitFg, acceptFg: service.acceptFg, confirmDispatch: service.confirmDispatch,
};
export const action = (name) => endpoint(async (req) => ({ record: await actions[name](req.params.id, req.user, req.body || {}) }));
export const create = (name) => endpoint(async (req) => ({ record: await service[name](req.user, req.body || {}) }));
export const adjust = endpoint(async (req) => {
  if (!['raw', 'fg'].includes(req.params.kind)) fail(400, 'Invalid stock type.');
  return { record: await service.adjustStock(req.params.kind, req.params.id, req.user, req.body || {}) };
});
