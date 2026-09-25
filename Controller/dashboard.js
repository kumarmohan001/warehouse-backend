import mongoose from 'mongoose';
import { WorkflowEvent, WorkflowRecord } from '../Model/workflow.js';
import WarehouseReceiving from '../Model/wareHouse.js';
import User from '../Model/user.js';

export const getAccountDashboard = async (req, res) => {
  try {
    const id = req.params.id || req.user._id;
    if (req.params.id && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Administrator access is required.' });
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid account ID.' });
    const account = await User.findById(id).select('name email phone role status');
    if (!account || !['warehouse', 'qc-test', 'production'].includes(account.role)) return res.status(404).json({ success: false, message: 'Account not found.' });
    const Model = account.role === 'production' ? WorkflowRecord : WarehouseReceiving;
    const scope = account.role === 'production' ? { createdBy: account._id } : account.role === 'qc-test' ? { qcAssignedTo: account._id } : { receivedBy: account._id };
    const [totals, records, warehouseStock] = await Promise.all([
      Model.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Model.find(scope).select('number kind grnNumber materialName batchNo status createdAt').sort({ createdAt: -1 }).limit(20),
      account.role === 'warehouse' ? WarehouseReceiving.aggregate([
        { $group: { _id: '$quantityUnit', received: { $sum: '$receivedQuantity' }, batches: { $sum: 1 }, available: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, '$availableQuantity', 0] } } } },
        { $sort: { _id: 1 } },
      ]) : Promise.resolve(null),
    ]);
    return res.json({ success: true, data: { account, totals, records, warehouseStock } });
  } catch (error) {
    console.error('Account dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load account dashboard.' });
  }
};

export const getOverview = async (req, res) => {
  try {
    // An unfiltered count deliberately includes the administrator making this request.
    const totalUsers = await User.countDocuments({});
    const events = await WorkflowEvent.find().populate('actor', 'name role').sort({ createdAt: -1 }).limit(10);
    return res.json({ success: true, data: { totalUsers, activities: events.map((entry) => ({ timestamp: entry.createdAt, user: entry.actor?.name || 'User', role: entry.actor?.role, action: entry.action, reference: entry.reference })) } });
  } catch (error) { console.error('Dashboard error:', error); return res.status(500).json({ success: false, message: 'Unable to load dashboard data.' }); }
};
