import { WorkflowEvent } from '../Model/workflow.js';
import User from '../Model/user.js';

export const getOverview = async (req, res) => {
  try {
    // An unfiltered count deliberately includes the administrator making this request.
    const totalUsers = await User.countDocuments({});
    const events = await WorkflowEvent.find().populate('actor', 'name role').sort({ createdAt: -1 }).limit(10);
    return res.json({ success: true, data: { totalUsers, activities: events.map((entry) => ({ timestamp: entry.createdAt, user: entry.actor?.name || 'User', role: entry.actor?.role, action: entry.action, reference: entry.reference })) } });
  } catch (error) { console.error('Dashboard error:', error); return res.status(500).json({ success: false, message: 'Unable to load dashboard data.' }); }
};
