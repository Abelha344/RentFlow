const { authenticateSocket } = require('./auth');

/**
 * Attach Socket.io realtime channels for dashboards.
 */
function initSockets(io) {
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`Socket connected: ${user.email} (${user.role})`);

    socket.join('dashboard');
    if (['admin', 'manager'].includes(user.role)) {
      socket.join('managers');
    }

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user.email}`);
    });
  });
}

module.exports = { initSockets };
