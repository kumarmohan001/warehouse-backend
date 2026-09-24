import express from 'express';
import { changeReceivingStatus, readNotification, createMaterialReceiving, deleteDocument, deleteMaterialReceiving, getMaterialReceivingById, getMaterialReceivings, getMyNotifications, getQcAssignees, updateDocumentCheck, updateMaterialReceiving } from '../Controller/wareHouse.js';
import { protect } from '../Middleware/auth.js';
import upload from '../config/multer.js';

const router = express.Router();

router.use(protect);
const documentUploads = upload.fields([
  { name: 'coa', maxCount: 1 },
  { name: 'invoice', maxCount: 1 },
  { name: 'invoiceDocument', maxCount: 1 },
  { name: 'packingList', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 1 },
  { name: 'otherRequiredDocuments', maxCount: 1 },
]);

router.post('/create', documentUploads, createMaterialReceiving);
router.get('/qc-assignees', getQcAssignees);
router.get('/notifications', getMyNotifications);
router.patch('/notifications/:id/read', readNotification);
router.patch('/receivings/:id/status', changeReceivingStatus);
router.get('/receivings', getMaterialReceivings);
router.get('/receivings/:id', getMaterialReceivingById);
router.patch('/receivings/:id', updateMaterialReceiving);
router.delete('/receivings/:id', deleteMaterialReceiving);
router.patch('/receivings/:id/documents', documentUploads, updateDocumentCheck);
router.delete('/receivings/:id/documents/:documentName', deleteDocument);

export default router;
