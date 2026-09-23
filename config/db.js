import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoUri = "mongodb+srv://bravodavid7895_db_user:pP318s9g75kzQz8g@cluster0.m8guqdj.mongodb.net/warehouse";
    if (!mongoUri) {
      throw new Error('Missing MongoDB URI. Set MONGO_URI or MONGODB_URI in your .env file.');
    }

    await mongoose.connect(mongoUri);

    console.log('✅ MongoDB Connected Successfully 🎉🎊✨!');
  } catch (error) {
    console.error('MongoDB connection error:', error.message || error);
    process.exit(1);
  }
};

export default connectDB;
