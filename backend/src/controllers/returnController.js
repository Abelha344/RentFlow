const path = require('path');
const { query, withTransaction } = require('../config/db');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { invalidateInventoryCache } = require('../config/cache');
const { generateSettlementPdf } = require('../services/pdfService');
const { sendDocument } = require('../services/telegramService');
const { sendSettlementEmail, smtpConfigured } = require('../services/emailService');
const {
  normalizeTelegramChatId,
  telegramChatIdError,
  customerTelegramInviteLink,
} = require('../utils/telegram');
const { summarizeBookingMoney } = require('../utils/bookingMoney');
const { runSettlementAutomation, collectRentalDuringReturn, confirmDepositRefund } = require('../services/settlementService');

async function loadSettlementBundle(bookingId) {
  const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = bookingRes.rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const customerRes = await query(`SELECT * FROM customers WHERE id = $1`, [booking.customer_id]);
  const customer = customerRes.rows[0];
  if (!customer) {
    const err = new Error('Customer not found');
    err.status = 404;
    throw err;
  }

  const [itemsRes, returnsRes, paymentsRes] = await Promise.all([
    query(
      `SELECT bi.*, i.name, i.damage_fee_semi, i.damage_fee_full
       FROM booking_items bi
       JOIN inventory_items i ON i.id = bi.item_id
       WHERE bi.booking_id = $1`,
      [bookingId]
    ),
    query(
      `SELECT rr.*, i.name AS item_name,
              i.damage_fee_semi, i.damage_fee_full
       FROM rental_returns rr
       JOIN inventory_items i ON i.id = rr.item_id
       WHERE rr.booking_id = $1
       ORDER BY rr.returned_at`,
      [bookingId]
    ),
    query(
      `SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at`,
      [bookingId]
    ),
  ]);

  const damageBreakdown = returnsRes.rows.map((r) => {
    const semiQty = Number(r.qty_returned_semi_damaged || 0);
    const fullQty = Number(r.qty_returned_damaged || 0);
    const semiRate = Number(r.damage_fee_semi || 0);
    const fullRate = Number(r.damage_fee_full || 0);
    const semiTotal = Math.round(semiQty * semiRate * 100) / 100;
    const fullTotal = Math.round(fullQty * fullRate * 100) / 100;
    return {
      item_id: r.item_id,
      item_name: r.item_name,
      qty_semi: semiQty,
      qty_full: fullQty,
      fee_semi_each: semiRate,
      fee_full_each: fullRate,
      semi_total: semiTotal,
      full_total: fullTotal,
      line_total: Number(r.damage_fee || semiTotal + fullTotal),
    };
  });

  const totalDamageFee = damageBreakdown.reduce((s, r) => s + Number(r.line_total || 0), 0);
  const totalSemiFees = damageBreakdown.reduce((s, r) => s + Number(r.semi_total || 0), 0);
  const totalFullFees = damageBreakdown.reduce((s, r) => s + Number(r.full_total || 0), 0);
  const rentalBase = Math.max(
    0,
    Math.round((Number(booking.total_amount || 0) - totalDamageFee) * 100) / 100
  );

  return {
    booking,
    customer,
    items: itemsRes.rows,
    returns: returnsRes.rows,
    payments: paymentsRes.rows,
    totalDamageFee,
    damage_breakdown: {
      rental_base: rentalBase,
      semi_total: totalSemiFees,
      full_total: totalFullFees,
      damage_total: totalDamageFee,
      lines: damageBreakdown,
    },
  };
}

function shareOptions(customer) {
  const chatId = normalizeTelegramChatId(customer?.telegram_chat_id);
  return {
    telegram: Boolean(chatId),
    email: Boolean(customer?.email),
    emailConfigured: smtpConfigured(),
    invite_link: customerTelegramInviteLink(customer?.id),
  };
}

/**
 * Return check-in.
 * Body: { items: [{ item_id, qty_returned_good, qty_returned_semi_damaged, qty_returned_damaged, notes }] }
 */
async function processReturn(req, res, next) {
  try {
    const bookingId = req.params.id;
    const { items } = req.body;

    const result = await withTransaction(async (client) => {
      const bRes = await client.query(
        `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId]
      );
      const booking = bRes.rows[0];
      if (!booking) {
        const err = new Error('Booking not found');
        err.status = 404;
        throw err;
      }
      if (['returned', 'cancelled'].includes(booking.status)) {
        const err = new Error(`Cannot process return for status: ${booking.status}`);
        err.status = 400;
        throw err;
      }

      const bookedItems = await client.query(
        `SELECT bi.*, i.damage_fee_semi, i.damage_fee_full, i.name
         FROM booking_items bi
         JOIN inventory_items i ON i.id = bi.item_id
         WHERE bi.booking_id = $1`,
        [bookingId]
      );
      const bookedMap = Object.fromEntries(bookedItems.rows.map((r) => [r.item_id, r]));

      let totalDamageFee = 0;
      const returnRows = [];

      for (const line of items) {
        const booked = bookedMap[line.item_id];
        if (!booked) {
          const err = new Error(`Item ${line.item_id} not on this booking`);
          err.status = 400;
          throw err;
        }

        const g = Number(line.qty_returned_good) || 0;
        const s = Number(line.qty_returned_semi_damaged) || 0;
        const d = Number(line.qty_returned_damaged) || 0;
        const returnedQty = g + s + d;

        if (returnedQty > booked.quantity) {
          const err = new Error(`Return qty exceeds booked qty for ${booked.name}`);
          err.status = 400;
          throw err;
        }

        const damageFee =
          s * Number(booked.damage_fee_semi || 0) + d * Number(booked.damage_fee_full || 0);
        totalDamageFee += damageFee;

        const rr = await client.query(
          `INSERT INTO rental_returns (
             booking_id, item_id, qty_returned_good, qty_returned_semi_damaged,
             qty_returned_damaged, damage_fee, notes, returned_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [bookingId, line.item_id, g, s, d, damageFee, line.notes || null, req.user.id]
        );
        returnRows.push({
          ...rr.rows[0],
          item_name: booked.name,
          fee_semi_each: Number(booked.damage_fee_semi || 0),
          fee_full_each: Number(booked.damage_fee_full || 0),
          semi_total: s * Number(booked.damage_fee_semi || 0),
          full_total: d * Number(booked.damage_fee_full || 0),
        });

        if (s > 0 || d > 0) {
          await client.query(
            `UPDATE inventory_items SET
               qty_good = GREATEST(qty_good - $1 - $2, 0),
               qty_semi_damaged = qty_semi_damaged + $1,
               qty_damaged = qty_damaged + $2
             WHERE id = $3`,
            [s, d, line.item_id]
          );
        }
      }

      const updated = await client.query(
        `UPDATE bookings
         SET status = 'returned', updated_at = NOW(),
             total_amount = total_amount + $1
         WHERE id = $2
         RETURNING *`,
        [totalDamageFee, bookingId]
      );

      // Damage is added into booking.total_amount (owed with rental).
      // Do not create a separate pending damage_fee payment — that double-counted.

      return { booking: updated.rows[0], returns: returnRows, totalDamageFee };
    });

    await writeAuditLog({
      userId: req.user.id,
      action: 'booking.return',
      targetTable: 'rental_returns',
      details: { booking_id: bookingId, damage_fee: result.totalDamageFee },
      ipAddress: clientIp(req),
    });

    const io = req.app.get('io');
    io?.emit('booking:returned', result.booking);
    io?.emit('inventory:updated', { bookingId });
    invalidateInventoryCache();

    const bundle = await loadSettlementBundle(bookingId);

    // Automatic priority: apply deposit → rental leftover → queue refund
    let settlement = null;
    try {
      settlement = await runSettlementAutomation(bookingId, req.user.id, {
        applyDeposit: true,
        queueRefund: true,
      });
    } catch (autoErr) {
      console.warn('[settlement-auto]', autoErr.message);
    }

    const refreshed = await loadSettlementBundle(bookingId);
    const money = summarizeBookingMoney(refreshed.booking, refreshed.payments);

    res.json({
      success: true,
      data: {
        ...result,
        customer: {
          id: bundle.customer.id,
          full_name: bundle.customer.full_name,
          email: bundle.customer.email,
          phone: bundle.customer.phone,
          telegram_chat_id: bundle.customer.telegram_chat_id,
        },
        payments: refreshed.payments,
        money,
        damage_breakdown: refreshed.damage_breakdown,
        returns: refreshed.returns,
        totalDamageFee: refreshed.totalDamageFee,
        settlement,
        share: shareOptions(bundle.customer),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function completeSettlement(req, res, next) {
  try {
    const bookingId = req.params.id;
    const method = req.body.method || 'cash';

    const settlement = await runSettlementAutomation(bookingId, req.user.id, {
      applyDeposit: true,
      queueRefund: true,
      method,
    });

    const io = req.app.get('io');
    io?.emit('payment:updated', { booking_id: bookingId, settlement });

    const refreshed = await loadSettlementBundle(bookingId);
    const money = summarizeBookingMoney(refreshed.booking, refreshed.payments);

    res.json({
      success: true,
      message: settlement.next?.message || 'Settlement updated',
      data: {
        ...settlement,
        money,
        payments: refreshed.payments,
        damage_breakdown: refreshed.damage_breakdown,
        totalDamageFee: refreshed.totalDamageFee,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function listReturns(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT rr.*, i.name AS item_name, i.barcode, b.status AS booking_status,
              c.full_name AS customer_name
       FROM rental_returns rr
       JOIN inventory_items i ON i.id = rr.item_id
       JOIN bookings b ON b.id = rr.booking_id
       JOIN customers c ON c.id = b.customer_id
       ORDER BY rr.returned_at DESC
       LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Optional share of full settlement (returns + all payments) via telegram and/or email.
 * Body: { channel: 'telegram' | 'email' }
 */
async function shareSettlement(req, res, next) {
  try {
    const bookingId = req.params.id;
    const channel = String(req.body.channel || '').toLowerCase();
    if (!['telegram', 'email'].includes(channel)) {
      return res.status(400).json({
        success: false,
        message: 'channel must be telegram or email',
      });
    }

    const bundle = await loadSettlementBundle(bookingId);
    if (bundle.booking.status !== 'returned') {
      return res.status(400).json({
        success: false,
        message: 'Settlement sharing is available after the booking is returned',
      });
    }

    const filePath = await generateSettlementPdf(bundle);
    const relative = `/uploads/receipts/${path.basename(filePath)}`;
    const { customer, payments, totalDamageFee, damage_breakdown } = bundle;
    const paidFromDeposit = payments
      .filter(
        (p) =>
          p.status === 'approved' &&
          String(p.reference_number || '').startsWith('APPLIED-FROM-DEPOSIT')
      )
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const depositRefunded = payments
      .filter(
        (p) =>
          p.status === 'approved' &&
          p.type === 'deposit_refund' &&
          !String(p.reference_number || '').startsWith('APPLIED-TO-RENTAL')
      )
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    const rentalBase = Number(damage_breakdown?.rental_base ?? bundle.booking.total_amount);
    const semiTotal = Number(damage_breakdown?.semi_total || 0);
    const fullTotal = Number(damage_breakdown?.full_total || 0);
    const caption =
      `RentFlow settlement for ${customer.full_name}\n` +
      `Equipment rental: ${rentalBase.toFixed(2)} ETB\n` +
      (semiTotal > 0.009 ? `Semi-damage fees: ${semiTotal.toFixed(2)} ETB\n` : '') +
      (fullTotal > 0.009 ? `Full damage fees: ${fullTotal.toFixed(2)} ETB\n` : '') +
      `Total charges: ${Number(bundle.booking.total_amount).toFixed(2)} ETB\n` +
      (paidFromDeposit > 0.009
        ? `Paid from deposit: ${paidFromDeposit.toFixed(2)} ETB\n`
        : '') +
      (depositRefunded > 0.009
        ? `Deposit refund: ${depositRefunded.toFixed(2)} ETB\n`
        : '') +
      (Number(totalDamageFee) > 0.009
        ? `Damage total: ${Number(totalDamageFee).toFixed(2)} ETB`
        : 'No damage fees');

    if (channel === 'telegram') {
      const chatId = normalizeTelegramChatId(customer.telegram_chat_id);
      const invite = customerTelegramInviteLink(customer.id);

      if (!chatId) {
        return res.status(409).json({
          success: false,
          code: 'TELEGRAM_NOT_LINKED',
          message:
            'Customer has not opened Telegram yet. Send them the invite link once. After they tap it, click Share via Telegram again — no need to type any ID.',
          share: shareOptions(customer),
          invite_link: invite,
        });
      }

      try {
        const sent = await sendDocument(chatId, filePath, caption);
        if (sent?.skipped) {
          return res.status(503).json({
            success: false,
            message: 'Telegram bot is not configured (set TELEGRAM_BOT_TOKEN)',
          });
        }
      } catch (err) {
        const apiMsg = err?.message || String(err);
        if (/chat not found/i.test(apiMsg)) {
          await query(`UPDATE customers SET telegram_chat_id = NULL WHERE id = $1`, [customer.id]);
          return res.status(409).json({
            success: false,
            code: 'TELEGRAM_NOT_LINKED',
            message:
              'Telegram chat not found. Send the customer their invite link once, then click Share again.',
            share: shareOptions({ ...customer, telegram_chat_id: null }),
            invite_link: invite,
          });
        }
        throw err;
      }
      await writeAuditLog({
        userId: req.user.id,
        action: 'settlement.share_telegram',
        targetTable: 'bookings',
        details: { booking_id: bookingId },
        ipAddress: clientIp(req),
      });
      return res.json({
        success: true,
        message: 'Settlement shared via Telegram',
        data: { url: relative, channel: 'telegram' },
      });
    }

    // email
    if (!customer.email) {
      return res.status(400).json({
        success: false,
        message: 'This customer has no email on file',
        share: shareOptions(customer),
      });
    }
    const mail = await sendSettlementEmail({
      to: customer.email,
      customerName: customer.full_name,
      subject: `RentFlow settlement — ${customer.full_name}`,
      text: `Hello ${customer.full_name},\n\n${caption}\n\nThe full settlement PDF is attached.\n\nThank you for choosing RentFlow.`,
      filePath,
    });
    if (mail.skipped) {
      return res.status(503).json({
        success: false,
        message: mail.reason || 'Email sending is not configured',
        share: shareOptions(customer),
      });
    }
    await writeAuditLog({
      userId: req.user.id,
      action: 'settlement.share_email',
      targetTable: 'bookings',
      details: { booking_id: bookingId, email: customer.email },
      ipAddress: clientIp(req),
    });
    return res.json({
      success: true,
      message: `Settlement emailed to ${customer.email}`,
      data: { url: relative, channel: 'email' },
    });
  } catch (err) {
    next(err);
  }
}

async function collectRental(req, res, next) {
  try {
    const bookingId = req.params.id;
    const autoApprove = ['admin', 'manager'].includes(req.user.role);
    const data = await collectRentalDuringReturn(bookingId, req.user.id, {
      amount: req.body.amount,
      method: req.body.method || 'cash',
      reference_number: req.body.reference_number,
      autoApprove,
    });

    const io = req.app.get('io');
    io?.emit('payment:updated', { booking_id: bookingId });

    res.json({
      success: true,
      message: data.next?.message || 'Rental payment recorded',
      data,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function confirmRefund(req, res, next) {
  try {
    const bookingId = req.params.id;
    const autoApprove = ['admin', 'manager'].includes(req.user.role);
    if (!autoApprove && req.body.force_approve) {
      return res.status(403).json({
        success: false,
        message: 'Only manager/admin can approve deposit refund',
      });
    }

    const data = await confirmDepositRefund(bookingId, req.user.id, {
      method: req.body.method || 'cash',
      autoApprove,
    });

    const io = req.app.get('io');
    io?.emit('payment:updated', { booking_id: bookingId });

    res.json({
      success: true,
      message: data.next?.message || 'Refund updated',
      data,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * Generate settlement PDF for print (same pattern as lease / work order).
 */
async function printSettlement(req, res, next) {
  try {
    const bookingId = req.params.id;
    const bundle = await loadSettlementBundle(bookingId);
    if (bundle.booking.status !== 'returned') {
      return res.status(400).json({
        success: false,
        message: 'Settlement print is available after return check-in',
      });
    }

    const filePath = await generateSettlementPdf(bundle);
    const relative = `/uploads/receipts/${path.basename(filePath)}`;

    res.json({
      success: true,
      data: {
        url: relative,
        path: filePath,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = {
  processReturn,
  listReturns,
  shareSettlement,
  printSettlement,
  completeSettlement,
  collectRental,
  confirmRefund,
};
