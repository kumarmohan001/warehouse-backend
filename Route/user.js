import express from 'express';

const router = express.Router();
import { createUser, getAllUsers, getUserById, updateUser, deleteUser } from '../Controller/userController.js';
import { adminOnly, protect } from '../Middleware/auth.js';

router.use(protect, adminOnly);
router.post('/', createUser);
router.get('/', getAllUsers);
router.get('/getAllUsers', getAllUsers);
router.get('/getUserById/:_id', getUserById);
router.put('/:_id', updateUser);
router.put('/updateUser/:_id', updateUser);
router.delete('/:_id', deleteUser);
router.delete('/deleteUser/:_id', deleteUser);

// router.get('/profile', authenticateToken, getUserProfile);

export default router;
