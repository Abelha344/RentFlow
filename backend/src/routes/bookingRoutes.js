const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/bookingController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('admin', 'manager', 'cashier'), ctrl.listBookings);
router.get('/calendar', authorize('admin', 'manager', 'cashier'), ctrl.calendarEvents);

router.post(
  '/availability',
  authorize('admin', 'manager', 'cashier'),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('items').isArray({ min: 1 }),
  body('items.*.item_id').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  validate,
  ctrl.checkAvailability
);

router.get('/:id', authorize('admin', 'manager', 'cashier'), ctrl.getBooking);

router.post(
  '/',
  authorize('admin', 'manager', 'cashier'),
  body('customer_id').isUUID(),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('items').isArray({ min: 1 }),
  body('items.*.item_id').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('collateral_tier').optional().isIn(['low', 'medium', 'higher']),
  body('collateral_deposit').optional().isFloat({ min: 0 }),
  validate,
  ctrl.createBooking
);

router.patch(
  '/:id/status',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  body('status').isIn(['draft', 'confirmed', 'out_for_rent', 'returned', 'overdue', 'cancelled']),
  validate,
  ctrl.updateBookingStatus
);

router.patch(
  '/:id/deposit',
  authorize('admin'),
  param('id').isUUID(),
  body('collateral_deposit').isFloat({ min: 0 }),
  validate,
  ctrl.updateDeposit
);

router.post(
  '/:id/cancel',
  authorize('admin', 'manager'),
  param('id').isUUID(),
  validate,
  ctrl.cancelBooking
);

router.post(
  '/:id/work-order',
  authorize('admin', 'manager', 'cashier'),
  param('id').isUUID(),
  validate,
  ctrl.generateWorkOrder
);

module.exports = router;
