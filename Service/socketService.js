import { Server } from 'socket.io';
import User from '../Model/user.js';
import TokenBlacklist from '../Model/tokenBlacklist.js';
import { verifyToken } from '../config/jwt.js';

let io;
const room = (userId) => `user:${userId}`;

export function initializeSockets(server, cors) {
  io = new Server(server, { cors });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = verifyToken(token);
      if (await TokenBlacklist.exists({ token })) throw new Error('Signed out');
      const user = await User.findById(decoded.userId).select('status tokenVersion');
      if (!user || user.status !== 'Active') throw new Error('Account unavailable');
      if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) throw new Error('Password changed');
      socket.data.userId = String(user._id);
      socket.data.expiresAt = decoded.exp * 1000;
      next();
    } catch { next(new Error('Authentication is required.')); }
  });
  io.on('connection', (socket) => {
    socket.join(room(socket.data.userId));
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()));
    timer.unref?.();
    socket.on('disconnect', () => clearTimeout(timer));
  });
  return io;
}

export function emitNotification(notification) {
  io?.to(room(notification.recipient)).emit('notification:new', notification);
}

export function disconnectUser(userId) {
  io?.in(room(userId)).disconnectSockets(true);
}
