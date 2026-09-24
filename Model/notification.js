import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  materialReceiving: { type: mongoose.Schema.Types.ObjectId, ref: 'WarehouseReceiving' },
  workflowRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowRecord' },
  targetPage: String, targetRole: String,
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
