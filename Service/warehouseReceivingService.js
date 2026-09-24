import { qcDecision } from './workflowService.js';
import mongoose from 'mongoose';
import User from '../Model/user.js';
import Notification from '../Model/notification.js';
import WarehouseReceiving from '../Model/wareHouse.js';
import { emitNotification } from './socketService.js';

export const qcStatuses = ['Quarantine', 'Under Test', 'Approved', 'Rejected', 'Hold', 'Document Hold'];
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };

export async function validateQcAssignee(id) {
  if (id === null || id === '') return null;
  if (!mongoose.isValidObjectId(id)) fail(400, 'Select a valid QC reviewer.');
  const user = await User.findOne({ _id: id, status: 'Active', role: { $in: ['qc-test', 'admin'] } });
  if (!user) fail(400, 'Select an active QC Test user or QC Manager.');
  return user._id;
}

export async function notifyQcAssignment(record, previousAssignee = null) {
  if (!record.qcAssignedTo) return;
  if (String(record.qcAssignedTo) === String(previousAssignee)) return;
  // Persist first so offline reviewers also receive their assignments on reconnect.
  const notification = await Notification.create({
    recipient: record.qcAssignedTo,
    materialReceiving: record._id,
    title: record.status === 'Quarantine' ? 'New material received. Sampling required.' : previousAssignee ? 'Material receipt reassigned' : 'New material receipt assigned',
    targetPage: record.status === 'Quarantine' ? 'Sampling' : 'Receiving Stock', targetRole: 'qc-test',
    message: `${record.grnNumber} (${record.materialName}) was assigned to you for QC review. Current status: ${record.status}.`,
  });
  await notification.populate('materialReceiving', 'grnNumber materialName status');
  emitNotification(notification.toObject());
}

export async function updateReceivingStatus(id, user, values) {
  if (!['Approved', 'Rejected', 'Hold'].includes(values?.status)) fail(400, 'Use Sampling Details to start testing. Select Approved, Rejected or Hold for the QC decision.');
  return qcDecision(id, user, values);
}

export async function markNotificationRead(id, userId) {
  if (!mongoose.isValidObjectId(id)) fail(400, 'Invalid notification ID.');
  const notification = await Notification.findOneAndUpdate({ _id: id, recipient: userId }, { $set: { read: true } }, { new: true });
  if (!notification) fail(404, 'Notification not found.');
  return notification;
}
