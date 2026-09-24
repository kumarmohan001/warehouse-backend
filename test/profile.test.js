import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import User from '../Model/user.js';
import cloudinary from '../config/cloudinary.js';
import { profilePayload, validatePhoto, validateProfile, updateOwnProfile } from '../Service/profileService.js';
import { updateProfile } from '../Controller/profile.js';

afterEach(() => mock.restoreAll());
const photo = { mimetype: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) };
function account() {
  const user = { _id: 'owner', name: 'Old Name', email: 'old@example.com', phone: '', role: 'warehouse', status: 'Active', password: 'secret-hash', tokenVersion: 2, photoPublicId: 'old-photo', save: mock.fn(async () => {}) };
  mock.method(User, 'findById', async () => user);
  mock.method(User, 'exists', async () => false);
  return user;
}
function uploads(t) {
  const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const oldValues = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = 'test'; });
  t.after(() => keys.forEach((key, index) => { if (oldValues[index] === undefined) delete process.env[key]; else process.env[key] = oldValues[index]; }));
  mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => ({ end: () => callback(null, { public_id: 'new-photo', secure_url: 'https://example.com/photo.png' }) }));
  return mock.method(cloudinary.uploader, 'destroy', async () => ({}));
}

test('profile fields are normalized and privileged fields ignored', () => {
  assert.deepEqual(validateProfile({ name: ' New Name ', email: ' NEW@example.com ', phone: ' +91 1234567890 ', role: 'admin', password: 'injected', photoUrl: 'injected' }), { name: 'New Name', email: 'new@example.com', phone: '+91 1234567890' });
  for (const values of [{ name: ' ' }, { email: 'invalid' }, { phone: 'invalid' }, { name: {} }]) assert.throws(() => validateProfile(values), { statusCode: 400 });
});

test('photo validation rejects forged and oversized files', () => {
  assert.doesNotThrow(() => validatePhoto(photo));
  assert.throws(() => validatePhoto({ mimetype: 'image/png', buffer: Buffer.from('<script>bad</script>') }), { statusCode: 400 });
  assert.throws(() => validatePhoto({ ...photo, buffer: Buffer.alloc(6 * 1024 * 1024) }), { statusCode: 400 });
});

test('profile updates persist personal details without changing permissions or sessions', async () => {
  const user = account();
  const result = await updateOwnProfile('owner', { name: 'New Name', phone: '1234567890', role: 'admin', tokenVersion: 99 });
  assert.equal(user.name, 'New Name');
  assert.equal(user.role, 'warehouse');
  assert.equal(user.tokenVersion, 2);
  assert.equal(user.save.mock.callCount(), 1);
  assert.equal(result.password, undefined);
  assert.equal(profilePayload(user).photoPublicId, undefined);
});

test('duplicate email is rejected before saving', async () => {
  const user = account();
  mock.method(User, 'exists', async () => true);
  await assert.rejects(updateOwnProfile('owner', { email: 'taken@example.com' }), { statusCode: 409 });
  assert.equal(user.save.mock.callCount(), 0);
});

test('new photo persists and the replaced image is cleaned up', async (t) => {
  const user = account();
  const destroy = uploads(t);
  const result = await updateOwnProfile('owner', {}, photo);
  assert.equal(result.photoUrl, 'https://example.com/photo.png');
  assert.equal(user.photoPublicId, 'new-photo');
  assert.equal(destroy.mock.calls[0].arguments[0], 'old-photo');
});

test('failed save removes new upload but keeps previous photo', async (t) => {
  const user = account();
  const destroy = uploads(t);
  mock.method(user, 'save', async () => { throw new Error('Save failed'); });
  await assert.rejects(updateOwnProfile('owner', {}, photo), /Save failed/);
  assert.equal(destroy.mock.callCount(), 1);
  assert.equal(destroy.mock.calls[0].arguments[0], 'new-photo');
});

test('profile endpoint uses authenticated identity rather than submitted id', async () => {
  const user = account();
  let queriedId;
  mock.method(User, 'findById', async (id) => { queriedId = id; return user; });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await updateProfile({ user: { _id: 'owner' }, body: { id: 'someone-else', name: 'New Name' } }, res);
  assert.equal(queriedId, 'owner');
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.password, undefined);
});
