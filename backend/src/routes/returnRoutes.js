const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/returnController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('admin', 'manager', 'cashier'), ctrl.listReturns);

router.post(
  '/:id',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('items').isArray({ min: 1 }),
  body('items.*.item_id').isUUID(),
  validate,
  ctrl.processReturn
);

router.post(
  '/:id/share',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('channel').isIn(['telegram', 'email']),
  validate,
  ctrl.shareSettlement
);

router.post(
  '/:id/settlement-pdf',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  validate,
  ctrl.printSettlement
);

router.post(
  '/:id/settle',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('method').optional().isIn(['cash', 'bank_transfer', 'telebirr']),
  validate,
  ctrl.completeSettlement
);

router.post(
  '/:id/collect-rental',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('amount').optional().isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'bank_transfer', 'telebirr']),
  body('reference_number').optional().isString(),
  validate,
  ctrl.collectRental
);

router.post(
  '/:id/confirm-refund',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('method').optional().isIn(['cash', 'bank_transfer', 'telebirr']),
  validate,
  ctrl.confirmRefund
);

module.exports = router;
