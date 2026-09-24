import mongoose from 'mongoose';
import { attachmentSchema } from './workflow.js';

const documentSchema = new mongoose.Schema({
  fileName: { type: String, trim: true },
  fileUrl: { type: String, trim: true },
  cloudinaryPublicId: { type: String, trim: true },
  cloudinaryResourceType: { type: String, trim: true },
  uploadedAt: { type: Date },
}, { _id: false });

const warehouseSchema = new mongoose.Schema({
  grnNumber: { type: String, required: true, unique: true, trim: true, index: true },
  materialType: {
    type: String,
    required: true,
    enum: ['API', 'EXP', 'PPM', 'SPM', 'Solvent', 'Consumables'],
  },
  materialCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  materialName: { type: String, required: true, trim: true },
  supplierName: { type: String, required: true, trim: true, index: true },
  poNumber: { type: String, required: true, trim: true },
  invoiceNumber: { type: String, required: true, trim: true },
  batchNo: { type: String, required: true, trim: true, index: true },
  manufacturer: { type: String, required: true, trim: true },
  receivedQuantity: { type: Number, required: true, min: 0.000001 },
  quantityUnit: { type: String, default: 'Kg', trim: true },
  containers: { type: Number, required: true, min: 1 },
  manufacturingDate: { type: Date, required: true },
  expiryDate: { type: Date, required: true, index: true },
  receivingDate: { type: Date, required: true, default: Date.now },
  storageRequirement: { type: String, required: true, trim: true },
  remarks: { type: String, trim: true, default: '' },
  documents: {
    coa: { type: documentSchema, default: () => ({}) },
    invoice: { type: documentSchema, default: () => ({}) },
    packingList: { type: documentSchema, default: () => ({}) },
    otherRequiredDocuments: { type: documentSchema, default: () => ({}) },
  },
  documentStatus: { type: String, enum: ['Documents OK', 'Documents Missing/Not OK'], default: 'Documents Missing/Not OK', index: true },
  status: { type: String, enum: ['Quarantine', 'Document Hold', 'Under Test', 'Approved', 'Rejected', 'Hold', 'Available'], default: 'Document Hold', index: true },
  sampling: { number: String, samplingDate: Date, quantity: Number, containers: Number, sampledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, remarks: String, recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, recordedAt: Date },
  qc: {
    tests: [{ testName: String, specification: String, requiredLimit: String, actualResult: String, testMethod: String, result: { type: String, enum: ['Pass', 'Fail'] }, analyst: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, testDate: Date, remarks: String, recordedAt: Date }],
    documents: [attachmentSchema], decision: String, decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, decisionAt: Date, decisionRemarks: String,
  },
  verification: { acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, acceptedAt: Date, location: String, remarks: String },
  availableQuantity: { type: Number, default: 0, min: 0 },
  statusHistory: [{ from: String, to: String, note: String, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, changedAt: { type: Date, default: Date.now } }],
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  qcAssignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
}, { timestamps: true, optimisticConcurrency: true });

warehouseSchema.pre('validate', function setReceivingStatus(next) {
  const requiredDocuments = ['coa', 'invoice', 'packingList', 'otherRequiredDocuments'];
  const documentsOk = requiredDocuments.every((name) => {
    const document = this.documents?.[name];
    return Boolean(document?.fileName || document?.fileUrl);
  });
  this.documentStatus = documentsOk ? 'Documents OK' : 'Documents Missing/Not OK';
  if (this.isNew || (this.isModified('documents') && ['Quarantine', 'Document Hold'].includes(this.status))) {
    this.status = documentsOk ? 'Quarantine' : 'Document Hold';
  }
  if (!documentsOk && ['Quarantine', 'Under Test', 'Approved'].includes(this.status)) this.status = 'Document Hold';
  next();
});

const WarehouseReceiving = mongoose.model('WarehouseReceiving', warehouseSchema);
export default WarehouseReceiving;
