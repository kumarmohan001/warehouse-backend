import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import User from '../Model/user.js';
import TokenBlacklist from '../Model/tokenBlacklist.js';
import { hashPassword, comparePassword } from '../config/hashPassword.js';
import { generateToken } from '../config/jwt.js';
import { changeOwnPassword, setUserPassword } from '../Service/passwordService.js';
import { updateUser } from '../Controller/userController.js';
import { changePassword } from '../Controller/profile.js';
import { protect } from '../Middleware/auth.js';
import userRoutes from '../Route/user.js';

afterEach(() => mock.restoreAll());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function account() {
  const user = { _id: 'owner', status: 'Active', password: await hashPassword('old-secret'), tokenVersion: 0, save: mock.fn(async () => {}), toObject() { return { ...this }; } };
  mock.method(User, 'findById', async () => user);
  return user;
}

test('self password change checks current password and stores only a hash', async () => {
  const user = await account();
  await changeOwnPassword('owner', { currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'new-secret' });
  assert.notEqual(user.password, 'new-secret');
  assert.equal(await comparePassword('new-secret', user.password), true);
  assert.equal(await comparePassword('old-secret', user.password), false);
  assert.equal(user.tokenVersion, 1);
  assert.equal(user.save.mock.callCount(), 1);
});

test('incorrect current password, confirmation mismatch and invalid new passwords do not save', async () => {
  const user = await account();
  for (const values of [
    { currentPassword: 'wrong', newPassword: 'new-secret', confirmPassword: 'new-secret' },
    { currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'different' },
    { currentPassword: 'old-secret', newPassword: 'short', confirmPassword: 'short' },
    { currentPassword: 'old-secret', newPassword: 'old-secret', confirmPassword: 'old-secret' },
    { currentPassword: 'old-secret', newPassword: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) },
  ]) await assert.rejects(changeOwnPassword('owner', values), { statusCode: 400 });
  assert.equal(user.save.mock.callCount(), 0);
  assert.equal(user.tokenVersion, 0);
  await assert.rejects(setUserPassword(user, { length: 8 }), { statusCode: 400 });
});

test('self endpoint always targets the authenticated user and returns no credentials', async () => {
  await account();
  let target;
  const originalMock = User.findById;
  mock.method(User, 'findById', (id) => { target = id; return originalMock(id); });
  const res = response();
  await changePassword({ user: { _id: 'owner' }, body: { userId: 'another-user', currentPassword: 'old-secret', newPassword: 'new-secret', confirmPassword: 'new-secret' } }, res);
  assert.equal(target, 'owner');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes('new-secret'), false);
});

test('admin reset hashes the password, revokes prior sessions and omits hash from response', async () => {
  const user = await account();
  const res = response();
  await updateUser({ params: { _id: 'owner' }, body: { password: 'admin-reset' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await comparePassword('admin-reset', user.password), true);
  assert.equal(user.tokenVersion, 1);
  assert.equal(res.body.data.password, undefined);
});

test('ordinary admin edits preserve the existing password and session version', async () => {
  const user = await account();
  const oldHash = user.password;
  const res = response();
  await updateUser({ params: { _id: 'owner' }, body: { name: 'Updated name' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(user.password, oldHash);
  assert.equal(user.tokenVersion, 0);
});

test('admin invalid passwords return validation errors without saving', async () => {
  const user = await account();
  const res = response();
  await updateUser({ params: { _id: 'owner' }, body: { password: 'short' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(user.save.mock.callCount(), 0);
});

test('HTTP authentication rejects old password sessions and accepts the current version', async () => {
  mock.method(TokenBlacklist, 'exists', async () => false);
  mock.method(User, 'findById', () => ({ select: async () => ({ status: 'Active', tokenVersion: 1 }) }));
  for (const [version, expected] of [[0, 401], [1, 200]]) {
    const res = response();
    let allowed = false;
    await protect({ headers: { authorization: `Bearer ${generateToken({ userId: 'owner', tokenVersion: version })}` } }, res, () => { allowed = true; });
    assert.equal(res.statusCode, expected);
    assert.equal(allowed, version === 1);
  }
});

test('admin user routes reject unauthenticated and non-admin password updates', async (t) => {
  mock.method(TokenBlacklist, 'exists', async () => false);
  mock.method(User, 'findById', () => ({ select: async () => ({ status: 'Active', role: 'warehouse' }) }));
  const app = express(); app.use(express.json()); app.use('/users', userRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/users/another-user`;
  assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
  const token = generateToken({ userId: 'owner' });
  assert.equal((await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-secret' }) })).status, 403);
});
