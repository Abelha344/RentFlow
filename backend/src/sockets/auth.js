const jwt = require('jsonwebtoken');

/**
 * Authenticate Socket.io handshake via cookie or auth.token.
 */
function authenticateSocket(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookieToken = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('access_token='))
      ?.split('=')[1];

    const token = socket.handshake.auth?.token || cookieToken;
    if (!token) {
      return next(new Error('Unauthorized'));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      full_name: payload.full_name,
    };
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
}

module.exports = { authenticateSocket };
