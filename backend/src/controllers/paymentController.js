const { query } = require('../config/db');
const { dispatchPaymentReceipt } = require('../services/asyncJobs');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { summarizeBookingMoney } = require('../utils/bookingMoney');
const { runSettlementAutomation } = require('../services/settlementService');

async function listPayments(req, res, next) {
  try {
    const { booking_id, status, method, from, to } = req.query;
    const params = [];
    const clauses = ['1=1'];

    if (booking_id) {
      params.push(booking_id);
      clauses.push(`p.booking_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`p.status = $${params.length}`);
    }
    if (method) {
      params.push(method);
      clauses.push(`p.method = $${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`p.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      clauses.push(`p.created_at <= $${params.length}`);
    }

    const { rows } = await query(
      `SELECT p.*, b.status AS booking_status,
              COALESCE(c_book.full_name, c_pay.full_name, 'Unknown') AS customer_name,
              COALESCE(c_book.id, c_pay.id) AS customer_id_resolved,
              COALESCE(c_book.telegram_chat_id, c_pay.telegram_chat_id) AS customer_telegram_chat_id,
              c_book.phone AS customer_phone
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN customers c_book ON c_book.id = b.customer_id
       LEFT JOIN customers c_pay ON c_pay.id = p.customer_id
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE ${clauses.join(' AND ')}
       ORDER BY p.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

async function createPayment(req, res, next) {
  try {
    const { booking_id, amount, type, method, reference_number } = req.body;
    const receiptUrl = req.file ? `/uploads/receipts/${req.file.filename}` : null;

    const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [booking_id]);
    const booking = bookingRes.rows[0];
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const payRes = await query(`SELECT * FROM payments WHERE booking_id = $1`, [booking_id]);
    const money = summarizeBookingMoney(booking, payRes.rows);
    const amt = Number(amount);

    if (type === 'collateral_deposit') {
      if (money.deposit_unpaid <= 0.009) {
        return res.status(400).json({
          success: false,
          message: 'Security deposit is already fully paid for this booking.',
        });
      }
      if (amt > money.deposit_unpaid + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Deposit unpaid is only ${money.deposit_unpaid.toFixed(2)} ETB.`,
        });
      }
    }

    if (type === 'deposit_refund') {
      if (booking.status !== 'returned') {
        return res.status(400).json({
          success: false,
          message:
            'Deposit refund is only allowed after return check-in. Return the equipment first.',
        });
      }
      if (money.deposit_refundable <= 0.009) {
        return res.status(400).json({
          success: false,
          message: 'No deposit available to refund.',
        });
      }
      const pendingRefund = await query(
        `SELECT id FROM payments
         WHERE booking_id = $1 AND type = 'deposit_refund' AND status = 'pending'
         LIMIT 1`,
        [booking_id]
      );
      if (pendingRefund.rows[0]) {
        return res.status(409).json({
          success: false,
          message: 'A deposit refund is already waiting for approval. Do not create another.',
        });
      }
      if (amt > money.deposit_refundable + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Refundable deposit is only ${money.deposit_refundable.toFixed(2)} ETB.`,
        });
      }
    }

    const dup = await query(
      `SELECT id FROM payments
       WHERE booking_id = $1
         AND status = 'pending'
         AND amount = $2
         AND type = $3
         AND method = $4
         AND created_at > NOW() - INTERVAL '2 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [booking_id, amount, type, method]
    );
    if (dup.rows[0]) {
      return res.status(409).json({
        success: false,
        message:
          'This payment was already saved. Do not click Save again — wait for manager approval.',
        data: dup.rows[0],
      });
    }

    const { rows } = await query(
      `INSERT INTO payments (
         booking_id, customer_id, amount, type, method, reference_number, receipt_url, recorded_by, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING *`,
      [
        booking_id,
        booking.customer_id,
        amount,
        type,
        method,
        reference_number || null,
        receiptUrl,
        req.user.id,
      ]
    );

    const io = req.app.get('io');
    io?.emit('payment:uploaded', {
      payment: rows[0],
      message: 'New payment proof uploaded — pending approval',
    });

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * Approve / reject pending payment.
 * Body (JSON or multipart): status, optional reference_number, booking_id, type, method, amount
 * Optional file field "official_receipt" → stored as pdf_receipt_url (or receipt override)
 */
async function approvePayment(req, res, next) {
  try {
    const status = req.body.status; // approved | rejected
    const verifiedTxn = req.body.reference_number;
    const assignBookingId = req.body.booking_id;
    const nextType = req.body.type;
    const nextMethod = req.body.method;
    const nextAmount = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : null;
    const officialFile = req.file;

    const existing = await query(
      `SELECT p.*, b.status AS booking_status, b.customer_id AS booking_customer_id
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    const payment = existing.rows[0];
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (status === 'approved') {
      const bookingId = assignBookingId || payment.booking_id;
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Assign a booking before approving this Telegram payment.',
        });
      }

      const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
      const booking = bookingRes.rows[0];
      if (!booking) {
        return res.status(400).json({ success: false, message: 'Booking not found' });
      }

      if (
        payment.type === 'deposit_refund' &&
        booking.status !== 'returned' &&
        (!nextType || nextType === 'deposit_refund')
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Deposit refund can only be approved after return check-in. Return the equipment first.',
        });
      }

      const txn =
        verifiedTxn != null && String(verifiedTxn).trim()
          ? String(verifiedTxn).trim()
          : payment.reference_number;
      if (!txn) {
        return res.status(400).json({
          success: false,
          message: 'Enter the verified transaction ID before approving.',
        });
      }

      const sets = ['status = $1', 'reference_number = $2', 'booking_id = $3'];
      const params = [status, txn, bookingId];

      // payments has recorded_by / customer_id — not customer_by
      params.push(req.user.id);
      sets.push(`recorded_by = COALESCE(recorded_by, $${params.length})`);

      if (nextType) {
        params.push(nextType);
        sets.push(`type = $${params.length}`);
      }
      if (nextMethod) {
        params.push(nextMethod);
        sets.push(`method = $${params.length}`);
      }
      if (nextAmount != null && Number.isFinite(nextAmount) && nextAmount > 0) {
        params.push(nextAmount);
        sets.push(`amount = $${params.length}`);
      }
      params.push(booking.customer_id);
      sets.push(`customer_id = COALESCE(customer_id, $${params.length})`);

      if (officialFile) {
        const relative = `/uploads/receipts/${officialFile.filename}`;
        params.push(relative);
        sets.push(`pdf_receipt_url = $${params.length}`);
      }

      params.push(req.params.id);
      const { rows } = await query(
        `UPDATE payments SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );

      await writeAuditLog({
        userId: req.user.id,
        action: `payment.${status}`,
        targetTable: 'payments',
        details: {
          payment_id: rows[0].id,
          amount: rows[0].amount,
          reference_number: rows[0].reference_number,
        },
        ipAddress: clientIp(req),
      });

      const io = req.app.get('io');
      // Generate official PDF (unless agent uploaded one) and send to customer Telegram
      dispatchPaymentReceipt(rows[0].id, io, {
        skipGeneratePdf: Boolean(officialFile),
        uploadedPdfRelative: officialFile
          ? `/uploads/receipts/${officialFile.filename}`
          : null,
      });

      const rentalTypes = new Set([
        'down_payment',
        'installment',
        'final_settlement',
        'late_fee',
        'damage_fee',
      ]);
      if (rentalTypes.has(rows[0].type) && booking.status === 'returned') {
        try {
          await runSettlementAutomation(rows[0].booking_id, req.user.id, {
            applyDeposit: true,
            queueRefund: true,
          });
        } catch (autoErr) {
          console.warn('[settlement-auto-on-approve]', autoErr.message);
        }
      }

      io?.emit('payment:updated', rows[0]);
      return res.json({
        success: true,
        message: 'Payment approved — official receipt will be sent to the customer on Telegram.',
        data: rows[0],
      });
    }

    // reject
    const { rows } = await query(
      `UPDATE payments SET status = $1, recorded_by = COALESCE(recorded_by, $2) WHERE id = $3 RETURNING *`,
      [status, req.user.id, req.params.id]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: `payment.${status}`,
      targetTable: 'payments',
      details: { payment_id: rows[0].id, amount: rows[0].amount },
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io');
    io?.emit('payment:updated', rows[0]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function getPayment(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.*, b.status AS booking_status,
              COALESCE(c_book.full_name, c_pay.full_name) AS customer_name
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN customers c_book ON c_book.id = b.customer_id
       LEFT JOIN customers c_pay ON c_pay.id = p.customer_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPayments, createPayment, approvePayment, getPayment };
