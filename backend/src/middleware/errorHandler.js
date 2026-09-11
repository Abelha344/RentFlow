/**
 * Central error handler. Place last in the middleware stack.
 */
function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}]`, err);

  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Duplicate record',
      detail: err.detail,
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Referenced record not found',
      detail: err.detail,
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && status === 500
      ? { stack: err.stack }
      : {}),
  });
}

function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
