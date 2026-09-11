/** Plain-language labels for agents (not developers). */

export const PAYMENT_TYPE_LABEL = {
  down_payment: 'Down payment (rental)',
  collateral_deposit: 'Security deposit',
  installment: 'Partial payment (rental)',
  final_settlement: 'Full rental payment',
  late_fee: 'Late fee',
  damage_fee: 'Damage fee',
  deposit_refund: 'Deposit refund',
};

export const PAYMENT_METHOD_LABEL = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  telebirr: 'Telebirr',
};

export const PAYMENT_STATUS_LABEL = {
  pending: 'Waiting approval',
  approved: 'Paid (approved)',
  rejected: 'Rejected',
};

export const BOOKING_STATUS_LABEL = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  out_for_rent: 'Out for rent',
  returned: 'Returned',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const PAY_STATUS_LABEL = {
  unpaid: 'Not paid',
  partial: 'Partly paid',
  paid: 'Paid in full',
};

export function labelPaymentType(v) {
  return PAYMENT_TYPE_LABEL[v] || String(v || '').replace(/_/g, ' ');
}

export function labelPaymentMethod(v) {
  return PAYMENT_METHOD_LABEL[v] || String(v || '').replace(/_/g, ' ');
}

export function labelPaymentStatus(v) {
  return PAYMENT_STATUS_LABEL[v] || v;
}

export function labelBookingStatus(v) {
  return BOOKING_STATUS_LABEL[v] || String(v || '').replace(/_/g, ' ');
}

export function labelPayStatus(v) {
  return PAY_STATUS_LABEL[v] || v;
}
