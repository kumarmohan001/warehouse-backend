import mongoose from 'mongoose';

const connectDB = async () => {
  const mongoUri = "mongodb+srv://bravodavid7895_db_user:LdSMeDz3cZf2qQJt@cluster0.taylpfk.mongodb.net";
  if (!mongoUri) {
    throw new Error('Missing MongoDB URI. Set MONGODB_URI in the Render environment variables.');
  }

  await mongoose.connect(mongoUri);
  console.log('MongoDB connected successfully.');
};

export default connectDB;
// done