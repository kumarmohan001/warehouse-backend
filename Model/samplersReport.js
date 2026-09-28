import { signatureImageField } from '../Service/signatureImage.js';
import mongoose from 'mongoose';

export const samplersReportSchema = new mongoose.Schema({
  signatureImage: signatureImageField,
  grnNumber: String, materialName: String, manufacturer: String, supplierName: String,
  arNumber: String, batchNo: String, manufacturingDate: Date, expiryDate: Date,
  storageRequirement: String, containers: Number, receivedQuantity: Number, quantityUnit: String,
  containersSampled: Number, quantityToBeSampled: Number, quantitySampled: Number,
  containerType: String, sealOfContainers: String, packingConditions: String,
  sampledByName: String, samplingDate: Date, remarks: String,
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, recordedByName: String, savedAt: Date,
}, { _id: false });
