// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";
import userRoutes from "./Route/index.js";

// Load environment variables early
dotenv.config();

// Connect to the database
connectDB();

const app = express();
const PORT = process.env.PORT || 4000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend URL
const allowedOrigins = [
  "http://localhost:5173",            // your Vite dev server
  "https://e-iindia-admin-tzyq.vercel.app" // your production domain
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));

// Middleware for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "frontend", "dist")));

// API routes
app.use("/api", userRoutes);

// Health check route
app.get("/health", (req, res) => {
  res.send("✅ Server is running!");
});

// Global error handler for CORS and other middleware issues
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ success: false, message: err.message });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
