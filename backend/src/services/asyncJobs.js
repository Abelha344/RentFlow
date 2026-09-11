const path = require('path');
const { query } = require('../config/db');
const { generatePaymentReceiptPdf } = require('./pdfService');
const { sendDocument, notifyManagers, sendMessage } = require('./telegramService');

/**
 * Generate PDF receipt (unless agent already uploaded one) and send via Telegram.
 * @param {string} paymentId
 * @param {*} io
 * @param {{ skipGeneratePdf?: boolean, uploadedPdfRelative?: string|null }} options
 */
async function processPaymentReceipt(paymentId, io, options = {}) {
  const payRes = await query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
  const payment = payRes.rows[0];
  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  if (!payment.booking_id) throw new Error(`Payment ${paymentId} has no booking`);

  const bookingRes = await query(`SELECT * FROM bookings WHERE id = $1`, [payment.booking_id]);
  const booking = bookingRes.rows[0];
  const customerRes = await query(`SELECT * FROM customers WHERE id = $1`, [
    payment.customer_id || booking.customer_id,
  ]);
  const customer = customerRes.rows[0];
  const itemsRes = await query(
    `SELECT bi.*, i.name FROM booking_items bi
     JOIN inventory_items i ON i.id = bi.item_id
     WHERE bi.booking_id = $1`,
    [booking.id]
  );

  let relative = payment.pdf_receipt_url || options.uploadedPdfRelative || null;
  let filePath = null;

  if (!options.skipGeneratePdf || !relative) {
    filePath = await generatePaymentReceiptPdf({
      payment,
      booking,
      customer,
      items: itemsRes.rows,
    });
    relative = `/uploads/receipts/${path.basename(filePath)}`;
    await query(`UPDATE payments SET pdf_receipt_url = $1 WHERE id = $2`, [relative, payment.id]);
  } else {
    filePath = path.join(__dirname, '../..', relative.replace(/^\//, ''));
    if (options.uploadedPdfRelative) {
      await query(`UPDATE payments SET pdf_receipt_url = $1 WHERE id = $2`, [
        options.uploadedPdfRelative,
        payment.id,
      ]);
      relative = options.uploadedPdfRelative;
      filePath = path.join(__dirname, '../..', relative.replace(/^\//, ''));
    }
  }

  const chatId = customer?.telegram_chat_id;
  if (chatId && filePath) {
    await sendDocument(
      chatId,
      filePath,
      `RentFlow official receipt ✅\n` +
        `${payment.type === 'collateral_deposit' ? 'Security deposit' : 'Payment'} · ` +
        `${Number(payment.amount).toFixed(2)} ETB\n` +
        `Transaction ID: ${payment.reference_number || '—'}`
    );
  }

  io?.emit('receipt:ready', { paymentId: payment.id, url: relative });
  return { url: relative };
}

/** Non-blocking wrapper — errors are logged, never thrown to the request. */
function dispatchPaymentReceipt(paymentId, io, options) {
  processPaymentReceipt(paymentId, io, options).catch((err) =>
    console.error('[receipt] failed:', err.message)
  );
}

function dispatchTelegram({ message, chatId, type }, io) {
  const work = chatId ? sendMessage(chatId, message) : notifyManagers(message);
  work
    .then(() => io?.emit('telegram:sent', { type, at: new Date().toISOString() }))
    .catch((err) => console.error('[telegram] failed:', err.message));
}

module.exports = {
  processPaymentReceipt,
  dispatchPaymentReceipt,
  dispatchTelegram,
};
