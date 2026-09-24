import User from '../Model/user.js';
import { disconnectUser } from '../Service/socketService.js';
import { hashPassword, comparePassword } from '../config/hashPassword.js';
import { generateToken, verifyToken } from '../config/jwt.js';
import TokenBlacklist from '../Model/tokenBlacklist.js';

import { profilePayload as userPayload } from '../Service/profileService.js';

export const signup = async (req, res) => {
  try {
    const { name, email, password, phone = '', role } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    if (!name?.trim() || !normalizedEmail || !password || !phone?.trim() || !role) return res.status(400).json({ success: false, message: 'Name, email, mobile number, role, and password are required.' });
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    if (!['warehouse', 'qc-test', 'production'].includes(role)) return res.status(400).json({ success: false, message: 'Select a valid role.' });
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ success: false, message: 'An account already exists for this email.' });
    const user = await User.create({ name: name.trim(), email: normalizedEmail, password: await hashPassword(password), phone: phone.trim(), role, status: 'Active' });
    return res.status(201).json({ success: true, message: 'Account created successfully. Please sign in.', data: { user: userPayload(user) } });
  } catch (error) { console.error('Signup error:', error); return res.status(500).json({ success: false, message: 'Unable to create your account.' }); }
};

export const login = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase(); const { password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });
    const user = await User.findOne({ email });
    if (!user || !(await comparePassword(password, user.password))) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    if (user.status !== 'Active') return res.status(403).json({ success: false, message: 'Your account is not active. Contact an administrator.' });
    const token = generateToken({ userId: user._id.toString(), email: user.email, role: user.role, tokenVersion: user.tokenVersion || 0 }, '8h');
    return res.json({ success: true, message: 'Login successful.', data: { token, user: userPayload(user) } });
  } catch (error) { console.error('Login error:', error); return res.status(500).json({ success: false, message: 'Unable to sign in.' }); }
};

export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    if (!token) return res.status(400).json({ success: false, message: 'No access token provided.' });
    const { exp, userId } = verifyToken(token);
    await TokenBlacklist.create({ token, expiresAt: new Date(exp * 1000) });
    disconnectUser(userId);
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch { return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' }); }
};
