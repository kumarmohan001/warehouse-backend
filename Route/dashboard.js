import express from 'express';
import { getOverview } from '../Controller/dashboard.js';
import { adminOnly, protect } from '../Middleware/auth.js';
const router = express.Router();
router.get('/admin/overview', protect, adminOnly, getOverview);
export default router;
