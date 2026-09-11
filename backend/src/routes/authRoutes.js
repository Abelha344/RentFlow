const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, try again later' },
});

router.post(
  '/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 6 }),
  validate,
  ctrl.login
);

router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.me);

router.get('/users', authenticate, authorize('admin'), ctrl.listUsers);

router.post(
  '/users',
  authenticate,
  authorize('admin'),
  body('full_name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('role').isIn(['admin', 'manager', 'cashier']),
  validate,
  ctrl.createUser
);

router.patch(
  '/users/:id',
  authenticate,
  authorize('admin'),
  body('role').optional().isIn(['admin', 'manager', 'cashier']),
  body('is_active').optional().isBoolean(),
  body('password').optional().isLength({ min: 8 }),
  validate,
  ctrl.updateUser
);

router.delete(
  '/users/:id',
  authenticate,
  authorize('admin'),
  ctrl.deleteUser
);

module.exports = router;
