import express from 'express';
import { getOverview } from '../Controller/dashboard.js';
import { protect } from '../Middleware/auth.js';
const router = express.Router();
router.get('/overview', protect, getOverview);
export default router;
