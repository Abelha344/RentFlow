const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { inventoryListKey, inventoryItemKey } = require('../config/cache');
const ctrl = require('../controllers/inventoryController');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorize('admin', 'manager', 'cashier'),
  cacheMiddleware((req) => inventoryListKey(req.query)),
  ctrl.listItems
);
router.get(
  '/:id',
  authorize('admin', 'manager', 'cashier'),
  cacheMiddleware((req) => inventoryItemKey(req.params.id)),
  ctrl.getItem
);

router.post(
  '/',
  authorize('admin', 'manager'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('total_quantity').isInt({ min: 0 }).withMessage('Quantity must be a whole number ≥ 0'),
  body('rental_rate_per_day').isFloat({ min: 0 }).withMessage('Rate must be a number ≥ 0'),
  validate,
  ctrl.createItem
);

router.patch(
  '/:id',
  authorize('admin', 'manager'),
  param('id').isUUID(),
  validate,
  ctrl.updateItem
);

router.post(
  '/:id/adjust-stock',
  authorize('admin', 'manager'),
  param('id').isUUID(),
  body('qty_good').isInt({ min: 0 }),
  body('qty_semi_damaged').isInt({ min: 0 }),
  body('qty_damaged').isInt({ min: 0 }),
  validate,
  ctrl.adjustStock
);

router.delete(
  '/:id',
  authorize('admin'),
  param('id').isUUID(),
  validate,
  ctrl.softDeleteItem
);

module.exports = router;
