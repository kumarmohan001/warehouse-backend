import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    photoUrl: { type: String, default: '' },
    photoPublicId: { type: String, default: '' },
    tokenVersion: { type: Number, default: 0 },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'warehouse', 'qc-test', 'production', 'admin'],
      default: 'warehouse',
    },
    phone:{
      type: String,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Inactive',
    },
    permissions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true, 
  }
);

const User = mongoose.model('User', userSchema);
export default User;
