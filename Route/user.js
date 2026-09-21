import express from 'express';

const router = express.Router();
import { getAllUsers ,getUserById,updateUser,deleteUser} from '../Controller/userController.js';
// import { authenticateToken } from '../Middleware/authMiddleware.js';

router.get('/getAllUsers', getAllUsers);
router.get('/getUserById/:_id', getUserById);
router.put('/updateUser/:_id', updateUser);
router.delete('/deleteUser/:_id', deleteUser);

// router.get('/profile', authenticateToken, getUserProfile);

export default router;
