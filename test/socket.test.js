import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import User from '../Model/user.js';
import TokenBlacklist from '../Model/tokenBlacklist.js';
import { generateToken } from '../config/jwt.js';
import { initializeSockets, emitNotification, disconnectUser } from '../Service/socketService.js';

// Exercise the same client package used by the frontend against a real HTTP socket.
const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { io: client } = requireFrontend('socket.io-client');

test('socket authentication, recipient isolation, delivery and logout', { timeout: 10000 }, async (t) => {
  mock.method(TokenBlacklist, 'exists', async ({ token }) => token === 'revoked');
  mock.method(User, 'findById', (id) => ({ select: async () => ({ _id: id, status: 'Active' }) }));
  const server = createServer();
  const io = initializeSockets(server, { origin: 'http://localhost:5173' });
  const clients = [];
  t.after(async () => {
    clients.forEach((socket) => socket.disconnect());
    await new Promise((resolve) => io.close(resolve));
    mock.restoreAll();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connect = (token) => {
    const socket = client(`http://127.0.0.1:${server.address().port}`, { auth: { token }, transports: ['websocket'], reconnection: false, autoConnect: false });
    clients.push(socket);
    return socket;
  };
  const bad = connect('invalid-token');
  const denied = once(bad, 'connect_error');
  bad.connect();
  assert.match((await denied)[0].message, /Authentication/);

  const reviewer = connect(generateToken({ userId: 'reviewer' }));
  const other = connect(generateToken({ userId: 'other' }));
  const connected = Promise.all([once(reviewer, 'connect'), once(other, 'connect')]);
  reviewer.connect(); other.connect();
  await connected;
  let leaked = false;
  other.on('notification:new', () => { leaked = true; });
  const received = once(reviewer, 'notification:new');
  emitNotification({ _id: 'notification-1', recipient: 'reviewer', materialReceiving: { _id: 'receipt-1' } });
  const [notification] = await received;
  assert.equal(notification.materialReceiving._id, 'receipt-1');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(leaked, false);
  const disconnected = once(reviewer, 'disconnect');
  disconnectUser('reviewer');
  await disconnected;
  assert.equal(other.connected, true);
});
