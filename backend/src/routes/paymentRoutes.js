const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadReceipts } = require('../middleware/upload');
const ctrl = require('../controllers/paymentController');

const router = express.Router();

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests' },
});

router.use(authenticate);

router.get('/', authorize('admin', 'manager', 'cashier'), ctrl.listPayments);
router.get('/:id', authorize('admin', 'manager', 'cashier'), ctrl.getPayment);

router.post(
  '/',
  paymentLimiter,
  authorize('admin', 'manager', 'cashier'),
  uploadReceipts.single('receipt'),
  body('booking_id').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('type').isIn([
    'down_payment',
    'collateral_deposit',
    'installment',
    'final_settlement',
    'late_fee',
    'damage_fee',
    'deposit_refund',
  ]),
  body('method').isIn(['cash', 'bank_transfer', 'telebirr']),
  validate,
  ctrl.createPayment
);

router.patch(
  '/:id/status',
  authorize('admin', 'manager'),
  uploadReceipts.single('official_receipt'),
  param('id').isUUID(),
  body('status').isIn(['approved', 'rejected']),
  body('reference_number').optional({ values: 'falsy' }).isString(),
  body('booking_id').optional({ values: 'falsy' }).isUUID(),
  body('type').optional({ values: 'falsy' }).isIn([
    'down_payment',
    'collateral_deposit',
    'installment',
    'final_settlement',
    'late_fee',
    'damage_fee',
    'deposit_refund',
  ]),
  body('method').optional({ values: 'falsy' }).isIn(['cash', 'bank_transfer', 'telebirr']),
  body('amount').optional({ values: 'falsy' }).isFloat({ gt: 0 }),
  validate,
  ctrl.approvePayment
);

module.exports = router;
