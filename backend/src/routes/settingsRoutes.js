const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/settingsController');

const router = express.Router();

router.use(authenticate);

router.get('/audit-logs', authorize('admin', 'manager'), ctrl.listAuditLogs);
/** Staff need tiers when creating bookings */
router.get('/', authorize('admin', 'manager', 'cashier'), ctrl.listSettings);

router.put(
  '/:key',
  authorize('admin'),
  param('key').isString().notEmpty(),
  body('value').exists(),
  validate,
  ctrl.updateSetting
);

module.exports = router;
