const { cache } = require('../config/cache');

/**
 * Cache successful GET JSON responses in memory.
 * @param {(req: import('express').Request) => string} keyFn
 */
function cacheMiddleware(keyFn) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();

    const key = keyFn(req);
    const hit = cache.get(key);
    if (hit !== undefined) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(hit);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200 || res.statusCode === undefined) {
        cache.set(key, body);
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

module.exports = { cacheMiddleware };
