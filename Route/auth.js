import express from 'express';

const router = express.Router();
import { protect } from '../Middleware/auth.js';
import { profileUpload } from '../Middleware/profileUpload.js';
import { getProfile, updateProfile, changePassword } from '../Controller/profile.js';
router.get('/profile', protect, getProfile);
router.patch('/profile', protect, profileUpload, updateProfile);
router.patch('/password', protect, changePassword);
import { signup , login,logout } from '../Controller/auth.js';
// import { authenticateToken } from '../Middleware/authMiddleware.js';

router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout)

// router.get('/profile', authenticateToken, getUserProfile);

export default router;
