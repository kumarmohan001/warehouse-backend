import express from 'express';
import { getOverview, getAccountDashboard } from '../Controller/dashboard.js';
import { adminOnly, protect } from '../Middleware/auth.js';
const router = express.Router();
router.get('/me', protect, getAccountDashboard);
router.get('/admin/overview', protect, adminOnly, getOverview);
router.get('/admin/accounts/:id', protect, adminOnly, getAccountDashboard);
export default router;
