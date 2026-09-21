import User from '../Model/user.js';
import TokenBlacklist from '../Model/tokenBlacklist.js';
import { verifyToken } from '../config/jwt.js';

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Authentication is required.' });
  try {
    if (await TokenBlacklist.exists({ token })) return res.status(401).json({ success: false, message: 'This session has been signed out.' });
    const decoded = verifyToken(token); const user = await User.findById(decoded.userId).select('-password');
    if (!user || user.status !== 'Active') return res.status(401).json({ success: false, message: 'Account is unavailable.' });
    req.user = user; return next();
  } catch { return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' }); }
};
export const adminOnly = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ success: false, message: 'Administrator access is required.' });
