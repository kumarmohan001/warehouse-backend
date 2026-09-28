import { validSignatureImage } from '../Service/signatureImage.js';
import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import { requireQc, fail, positive, textValue, validDate } from '../Service/workflowRules.js';

export async function saveSamplersReport(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid receiving record ID.');
    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) fail(404, 'Receiving record not found.');
    requireQc(record, req.user);
    const values = req.body || {};
    if (!Number.isInteger(values.revision) || values.revision !== (record.__v ?? 0)) fail(409, 'The stock record changed. Reopen it before saving the report.');
    const containersSampled = positive(values.containersSampled, 'Containers sampled');
    const quantityToBeSampled = positive(values.quantityToBeSampled, 'Quantity to be sampled');
    const quantitySampled = positive(values.quantitySampled, 'Quantity sampled');
    if (!Number.isInteger(containersSampled) || containersSampled > record.containers) fail(400, 'Containers sampled must be a whole number within the received container count.');
    if (quantitySampled > quantityToBeSampled || quantityToBeSampled > record.receivedQuantity) fail(400, 'Sampled quantity must not exceed the planned quantity or received quantity.');
    const samplingDate = validDate(values.samplingDate, 'Sampling date');
    const receiptDay = new Date(record.receivingDate).toISOString().slice(0, 10);
    if (samplingDate.toISOString().slice(0, 10) < receiptDay || samplingDate > new Date()) fail(400, 'Sampling date must be between the receipt date and today.');
    const arNumber = textValue(values.arNumber, 'A.R. Number');
    if (record.sampling?.number && (arNumber !== record.sampling.number || quantitySampled !== record.sampling.quantity || containersSampled !== record.sampling.containers || samplingDate.toISOString().slice(0, 10) !== new Date(record.sampling.samplingDate).toISOString().slice(0, 10))) fail(409, 'A.R. number, sampled quantity, containers and date must match the saved sampling details.');
    const snapshotFields = ['materialName', 'manufacturer', 'supplierName', 'batchNo', 'manufacturingDate', 'expiryDate', 'storageRequirement', 'containers', 'receivedQuantity', 'quantityUnit', 'grnNumber'];
    if (!validSignatureImage(values.signatureImage)) fail(400, 'Invalid signature image. Use the signature drawing pad.');
    const report = {
      signatureImage: values.signatureImage ?? record.samplersReport?.signatureImage ?? '',
      ...Object.fromEntries(snapshotFields.map(key => [key, record[key]])),
      arNumber, containersSampled, quantityToBeSampled, quantitySampled, samplingDate,
      containerType: textValue(values.containerType, 'Container type'),
      sealOfContainers: textValue(values.sealOfContainers, 'Seal of containers'),
      packingConditions: textValue(values.packingConditions, 'Packing conditions'),
      sampledByName: textValue(values.sampledByName, 'Sampling by'),
      remarks: textValue(values.remarks, 'Remarks', false, 2000),
      recordedBy: req.user._id, recordedByName: req.user.name || req.user.email,
      savedAt: new Date(),
    };
    if (record.samplersReport) record.samplersReportHistory.push(record.samplersReport.toObject());
    record.samplersReport = report;
    await record.save();
    return res.json({ success: true, data: { report: record.samplersReport, revision: record.__v } });
  } catch (error) {
    const status = error.statusCode || (error.name === 'VersionError' ? 409 : error.name === 'ValidationError' ? 400 : 500);
    return res.status(status).json({ success: false, message: error.statusCode ? error.message : status === 409 ? 'The record changed. Reopen it and try again.' : 'Unable to save the samplers report.' });
  }
}
