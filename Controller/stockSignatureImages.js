import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import { validSignatureImage } from '../Service/signatureImage.js';
import { fail, requireQc } from '../Service/workflowRules.js';

export async function saveStockSignatureImages(req, res) {
  try {
    if (!['warehouse', 'qc-test', 'admin'].includes(req.user.role)) fail(403, 'Warehouse or QC access is required.');
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid stock ID.');
    const record = await WarehouseReceiving.findById(req.params.id);
    if (!record) fail(404, 'Stock record not found.');
    if (req.user.role === 'qc-test') requireQc(record, req.user);
    if (!Number.isInteger(req.body?.revision) || req.body.revision !== (record.__v ?? 0)) fail(409, 'Stock changed. Reopen it before saving signatures.');
    const fields = ['preparedSignature', 'checkedSignature', 'approvedSignature'].filter(key => req.body[key] !== undefined);
    if (!fields.length || fields.some(key => !validSignatureImage(req.body[key]))) fail(400, 'Provide valid PNG signatures from the drawing pad.');
    for (const key of fields) record[key] = req.body[key] || '';
    await record.save();
    return res.json({ success: true, data: { images: Object.fromEntries(fields.map(key => [key, record[key]])), revision: record.__v } });
  } catch (error) {
    const status = error.statusCode || (error.name === 'VersionError' ? 409 : 500);
    return res.status(status).json({ success: false, message: error.statusCode ? error.message : status === 409 ? 'Stock changed. Reopen it and try again.' : 'Unable to save signature images.' });
  }
}
