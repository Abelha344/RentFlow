const dayjs = require('dayjs');
const { query, withTransaction } = require('../config/db');
const { checkStockAvailability } = require('../services/stockService');
const { generateWorkOrderPdf } = require('../services/pdfService');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { invalidateInventoryCache } = require('../config/cache');
const { dispatchTelegram } = require('../services/asyncJobs');
const {
  BOOKING_MONEY_SQL,
  attachPayStatus,
  summarizeBookingMoney,
} = require('../utils/bookingMoney');

async function getCollateralMultiplier() {
  const { rows } = await query(
    `SELECT value_json FROM store_settings WHERE key = 'low_rating_collateral_multiplier'`
  );
  return Number(rows[0]?.value_json) || 2;
}

async function getCollateralTiers() {
  const { rows } = await query(
    `SELECT key, value_json FROM store_settings
     WHERE key IN ('collateral_tier_low', 'collateral_tier_medium', 'collateral_tier_higher')`
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value_json)]));
  return {
    low: Number.isFinite(map.collateral_tier_low) ? map.collateral_tier_low : 500,
    medium: Number.isFinite(map.collateral_tier_medium) ? map.collateral_tier_medium : 1500,
    higher: Number.isFinite(map.collateral_tier_higher) ? map.collateral_tier_higher : 5000,
  };
}

function resolveDepositFromTier(tier, tiers, explicitAmount) {
  if (explicitAmount != null && explicitAmount !== '' && Number.isFinite(Number(explicitAmount))) {
    return { deposit: Number(explicitAmount), tier: tier || 'custom' };
  }
  const key = String(tier || '').toLowerCase();
  if (key === 'low' || key === 'medium' || key === 'higher') {
    return { deposit: Number(tiers[key]), tier: key };
  }
  return null;
}

async function listBookings(req, res, next) {
  try {
    const { status, from, to, customer_id } = req.query;
    const params = [];
    const clauses = ['1=1'];

    if (status) {
      params.push(status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`b.end_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      clauses.push(`b.start_date <= $${params.length}`);
    }
    if (customer_id) {
      params.push(customer_id);
      clauses.push(`b.customer_id = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone, c.rating AS customer_rating,
              u.full_name AS created_by_name,
              ${BOOKING_MONEY_SQL}
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN users u ON u.id = b.created_by
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.start_date DESC`,
      params
    );
    res.json({ success: true, data: rows.map(attachPayStatus) });
  } catch (err) {
    next(err);
  }
}

async function calendarEvents(req, res, next) {
  try {
    const { start, end } = req.query;
    const { rows } = await query(
      `SELECT b.id, b.start_date, b.end_date, b.buffer_end_date, b.status, b.total_amount,
              c.full_name AS customer_name
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       WHERE b.status NOT IN ('cancelled')
         AND ($1::timestamptz IS NULL OR b.buffer_end_date >= $1)
         AND ($2::timestamptz IS NULL OR b.start_date <= $2)`,
      [start || null, end || null]
    );

    const events = rows.map((b) => ({
      id: b.id,
      title: `${b.customer_name} (${b.status})`,
      start: b.start_date,
      end: b.buffer_end_date,
      extendedProps: {
        status: b.status,
        rentalEnd: b.end_date,
        bufferEnd: b.buffer_end_date,
        total_amount: b.total_amount,
      },
    }));

    res.json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
}

async function getBooking(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email, c.rating AS customer_rating
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const items = await query(
      `SELECT bi.*, i.name, i.damage_fee_semi, i.damage_fee_full
       FROM booking_items bi
       JOIN inventory_items i ON i.id = bi.item_id
       WHERE bi.booking_id = $1`,
      [req.params.id]
    );
    const payments = await query(
      `SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    const returns = await query(
      `SELECT rr.*, i.name AS item_name
       FROM rental_returns rr
       JOIN inventory_items i ON i.id = rr.item_id
       WHERE rr.booking_id = $1`,
      [req.params.id]
    );

    const money = summarizeBookingMoney(rows[0], payments.rows);

    res.json({
      success: true,
      data: {
        ...rows[0],
        ...money,
        requires_higher_collateral: rows[0].customer_rating < 3,
        items: items.rows,
        payments: payments.rows,
        returns: returns.rows,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function checkAvailability(req, res, next) {
  try {
    const { items, start_date, end_date, exclude_booking_id } = req.body;
    const itemIds = items.map((i) => i.item_id);
    const meta = await query(
      `SELECT id, buffer_time_hours FROM inventory_items WHERE id = ANY($1::uuid[])`,
      [itemIds]
    );
    const maxBuffer = Math.max(0, ...meta.rows.map((r) => r.buffer_time_hours), 24);
    const bufferEnd = dayjs(end_date).add(maxBuffer, 'hour').toISOString();

    const result = await checkStockAvailability(items, start_date, bufferEnd, exclude_booking_id || null);
    res.json({ success: true, data: { ...result, buffer_end_date: bufferEnd } });
  } catch (err) {
    next(err);
  }
}

async function createBooking(req, res, next) {
  try {
    const {
      customer_id,
      start_date,
      end_date,
      items,
      collateral_deposit,
      collateral_tier,
      notes,
      status = 'confirmed',
    } = req.body;

    const customerRes = await query(
      `SELECT * FROM customers WHERE id = $1 AND is_deleted = FALSE`,
      [customer_id]
    );
    const customer = customerRes.rows[0];
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const itemIds = items.map((i) => i.item_id);
    const invRes = await query(
      `SELECT id, name, rental_rate_per_day, buffer_time_hours
       FROM inventory_items WHERE id = ANY($1::uuid[]) AND is_deleted = FALSE`,
      [itemIds]
    );
    if (invRes.rows.length !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'One or more items not found' });
    }

    const invMap = Object.fromEntries(invRes.rows.map((r) => [r.id, r]));
    const maxBuffer = Math.max(...invRes.rows.map((r) => r.buffer_time_hours));
    const bufferEnd = dayjs(end_date).add(maxBuffer, 'hour').toISOString();
    const rentalDays = Math.max(1, dayjs(end_date).diff(dayjs(start_date), 'day', true));

    const lines = items.map((line) => {
      const inv = invMap[line.item_id];
      const unit = Number(line.unit_price ?? inv.rental_rate_per_day);
      const subtotal = Number((unit * line.quantity * rentalDays).toFixed(2));
      return { ...line, unit_price: unit, subtotal };
    });
    const totalAmount = lines.reduce((s, l) => s + l.subtotal, 0);

    const tiers = await getCollateralTiers();
    const resolved = resolveDepositFromTier(collateral_tier, tiers, collateral_deposit);
    if (!resolved) {
      return res.status(400).json({
        success: false,
        message: 'Select a security deposit tier: low, medium, or higher',
        data: { tiers },
      });
    }
    let deposit = resolved.deposit;
    let collateralMultiplier = 1;
    // Low customer rating → bump to at least the higher tier (unless admin set an explicit amount)
    if (
      customer.rating < 3 &&
      collateral_deposit == null &&
      resolved.tier !== 'higher' &&
      resolved.tier !== 'custom'
    ) {
      collateralMultiplier = await getCollateralMultiplier();
      deposit = Math.max(
        deposit,
        tiers.higher,
        Number((totalAmount * 0.3 * collateralMultiplier).toFixed(2))
      );
    }

    // SERIALIZABLE: recalculate availability inside the tx before insert (no Redis locks)
    const booking = await withTransaction(
      async (client) => {
        const avail = await checkStockAvailability(lines, start_date, bufferEnd, null, client);
        if (!avail.allOk) {
          const err = new Error('Insufficient stock for selected dates (including buffer)');
          err.status = 409;
          err.details = avail.items;
          throw err;
        }

        const bRes = await client.query(
          `INSERT INTO bookings (
             customer_id, start_date, end_date, buffer_end_date, status,
             total_amount, collateral_deposit, notes, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            customer_id,
            start_date,
            end_date,
            bufferEnd,
            status,
            totalAmount,
            deposit,
            notes || null,
            req.user.id,
          ]
        );
        const created = bRes.rows[0];

        for (const line of lines) {
          await client.query(
            `INSERT INTO booking_items (booking_id, item_id, quantity, unit_price, subtotal)
             VALUES ($1,$2,$3,$4,$5)`,
            [created.id, line.item_id, line.quantity, line.unit_price, line.subtotal]
          );
        }

        return created;
      },
      { isolationLevel: 'SERIALIZABLE' }
    );

    await writeAuditLog({
      userId: req.user.id,
      action: 'booking.create',
      targetTable: 'bookings',
      details: {
        booking_id: booking.id,
        total_amount: booking.total_amount,
        low_rating_warning: customer.rating < 3,
      },
      ipAddress: clientIp(req),
    });

    invalidateInventoryCache();
    const io = req.app.get('io');
    io?.emit('booking:created', booking);

    for (const line of lines) {
      const snap = await checkStockAvailability(
        [{ item_id: line.item_id, quantity: 0 }],
        start_date,
        bufferEnd
      );
      const info = snap.items[0];
      if (info && info.available < info.minStockThreshold) {
        io?.emit('stock:low', {
          itemId: info.itemId,
          name: info.name,
          available: info.available,
          threshold: info.minStockThreshold,
        });
        dispatchTelegram(
          {
            type: 'low_stock',
            message: `⚠️ Low stock after booking: <b>${info.name}</b> — available ${info.available}`,
          },
          io
        );
      }
    }

    res.status(201).json({
      success: true,
      data: {
        ...booking,
        requires_higher_collateral: customer.rating < 3,
        collateral_tier: resolved.tier,
        collateral_multiplier: collateralMultiplier,
      },
    });
  } catch (err) {
    if (err.details) {
      return res.status(err.status || 409).json({
        success: false,
        message: err.message,
        availability: err.details,
      });
    }
    next(err);
  }
}

async function updateBookingStatus(req, res, next) {
  try {
    const { status } = req.body;

    if (status === 'out_for_rent') {
      const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [req.params.id]);
      const booking = bookingRes.rows[0];
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }
      const payRes = await query(`SELECT * FROM payments WHERE booking_id = $1`, [req.params.id]);
      const money = summarizeBookingMoney(booking, payRes.rows);
      if (!money.can_dispatch) {
        return res.status(400).json({
          success: false,
          code: 'DEPOSIT_REQUIRED',
          message: `Security deposit must be paid before dispatch. Unpaid deposit: ${money.deposit_unpaid.toFixed(2)} ETB`,
          money,
        });
      }
    }

    const { rows } = await query(
      `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (status === 'cancelled') {
      await writeAuditLog({
        userId: req.user.id,
        action: 'booking.cancel',
        targetTable: 'bookings',
        details: { booking_id: req.params.id },
        ipAddress: clientIp(req),
      });
    }

    const io = req.app.get('io');
    io?.emit('booking:updated', rows[0]);

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function cancelBooking(req, res, next) {
  req.body.status = 'cancelled';
  return updateBookingStatus(req, res, next);
}

async function generateWorkOrder(req, res, next) {
  try {
    const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [req.params.id]);
    if (!bookingRes.rows[0]) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = bookingRes.rows[0];
    const customer = (
      await query(`SELECT * FROM customers WHERE id = $1`, [booking.customer_id])
    ).rows[0];
    const items = (
      await query(
        `SELECT bi.quantity, i.name
         FROM booking_items bi
         JOIN inventory_items i ON i.id = bi.item_id
         WHERE bi.booking_id = $1`,
        [booking.id]
      )
    ).rows;
    const payRes = await query(`SELECT * FROM payments WHERE booking_id = $1`, [booking.id]);
    const moneySnap = summarizeBookingMoney(booking, payRes.rows);
    const depositPayments = payRes.rows.filter(
      (p) => p.type === 'collateral_deposit' && p.status === 'approved'
    );

    const filePath = await generateWorkOrderPdf({
      booking,
      customer,
      items,
      createdBy: req.user.full_name,
      money: moneySnap,
      depositPayments,
    });

    const relative = `/uploads/receipts/${require('path').basename(filePath)}`;
    res.json({
      success: true,
      data: {
        url: relative,
        path: filePath,
        deposit_paid: moneySnap.deposit_unpaid <= 0.009,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateDeposit(req, res, next) {
  try {
    const amount = Number(req.body.collateral_deposit);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Security deposit must be a number 0 or greater',
      });
    }

    const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [req.params.id]);
    const booking = bookingRes.rows[0];
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change deposit on a cancelled booking',
      });
    }

    const payRes = await query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS paid
       FROM payments
       WHERE booking_id = $1 AND status = 'approved' AND type = 'collateral_deposit'`,
      [booking.id]
    );
    const alreadyPaid = Number(payRes.rows[0]?.paid || 0);
    if (amount + 0.001 < alreadyPaid) {
      return res.status(400).json({
        success: false,
        message: `Deposit cannot be below amount already paid (${alreadyPaid.toFixed(2)} ETB)`,
      });
    }

    const { rows } = await query(
      `UPDATE bookings SET collateral_deposit = $1 WHERE id = $2 RETURNING *`,
      [amount, booking.id]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: 'booking.deposit_updated',
      targetTable: 'bookings',
      details: {
        booking_id: booking.id,
        from: Number(booking.collateral_deposit),
        to: amount,
      },
      ipAddress: clientIp(req),
    });

    const money = summarizeBookingMoney(rows[0], (
      await query(`SELECT * FROM payments WHERE booking_id = $1`, [booking.id])
    ).rows);

    res.json({
      success: true,
      data: attachPayStatus({
        ...rows[0],
        deposit_paid: money.deposit_paid,
        deposit_refunded: money.deposit_refunded,
        rental_paid: money.rental_paid,
        pending_total: money.pending_total,
        deposit_expected: money.deposit_expected,
        deposit_unpaid: money.deposit_unpaid,
        rental_total: money.rental_total,
        rental_unpaid: money.rental_unpaid,
      }),
      message: 'Security deposit updated',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listBookings,
  calendarEvents,
  getBooking,
  checkAvailability,
  createBooking,
  updateBookingStatus,
  updateDeposit,
  cancelBooking,
  generateWorkOrder,
};
