import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import userRoutes from './Route/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = [
  'http://localhost:5173',
  'https://warehouse-frontend-seven.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', userRoutes);

app.get('/', (req, res) => res.json({ success: true, message: 'Warehouse API is running.' }));
app.get('/health', (req, res) => res.json({ success: true, message: 'Warehouse API is healthy.' }));

app.use((err, req, res, next) => {
  console.error('Request error:', err.message);
  res.status(500).json({ success: false, message: err.message });
});

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error('Server startup failed:', error.message || error);
    process.exit(1);
  }
}

startServer();
