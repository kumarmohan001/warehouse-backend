import User from '../Model/user.js';

export const getOverview = async (req, res) => {
  try {
    const activeUsers = await User.countDocuments({ status: 'Active' });
    return res.json({ success: true, data: { activeUsers, openRequisitions: 7, pendingQc: 5, dispatchesToday: 12, activities: [
      { timestamp: 'Today, 09:12', user: 'R. Iyer', role: 'Warehouse', action: 'Accepted material', reference: 'GRN-01123' },
      { timestamp: 'Today, 09:04', user: 'A. Sharma', role: 'QC', action: 'Approved batch', reference: 'SMP-00456' },
      { timestamp: 'Today, 08:51', user: 'M. Fernandes', role: 'Production', action: 'Raised discrepancy', reference: 'MR-000125' },
      { timestamp: 'Yesterday, 18:20', user: req.user.name, role: req.user.role === 'admin' ? 'Admin' : 'User', action: 'Signed in to workspace', reference: `USR-${req.user._id.toString().slice(-5).toUpperCase()}` },
    ] } });
  } catch (error) { console.error('Dashboard error:', error); return res.status(500).json({ success: false, message: 'Unable to load dashboard data.' }); }
};
