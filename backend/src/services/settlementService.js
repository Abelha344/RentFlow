const { query } = require('../config/db');
const { summarizeBookingMoney } = require('../utils/bookingMoney');

/**
 * Professional settlement priority after return:
 * 1) Apply held deposit to any unpaid rental (no cash movement)
 * 2) If rental still unpaid → agent must collect cash/transfer
 * 3) When rental is clear → queue deposit refund for remaining hold
 */

async function loadBookingMoney(bookingId) {
  const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = bookingRes.rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  const payRes = await query(`SELECT * FROM payments WHERE booking_id = $1`, [bookingId]);
  return {
    booking,
    payments: payRes.rows,
    money: summarizeBookingMoney(booking, payRes.rows),
  };
}

async function hasPendingRefund(bookingId) {
  const { rows } = await query(
    `SELECT id FROM payments
     WHERE booking_id = $1 AND type = 'deposit_refund' AND status = 'pending'
     LIMIT 1`,
    [bookingId]
  );
  return rows[0] || null;
}

/**
 * Apply deposit to unpaid rental (auto-approved ledger entries).
 * Returns amount applied.
 */
async function applyDepositToRental(bookingId, userId, amount) {
  const applied = Number(amount);
  if (applied <= 0.009) return 0;

  await query(
    `INSERT INTO payments (
       booking_id, amount, type, method, reference_number, recorded_by, status
     ) VALUES ($1,$2,'final_settlement','cash','APPLIED-FROM-DEPOSIT',$3,'approved')`,
    [bookingId, applied, userId]
  );
  await query(
    `INSERT INTO payments (
       booking_id, amount, type, method, reference_number, recorded_by, status
     ) VALUES ($1,$2,'deposit_refund','cash','APPLIED-TO-RENTAL',$3,'approved')`,
    [bookingId, applied, userId]
  );
  return applied;
}

/**
 * Queue a pending cash refund for remaining held deposit (if not already queued).
 */
async function queueDepositRefund(bookingId, userId, amount, method = 'cash') {
  const refundAmt = Number(amount);
  if (refundAmt <= 0.009) return null;

  const bookingRes = await query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
  if (bookingRes.rows[0]?.status !== 'returned') {
    const err = new Error('Deposit refund can only be queued after return check-in');
    err.status = 400;
    throw err;
  }

  const existing = await hasPendingRefund(bookingId);
  if (existing) return existing;

  const { rows } = await query(
    `INSERT INTO payments (
       booking_id, amount, type, method, reference_number, recorded_by, status
     ) VALUES ($1,$2,'deposit_refund',$3,'AUTO-REFUND',$4,'pending')
     RETURNING *`,
    [bookingId, refundAmt, method, userId]
  );
  return rows[0];
}

/**
 * Run automatic settlement steps after return / after rental approval.
 * @param {{ applyDeposit?: boolean, queueRefund?: boolean, method?: string }} options
 */
async function runSettlementAutomation(bookingId, userId, options = {}) {
  const applyDeposit = options.applyDeposit !== false;
  const queueRefund = options.queueRefund !== false;
  const method = options.method || 'cash';

  let { booking, money } = await loadBookingMoney(bookingId);
  if (booking.status !== 'returned') {
    const err = new Error('Settlement automation only runs after return check-in');
    err.status = 400;
    throw err;
  }

  const steps = [];

  // Priority 1: cover unpaid rental with held deposit
  if (applyDeposit && money.rental_unpaid > 0.009 && money.deposit_held > 0.009) {
    const applied = Math.min(money.rental_unpaid, money.deposit_held);
    await applyDepositToRental(bookingId, userId, applied);
    steps.push({
      action: 'deposit_applied',
      amount: applied,
      message: `Paid ${applied.toFixed(2)} ETB rental from deposit`,
    });
    ({ money } = await loadBookingMoney(bookingId));
  }

  // Priority 2: rental still unpaid → stop; agent collects cash
  if (money.rental_unpaid > 0.009) {
    return {
      done: false,
      priority: 'collect_rental',
      money,
      steps,
      next: {
        intent: 'rental',
        amount: money.rental_unpaid,
        message: `Collect remaining rental ${money.rental_unpaid.toFixed(2)} ETB first`,
      },
    };
  }

  // Priority 3: queue deposit refund for what is still held
  if (queueRefund && money.deposit_held > 0.009) {
    const refund = await queueDepositRefund(bookingId, userId, money.deposit_held, method);
    if (refund) {
      steps.push({
        action: 'refund_queued',
        amount: Number(refund.amount),
        payment_id: refund.id,
        message: `Deposit refund queued: ${Number(refund.amount).toFixed(2)} ETB — approve to pay customer`,
      });
    }
    ({ money } = await loadBookingMoney(bookingId));
    return {
      done: false,
      priority: 'approve_refund',
      money,
      steps,
      next: {
        intent: 'refund',
        amount: money.deposit_held || Number(refund?.amount || 0),
        message: 'Approve deposit refund to complete settlement',
        payment_id: refund?.id,
      },
    };
  }

  return {
    done: true,
    priority: 'complete',
    money,
    steps,
    next: { message: 'Settlement complete' },
  };
}

/**
 * Collect remaining rental during return, then continue automation (refund queue).
 * Managers/admins: payment auto-approved. Cashiers: pending until approved.
 */
async function collectRentalDuringReturn(bookingId, userId, { amount, method, reference_number, autoApprove }) {
  let { booking, money } = await loadBookingMoney(bookingId);
  if (booking.status !== 'returned') {
    const err = new Error('Collect rental only after return check-in');
    err.status = 400;
    throw err;
  }

  // First apply any deposit still held
  const pre = await runSettlementAutomation(bookingId, userId, {
    applyDeposit: true,
    queueRefund: false,
  });
  ({ money } = await loadBookingMoney(bookingId));

  const steps = [...(pre.steps || [])];
  let rentalPayment = null;

  if (money.rental_unpaid > 0.009) {
    const payAmt = amount != null ? Number(amount) : money.rental_unpaid;
    if (payAmt <= 0 || payAmt > money.rental_unpaid + 0.01) {
      const err = new Error(`Enter an amount up to ${money.rental_unpaid.toFixed(2)} ETB`);
      err.status = 400;
      throw err;
    }

    const status = autoApprove ? 'approved' : 'pending';
    const { rows } = await query(
      `INSERT INTO payments (
         booking_id, amount, type, method, reference_number, recorded_by, status
       ) VALUES ($1,$2,'final_settlement',$3,$4,$5,$6)
       RETURNING *`,
      [
        bookingId,
        payAmt,
        method || 'cash',
        reference_number || 'RETURN-RENTAL',
        userId,
        status,
      ]
    );
    rentalPayment = rows[0];
    steps.push({
      action: 'rental_collected',
      amount: payAmt,
      status,
      message:
        status === 'approved'
          ? `Rental ${payAmt.toFixed(2)} ETB recorded and approved`
          : `Rental ${payAmt.toFixed(2)} ETB saved — waiting approval`,
    });
  }

  // Continue: queue refund when rental is clear (approved path)
  const after = await runSettlementAutomation(bookingId, userId, {
    applyDeposit: true,
    queueRefund: true,
    method: method || 'cash',
  });

  const loaded = await loadBookingMoney(bookingId);

  return {
    ...after,
    steps: [...steps, ...(after.steps || [])],
    money: loaded.money,
    payments: loaded.payments,
    rental_payment: rentalPayment,
  };
}

/**
 * Confirm / approve pending deposit refund during return settlement.
 */
async function confirmDepositRefund(bookingId, userId, { method, autoApprove }) {
  const { booking, money } = await loadBookingMoney(bookingId);
  if (booking.status !== 'returned') {
    const err = new Error('Refund only after return check-in');
    err.status = 400;
    throw err;
  }

  let pending = await hasPendingRefund(bookingId);
  if (!pending && money.deposit_held > 0.009) {
    pending = await queueDepositRefund(bookingId, userId, money.deposit_held, method || 'cash');
  }
  if (!pending) {
    const err = new Error('No deposit refund to confirm');
    err.status = 400;
    throw err;
  }

  if (autoApprove) {
    // Only after return (checked above) — never approve deposit refund while equipment is out
    await query(
      `UPDATE payments SET status = 'approved'
       WHERE id = $1
         AND type = 'deposit_refund'
         AND EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.id = payments.booking_id AND b.status = 'returned'
         )`,
      [pending.id]
    );
  }

  const loaded = await loadBookingMoney(bookingId);
  const refundRow = loaded.payments.find((p) => p.id === pending.id);

  return {
    done: refundRow?.status === 'approved' && loaded.money.deposit_held <= 0.009,
    priority: refundRow?.status === 'approved' ? 'complete' : 'approve_refund',
    money: loaded.money,
    payments: loaded.payments,
    refund: refundRow,
    steps: [
      {
        action: 'refund_confirmed',
        amount: Number(refundRow?.amount || 0),
        message:
          refundRow?.status === 'approved'
            ? `Deposit ${Number(refundRow.amount).toFixed(2)} ETB refunded to customer`
            : `Deposit refund waiting approval`,
      },
    ],
    next: {
      message:
        refundRow?.status === 'approved'
          ? 'Settlement complete'
          : 'Manager must approve the deposit refund',
    },
  };
}

module.exports = {
  loadBookingMoney,
  runSettlementAutomation,
  applyDepositToRental,
  queueDepositRefund,
  collectRentalDuringReturn,
  confirmDepositRefund,
};
