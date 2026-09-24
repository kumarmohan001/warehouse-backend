import mongoose from 'mongoose';

const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model });
export const attachmentSchema = new mongoose.Schema({
  kind: { type: String, required: true }, fileName: String, fileUrl: String, cloudinaryPublicId: String,
  cloudinaryResourceType: String, uploadedBy: ref('User'), uploadedAt: { type: Date, default: Date.now },
});
const issueSchema = new mongoose.Schema({
  number: String, receipt: ref('WarehouseReceiving'), batchNo: String, location: String, quantity: Number,
  status: { type: String, enum: ['Sent to Production', 'Completed', 'Discrepancy'], default: 'Sent to Production' },
  dispensedBy: ref('User'), dispensedAt: Date, receivedBy: ref('User'), receivedAt: Date,
  actualQuantity: Number, differenceQuantity: Number, reason: String, remarks: String,
  resolution: String, resolvedBy: ref('User'), resolvedAt: Date,
});
const workflowSchema = new mongoose.Schema({
  kind: { type: String, enum: ['requisition', 'fg', 'dispatch'], required: true, index: true },
  number: { type: String, unique: true, required: true },
  materialCode: String, materialName: String, quantity: { type: Number, required: true, min: 0.000001 },
  quantityUnit: { type: String, required: true }, batchNo: String, productionOrder: String,
  status: { type: String, required: true, index: true }, createdBy: { ...ref('User'), required: true },
  remarks: String, manufacturingDate: Date, expiryDate: Date,
  documents: [attachmentSchema], issues: [issueSchema],
  sourceRequisitions: [ref('WorkflowRecord')], fgReceipt: ref('WorkflowRecord'),
  acceptedQuantity: Number, availableQuantity: { type: Number, default: 0, min: 0 }, location: String,
  verifiedBy: ref('User'), verifiedAt: Date, verificationRemarks: String,
  discrepancyReason: String, customer: String, salesOrder: String, destination: String, dispatchDate: Date,
  dispatchedBy: ref('User'), dispatchedAt: Date,
}, { timestamps: true, optimisticConcurrency: true });
workflowSchema.index({ kind: 1, createdAt: -1 });

const eventSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true }, action: { type: String, required: true },
  entity: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, entityType: String,
  reference: String, actor: { ...ref('User'), required: true }, quantity: Number, unit: String,
  note: String, details: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

export const WorkflowRecord = mongoose.model('WorkflowRecord', workflowSchema);
export const WorkflowEvent = mongoose.model('WorkflowEvent', eventSchema);
export const Sequence = mongoose.model('WorkflowSequence', new mongoose.Schema({ _id: String, value: { type: Number, default: 0 } }));
export const Location = mongoose.model('WarehouseLocation', new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true }, createdBy: ref('User'),
}, { timestamps: true }));
