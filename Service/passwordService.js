import User from '../Model/user.js';
import { hashPassword, comparePassword } from '../config/hashPassword.js';
import { disconnectUser } from './socketService.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };

export async function setUserPassword(user, password) {
  if (typeof password !== 'string' || password.length < 6) fail(400, 'Password must be at least 6 characters.');
  if (Buffer.byteLength(password, 'utf8') > 72) fail(400, 'Password must not exceed 72 bytes.');
  user.password = await hashPassword(password);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
}

export async function changeOwnPassword(userId, values = {}) {
  const { currentPassword, newPassword, confirmPassword } = values;
  if (typeof currentPassword !== 'string' || !currentPassword) fail(400, 'Enter your current password.');
  if (typeof newPassword !== 'string' || newPassword !== confirmPassword) fail(400, 'New password and confirmation must match.');
  const user = await User.findById(userId);
  if (!user || user.status !== 'Active') fail(401, 'Account is unavailable.');
  if (!(await comparePassword(currentPassword, user.password))) fail(400, 'Current password is incorrect.');
  if (currentPassword === newPassword) fail(400, 'Choose a password different from your current password.');
  await setUserPassword(user, newPassword);
  await user.save();
  disconnectUser(user._id);
}
