const express = require('express');
const authRoutes = require('./authRoutes');
const inventoryRoutes = require('./inventoryRoutes');
const customerRoutes = require('./customerRoutes');
const bookingRoutes = require('./bookingRoutes');
const returnRoutes = require('./returnRoutes');
const paymentRoutes = require('./paymentRoutes');
const reportRoutes = require('./reportRoutes');
const settingsRoutes = require('./settingsRoutes');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, service: 'RentFlow API', time: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/customers', customerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/returns', returnRoutes);
router.use('/payments', paymentRoutes);
router.use('/reports', reportRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;
