import jwt from "jsonwebtoken";
const jwtSecret = process.env.JWT_SECRET || "development-only-secret-change-before-deployment";

// Generate Token
export const generateToken = (payload, expiresIn = "1d") => {
  return jwt.sign(payload, jwtSecret, { expiresIn });
};

// Verify Token
export const verifyToken = (token) => {
  return jwt.verify(token, jwtSecret);
};
