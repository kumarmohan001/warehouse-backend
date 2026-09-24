import { notifySamplingRequired } from '../Service/workflowService.js';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';
import Notification from '../Model/notification.js';
import { validateQcAssignee, notifyQcAssignment, updateReceivingStatus, markNotificationRead } from '../Service/warehouseReceivingService.js';
import { unlink } from 'node:fs/promises';
import { deleteWarehouseDocument, uploadWarehouseDocument } from '../Service/cloudinaryService.js';

const warehouseRoles = ['warehouse', 'admin'];
const requiredFields = ['grnNumber', 'materialType', 'materialCode', 'materialName', 'supplierName', 'poNumber', 'invoiceNumber', 'batchNo', 'manufacturer', 'receivedQuantity', 'containers', 'manufacturingDate', 'expiryDate', 'receivingDate', 'storageRequirement'];
const editableFields = [...requiredFields, 'quantityUnit', 'remarks', 'qcAssignedTo'];
const documentFields = ['coa', 'invoice', 'packingList', 'otherRequiredDocuments'];
const documentAliases = {
  coa: 'coa',
  invoice: 'invoice',
  invoiceDocument: 'invoice',
  packingList: 'packingList',
  otherDocuments: 'otherRequiredDocuments',
  otherRequiredDocuments: 'otherRequiredDocuments',
  COA: 'coa',
  Invoice: 'invoice',
  'Packing List': 'packingList',
  'Other required documents': 'otherRequiredDocuments',
};

const canManageWarehouse = (user) => warehouseRoles.includes(user?.role);
const responseRecord = (record) => ({ record });
const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const parseDocuments = (documents) => {
  if (typeof documents !== 'string') return documents;
  try {
    return JSON.parse(documents);
  } catch {
    return {};
  }
};

const normaliseDocuments = (documents = {}) => {
  documents = parseDocuments(documents);
  if (!documents || typeof documents !== 'object' || Array.isArray(documents)) return {};

  return Object.entries(documents).reduce((normalised, [key, value]) => {
    const field = documentAliases[key];
    if (!field || value === undefined || value === null) return normalised;

    if (typeof value === 'string') {
      if (value.trim() && value.trim().toLowerCase() !== 'missing') normalised[field] = { fileName: value.trim() };
      return normalised;
    }

    if (typeof value === 'object') {
      const fileName = String(value.fileName || value.name || '').trim();
      const fileUrl = String(value.fileUrl || value.url || '').trim();
      if (fileName || fileUrl) normalised[field] = { fileName, fileUrl };
    }
    return normalised;
  }, {});
};

const uploadDocumentsToCloudinary = async (files = {}) => {
  const uploads = await Promise.all(Object.entries(files).map(async ([key, fileList]) => {
    const field = documentAliases[key];
    const file = fileList?.[0];
    if (!field || !file?.path) return null;

    const document = await uploadWarehouseDocument(file);
    return {
      field,
      document,
      upload: document,
    };
  }));

  return uploads.reduce((result, item) => {
    if (item) {
      result.documents[item.field] = item.document;
      result.uploads.push(item.upload);
    }
    return result;
  }, { documents: {}, uploads: [] });
};

const removeCloudinaryUploads = async (uploads) => {
  await Promise.allSettled(uploads.map((upload) => deleteWarehouseDocument(upload)));
};

const removeTemporaryFiles = async (files = {}) => {
  const fileList = Object.values(files).flat().filter((file) => file?.path);
  await Promise.allSettled(fileList.map((file) => unlink(file.path)));
};

const validationMessage = (error) => Object.values(error.errors || {})
  .map((item) => item.message)
  .join(' ') || 'Invalid material receiving data.';

const validateReceivingValues = (values) => {
  const missing = requiredFields.filter((field) => isBlank(values[field]));
  if (missing.length) return `Required fields: ${missing.join(', ')}.`;

  const manufacturingDate = new Date(values.manufacturingDate);
  const expiryDate = new Date(values.expiryDate);
  const receivingDate = new Date(values.receivingDate);
  if ([manufacturingDate, expiryDate, receivingDate].some((date) => Number.isNaN(date.getTime()))) return 'Manufacturing, expiry, and receiving dates must be valid dates.';
  if (expiryDate <= manufacturingDate) return 'Expiry date must be later than manufacturing date.';
  if (!Number.isFinite(Number(values.receivedQuantity)) || Number(values.receivedQuantity) <= 0) return 'Received quantity must be greater than zero.';
  if (!Number.isInteger(Number(values.containers)) || Number(values.containers) < 1) return 'Containers must be a whole number of at least 1.';
  return null;
};

export const createMaterialReceiving = async (req, res) => {
  let uploadedFiles = [];
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, message: 'Material receiving data is required.' });

    const payload = Object.fromEntries([...editableFields, 'documents'].filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    payload.grnNumber = String(req.body.grnNumber || req.body.grn || '').trim();
    payload.documents = normaliseDocuments(req.body.documents);
    const validationError = validateReceivingValues(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    payload.qcAssignedTo = await validateQcAssignee(payload.qcAssignedTo || null);

    const uploaded = await uploadDocumentsToCloudinary(req.files);
    uploadedFiles = uploaded.uploads;
    payload.documents = { ...payload.documents, ...uploaded.documents };
    const record = await WarehouseReceiving.create({ ...payload, receivedBy: req.user._id });
    uploadedFiles = [];
    try { if (record.qcAssignedTo) await notifyQcAssignment(record); else await notifySamplingRequired(record); }
    catch (error) { console.error('Create QC notification error:', error); }
    return res.status(201).json({
      success: true,
      message: record.status === 'Quarantine' ? 'Material received and placed in Quarantine.' : 'Material received and placed on Document Hold.',
      data: responseRecord(record),
    });
  } catch (error) {
    if (uploadedFiles.length) await removeCloudinaryUploads(uploadedFiles);
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'A GRN with this number already exists. Enter a different GRN / Receiving No.' });
    if (error?.name === 'ValidationError' || error?.name === 'CastError') return res.status(400).json({ success: false, message: validationMessage(error) });
    console.error('Create material receiving error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create material receiving entry.' });
  } finally {
    await removeTemporaryFiles(req.files);
  }
};

export const getMaterialReceivings = async (req, res) => {
  try {
    const { status, documentStatus, materialType, search = '', page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = { $in: String(status).split(',') };
    if (documentStatus) query.documentStatus = documentStatus;
    if (materialType) query.materialType = materialType;
    if (search.trim()) query.$or = ['grnNumber', 'supplierName', 'materialCode', 'materialName', 'batchNo'].map((field) => ({ [field]: { $regex: search.trim(), $options: 'i' } }));
    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const total = await WarehouseReceiving.countDocuments(query);
    const records = await WarehouseReceiving.find(query).populate('receivedBy', 'name email role').populate('qcAssignedTo', 'name email role').sort({ createdAt: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize);
    return res.json({ success: true, data: { records, pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error('Get material receivings error:', error);
    return res.status(500).json({ success: false, message: 'Unable to retrieve material receiving entries.' });
  }
};

export const getMaterialReceivingById = async (req, res) => {
  try {
    const record = await WarehouseReceiving.findById(req.params.id).populate('receivedBy', 'name email role').populate('qcAssignedTo', 'name email role').populate('statusHistory.changedBy sampling.sampledBy sampling.recordedBy qc.tests.analyst qc.decisionBy verification.acceptedBy', 'name email role');
    if (!record) return res.status(404).json({ success: false, message: 'Material receiving entry not found.' });
    return res.json({ success: true, data: responseRecord(record) });
  } catch (error) {
    if (error?.name !== 'CastError') console.error('Get material receiving error:', error);
    return res.status(400).json({ success: false, message: 'Invalid material receiving entry ID.' });
  }
};

export const getQcAssignees = async (req, res) => {
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    const users = await User.find({ status: 'Active', role: { $in: ['qc-test', 'admin'] } }).select('name email role').sort({ name: 1 });
    return res.json({ success: true, data: { users } });
  } catch (error) {
    console.error('Get QC assignees error:', error);
    return res.status(500).json({ success: false, message: 'Unable to retrieve QC users.' });
  }
};

export const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id, read: false }).sort({ createdAt: -1 }).limit(20).populate('materialReceiving', 'grnNumber materialName status');
    return res.json({ success: true, data: { notifications } });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ success: false, message: 'Unable to retrieve notifications.' });
  }
};

export const updateMaterialReceiving = async (req, res) => {
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Material receiving entry not found.' });

    const changes = Object.fromEntries(editableFields
      .filter((field) => req.body?.[field] !== undefined)
      .map((field) => [field, req.body[field]]));
    if (!Object.keys(changes).length) return res.status(400).json({ success: false, message: 'Provide at least one editable receiving field.' });

    if ((record.sampling?.number || ['Approved', 'Rejected', 'Available'].includes(record.status)) && Object.keys(changes).some((field) => field !== 'qcAssignedTo')) return res.status(409).json({ success: false, message: 'Material details are locked after sampling. Only QC reassignment is allowed.' });
    const validationError = validateReceivingValues({ ...record.toObject(), ...changes });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const previousAssignee = record.qcAssignedTo;
    if (changes.qcAssignedTo !== undefined) changes.qcAssignedTo = await validateQcAssignee(changes.qcAssignedTo);
    Object.assign(record, changes);
    await record.save();
    try { await notifyQcAssignment(record, previousAssignee); }
    catch (error) { console.error('Reassignment notification error:', error); }
    await record.populate('qcAssignedTo', 'name email role');
    return res.json({ success: true, message: 'Material receiving entry updated successfully.', data: responseRecord(record) });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid material receiving entry ID.' });
    if (error?.name === 'ValidationError') return res.status(400).json({ success: false, message: validationMessage(error) });
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'A GRN with this number already exists.' });
    if (error?.name === 'VersionError') return res.status(409).json({ success: false, message: 'This receipt was updated by another user. Refresh and try again.' });
    console.error('Update material receiving error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update material receiving entry.' });
  }
};

export const deleteMaterialReceiving = async (req, res) => {
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Material receiving entry not found.' });

    if (record.sampling?.number || ['Approved', 'Rejected', 'Available'].includes(record.status)) return res.status(409).json({ success: false, message: 'A receipt in the QC workflow cannot be deleted.' });
    const documents = documentFields.map((field) => record.documents?.[field]).filter((document) => document?.cloudinaryPublicId);
    await record.deleteOne();
    await Promise.allSettled(documents.map((document) => deleteWarehouseDocument(document)));
    return res.json({ success: true, message: 'Material receiving entry deleted successfully.' });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid material receiving entry ID.' });
    console.error('Delete material receiving error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete material receiving entry.' });
  }
};

export const updateDocumentCheck = async (req, res) => {
  let uploadedFiles = [];
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Material receiving entry not found.' });
    if (record.sampling?.number || ['Approved', 'Rejected', 'Available'].includes(record.status)) return res.status(409).json({ success: false, message: 'Receiving documents are locked after sampling.' });
    const previousStatus = record.status;
    if (!req.body?.documents && !req.files) return res.status(400).json({ success: false, message: 'Documents are required.' });

    const uploaded = await uploadDocumentsToCloudinary(req.files);
    uploadedFiles = uploaded.uploads;
    const documents = { ...normaliseDocuments(req.body.documents), ...uploaded.documents };
    if (!Object.keys(documents).length) return res.status(400).json({ success: false, message: 'Provide at least one valid document name or URL.' });

    const replacedDocuments = documentFields
      .filter((name) => documents[name] !== undefined)
      .map((name) => record.documents?.[name])
      .filter((document) => document?.cloudinaryPublicId);

    for (const name of documentFields) {
      if (documents[name] !== undefined) record.documents[name] = { ...documents[name], uploadedAt: new Date() };
    }
    record.markModified('documents');
    await record.save();
    uploadedFiles = [];
    if (previousStatus !== 'Quarantine' && record.status === 'Quarantine') {
      try { await notifySamplingRequired(record); } catch (error) { console.error('Sampling notification error:', error); }
    }
    await Promise.allSettled(replacedDocuments.map((document) => deleteWarehouseDocument(document)));
    return res.json({ success: true, message: `Document check updated. Material is in ${record.status}.`, data: responseRecord(record) });
  } catch (error) {
    if (uploadedFiles.length) await removeCloudinaryUploads(uploadedFiles);
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error?.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid material receiving entry ID.' });
    if (error?.name === 'ValidationError') return res.status(400).json({ success: false, message: validationMessage(error) });
    console.error('Update document check error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update document check.' });
  } finally {
    await removeTemporaryFiles(req.files);
  }
};

export const deleteDocument = async (req, res) => {
  try {
    if (!canManageWarehouse(req.user)) return res.status(403).json({ success: false, message: 'Warehouse access is required.' });
    const field = documentAliases[req.params.documentName];
    if (!field) return res.status(400).json({ success: false, message: 'Invalid document name.' });

    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Material receiving entry not found.' });
    if (record.sampling?.number || ['Approved', 'Rejected', 'Available'].includes(record.status)) return res.status(409).json({ success: false, message: 'Receiving documents are locked after sampling.' });
    const document = record.documents?.[field];
    if (!document?.fileName && !document?.fileUrl) return res.status(404).json({ success: false, message: 'Document not found.' });

    record.documents[field] = {};
    record.markModified('documents');
    await record.save();

    if (document.cloudinaryPublicId) {
      try {
        await deleteWarehouseDocument(document);
      } catch (error) {
        console.error('Cloudinary document delete error:', error);
        return res.status(502).json({ success: false, message: 'Document was removed from the receipt, but Cloudinary deletion failed.' });
      }
    }

    return res.json({ success: true, message: 'Document deleted from the receipt and Cloudinary.', data: responseRecord(record) });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid material receiving entry ID.' });
    console.error('Delete document error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete document.' });
  }
};

export const changeReceivingStatus = async (req, res) => {
  try {
    const record = await updateReceivingStatus(req.params.id, req.user, req.body);
    return res.json({ success: true, data: { record } });
  } catch (error) {
    if (error?.name === 'VersionError') return res.status(409).json({ success: false, message: 'This receipt was updated or reassigned. Refresh and try again.' });
    return res.status(error.statusCode || (error.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: error.statusCode ? error.message : 'Unable to update receiving status.' });
  }
};

export const readNotification = async (req, res) => {
  try {
    const notification = await markNotificationRead(req.params.id, req.user._id);
    return res.json({ success: true, data: { notification } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to mark notification as read.' });
  }
};
