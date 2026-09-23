import mongoose from 'mongoose';

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('Missing MongoDB URI. Set MONGODB_URI in the Render environment variables.');
  }

  await mongoose.connect(mongoUri);
  console.log('MongoDB connected successfully.');
};

export default connectDB;
