import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import WarehouseReceiving from '../Model/wareHouse.js';
import { validSignatureImage } from '../Service/signatureImage.js';
import { saveStockSignatureImages } from '../Controller/stockSignatureImages.js';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=';
afterEach(() => mock.restoreAll());
test('only bounded PNG images or an empty signature are accepted', () => {
  assert.equal(validSignatureImage(png), true);
  for (const value of ['data:image/svg+xml,<svg/>', 'data:image/png;base64,AAAA', 'x'.repeat(100001), {}]) assert.equal(validSignatureImage(value), false);
  assert.equal(validSignatureImage(''), true);
});
test('receipt and sampler report signature images survive model serialization', () => {
  const record = new WarehouseReceiving({ preparedSignature: png, checkedSignature: png, approvedSignature: png, samplersReport: { signatureImage: png } });
  const reloaded = WarehouseReceiving.hydrate(record.toObject());
  assert.equal(reloaded.preparedSignature, png);
  assert.equal(reloaded.checkedSignature, png);
  assert.equal(reloaded.approvedSignature, png);
  assert.equal(reloaded.samplersReport.signatureImage, png);
});
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
test('stock signature endpoint checks role, revision, image and preserves untouched signatures', async () => {
  const record = WarehouseReceiving.hydrate({ _id: new mongoose.Types.ObjectId(), __v: 3, checkedSignature: png });
  let saves = 0;
  mock.method(WarehouseReceiving, 'findById', async () => record);
  mock.method(record, 'save', async () => { saves++; record.__v++; });
  const req = { params: { id: record.id }, user: { _id: new mongoose.Types.ObjectId(), role: 'production' }, body: { revision: 3, preparedSignature: png } };
  let res = response(); await saveStockSignatureImages(req, res); assert.equal(res.statusCode, 403);
  req.user.role = 'warehouse'; req.body.revision = 2;
  res = response(); await saveStockSignatureImages(req, res); assert.equal(res.statusCode, 409);
  req.body.revision = 3; req.body.preparedSignature = 'invalid';
  res = response(); await saveStockSignatureImages(req, res); assert.equal(res.statusCode, 400);
  req.body.preparedSignature = png;
  res = response(); await saveStockSignatureImages(req, res); assert.equal(res.statusCode, 200);
  assert.equal(record.preparedSignature, png); assert.equal(record.checkedSignature, png); assert.equal(saves, 1);
});
