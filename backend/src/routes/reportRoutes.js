const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/reportController');

const router = express.Router();

router.use(authenticate);

router.get('/dashboard', authorize('admin', 'manager', 'cashier'), ctrl.dashboardMetrics);
router.get('/revenue', authorize('admin', 'manager'), ctrl.revenueSeries);
router.get('/export/inventory', authorize('admin', 'manager'), ctrl.exportInventory);
router.get('/export/payments', authorize('admin', 'manager'), ctrl.exportPaymentLog);
router.get('/export/customers/:customerId', authorize('admin', 'manager'), ctrl.exportCustomer);

module.exports = router;
