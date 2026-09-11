const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadKyc } = require('../middleware/upload');
const ctrl = require('../controllers/customerController');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('admin', 'manager', 'cashier'), ctrl.listCustomers);
router.get('/:id', authorize('admin', 'manager', 'cashier'), ctrl.getCustomer);

router.post(
  '/',
  authorize('admin', 'manager', 'cashier'),
  uploadKyc.single('id_card'),
  body('full_name').trim().notEmpty(),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  validate,
  (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'KYC scan is required' });
    }
    next();
  },
  ctrl.createCustomer
);

router.patch(
  '/:id',
  authorize('admin', 'manager', 'cashier'),
  uploadKyc.single('id_card'),
  param('id').isUUID(),
  body('address').optional().trim().notEmpty().withMessage('Address is required'),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  validate,
  ctrl.updateCustomer
);

router.delete(
  '/:id',
  authorize('admin', 'manager'),
  param('id').isUUID(),
  validate,
  ctrl.softDeleteCustomer
);

module.exports = router;
