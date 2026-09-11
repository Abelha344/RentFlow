/**
 * Professional money split for RentFlow:
 * - Security deposit: must be paid at rent-out; refundable after return
 * - Rental (down / partial / full + fees): collect at/after return check-in
 */

function num(v) {
  return Number(v || 0);
}

const DEPOSIT_TYPES = new Set(['collateral_deposit']);
const REFUND_TYPES = new Set(['deposit_refund']);
const RENTAL_TYPES = new Set([
  'down_payment',
  'installment',
  'final_settlement',
  'late_fee',
  'damage_fee',
]);

function roundMoney(n) {
  return Math.max(0, Math.round(num(n) * 100) / 100);
}

function summarizeBookingMoney(booking, payments = []) {
  const rentalTotal = num(booking.total_amount);
  const depositExpected = num(booking.collateral_deposit);

  let depositPaid = 0;
  let depositRefunded = 0;
  let rentalPaid = 0;
  let pendingTotal = 0;
  let pendingDeposit = 0;
  let pendingRental = 0;

  for (const p of payments) {
    const amt = num(p.amount);
    if (p.status === 'pending') {
      pendingTotal += amt;
      if (DEPOSIT_TYPES.has(p.type)) pendingDeposit += amt;
      else if (RENTAL_TYPES.has(p.type)) pendingRental += amt;
      continue;
    }
    if (p.status !== 'approved') continue;
    if (DEPOSIT_TYPES.has(p.type)) depositPaid += amt;
    else if (REFUND_TYPES.has(p.type)) depositRefunded += amt;
    else if (RENTAL_TYPES.has(p.type)) rentalPaid += amt;
  }

  const depositUnpaid = roundMoney(depositExpected - depositPaid);
  const depositHeld = roundMoney(depositPaid - depositRefunded);
  const rentalUnpaid = roundMoney(rentalTotal - rentalPaid);
  const returned = booking.status === 'returned';
  const depositRefundable = returned ? depositHeld : 0;

  // What the customer still needs to pay in (not including refunds out)
  const balanceDue = roundMoney(depositUnpaid + rentalUnpaid);
  const amountDue = roundMoney(depositExpected + rentalTotal);
  const paidTotal = roundMoney(depositPaid + rentalPaid);

  let payStatus = 'unpaid';
  if (balanceDue <= 0.009) payStatus = 'paid';
  else if (paidTotal > 0) payStatus = 'partial';

  let depositStatus = 'unpaid';
  if (depositExpected <= 0.009) depositStatus = 'none';
  else if (depositUnpaid <= 0.009) depositStatus = depositHeld > 0.009 ? 'held' : 'refunded';
  else if (depositPaid > 0) depositStatus = 'partial';

  return {
    rental_total: rentalTotal,
    rental_paid: roundMoney(rentalPaid),
    rental_unpaid: rentalUnpaid,
    deposit_expected: depositExpected,
    deposit_paid: roundMoney(depositPaid),
    deposit_unpaid: depositUnpaid,
    deposit_refunded: roundMoney(depositRefunded),
    deposit_held: depositHeld,
    deposit_refundable: depositRefundable,
    deposit_status: depositStatus,
    amount_due: amountDue,
    paid_total: paidTotal,
    pending_total: roundMoney(pendingTotal),
    pending_deposit: roundMoney(pendingDeposit),
    pending_rental: roundMoney(pendingRental),
    balance_due: balanceDue,
    pay_status: payStatus,
    can_dispatch: depositUnpaid <= 0.009,
  };
}

/** SQL aggregates (bookings aliased as b). */
const BOOKING_MONEY_SQL = `
  COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.booking_id = b.id AND p.status = 'approved'
      AND p.type = 'collateral_deposit'
  ), 0)::numeric AS deposit_paid,
  COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.booking_id = b.id AND p.status = 'approved'
      AND p.type = 'deposit_refund'
  ), 0)::numeric AS deposit_refunded,
  COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.booking_id = b.id AND p.status = 'approved'
      AND p.type IN ('down_payment', 'installment', 'final_settlement', 'late_fee', 'damage_fee')
  ), 0)::numeric AS rental_paid,
  COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.booking_id = b.id AND p.status = 'pending'
  ), 0)::numeric AS pending_total,
  COALESCE(b.total_amount, 0)::numeric AS rental_total,
  COALESCE(b.collateral_deposit, 0)::numeric AS deposit_expected,
  GREATEST(
    0,
    COALESCE(b.collateral_deposit, 0) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.booking_id = b.id AND p.status = 'approved' AND p.type = 'collateral_deposit'
    ), 0)
  )::numeric AS deposit_unpaid,
  GREATEST(
    0,
    COALESCE(b.total_amount, 0) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.booking_id = b.id AND p.status = 'approved'
        AND p.type IN ('down_payment', 'installment', 'final_settlement', 'late_fee', 'damage_fee')
    ), 0)
  )::numeric AS rental_unpaid
`;

function attachPayStatus(row) {
  const depositExpected = num(row.deposit_expected ?? row.collateral_deposit);
  const depositPaid = num(row.deposit_paid);
  const depositRefunded = num(row.deposit_refunded);
  const depositUnpaid = num(row.deposit_unpaid);
  const rentalTotal = num(row.rental_total ?? row.total_amount);
  const rentalPaid = num(row.rental_paid);
  const rentalUnpaid = num(row.rental_unpaid);
  const depositHeld = roundMoney(depositPaid - depositRefunded);
  const returned = row.status === 'returned';
  const balanceDue = roundMoney(depositUnpaid + rentalUnpaid);
  const paidTotal = roundMoney(depositPaid + rentalPaid);

  let pay_status = 'unpaid';
  if (balanceDue <= 0.009) pay_status = 'paid';
  else if (paidTotal > 0) pay_status = 'partial';

  let deposit_status = 'unpaid';
  if (depositExpected <= 0.009) deposit_status = 'none';
  else if (depositUnpaid <= 0.009) deposit_status = depositHeld > 0.009 ? 'held' : 'refunded';
  else if (depositPaid > 0) deposit_status = 'partial';

  return {
    ...row,
    rental_total: rentalTotal,
    rental_paid: rentalPaid,
    rental_unpaid: rentalUnpaid,
    deposit_expected: depositExpected,
    deposit_paid: depositPaid,
    deposit_unpaid: depositUnpaid,
    deposit_refunded: depositRefunded,
    deposit_held: depositHeld,
    deposit_refundable: returned ? depositHeld : 0,
    deposit_status,
    amount_due: roundMoney(depositExpected + rentalTotal),
    paid_total: paidTotal,
    pending_total: num(row.pending_total),
    balance_due: balanceDue,
    pay_status,
    can_dispatch: depositUnpaid <= 0.009,
  };
}

module.exports = {
  summarizeBookingMoney,
  BOOKING_MONEY_SQL,
  attachPayStatus,
  DEPOSIT_TYPES,
  RENTAL_TYPES,
  REFUND_TYPES,
};
