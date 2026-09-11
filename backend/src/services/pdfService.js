const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function money(n) {
  return `${Number(n || 0).toFixed(2)} ETB`;
}

const TYPE_LABEL = {
  collateral_deposit: 'Security deposit (collateral)',
  down_payment: 'Down payment (rental)',
  installment: 'Partial payment (rental)',
  final_settlement: 'Full rental payment',
  late_fee: 'Late fee',
  damage_fee: 'Damage fee',
  deposit_refund: 'Deposit refund',
};

/**
 * Generate official payment receipt PDF.
 * @returns {Promise<string>} absolute file path
 */
function generatePaymentReceiptPdf({ payment, booking, customer, items }) {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, '../../uploads/receipts');
    ensureDir(dir);
    const filename = `receipt-${payment.id}.pdf`;
    const filePath = path.join(dir, filename);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    const isDeposit = payment.type === 'collateral_deposit';
    const typeLabel = TYPE_LABEL[payment.type] || payment.type;

    doc.pipe(stream);

    doc.fontSize(20).text('RentFlow', { align: 'center' });
    doc.fontSize(12).text('Event Equipment & Tent Rental', { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(16)
      .text(isDeposit ? 'Security Deposit Receipt' : 'Official Payment Receipt', {
        align: 'center',
      });
    if (isDeposit) {
      doc
        .fontSize(10)
        .fillColor('#333')
        .text('Proof that the customer paid collateral for this rental', {
          align: 'center',
        });
      doc.fillColor('#000');
    }
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Receipt No: ${payment.id}`);
    doc.text(`Date: ${new Date(payment.created_at).toLocaleString()}`);
    doc.text(`Payment: ${typeLabel}`);
    doc.text(`Method: ${payment.method}`);
    if (payment.reference_number) doc.text(`Reference: ${payment.reference_number}`);
    doc.moveDown();

    doc.fontSize(12).text('Customer', { underline: true });
    doc.fontSize(10);
    doc.text(`Name: ${customer.full_name}`);
    if (customer.phone) doc.text(`Phone: ${customer.phone}`);
    if (customer.address) doc.text(`Address: ${customer.address}`);
    doc.moveDown();

    doc.fontSize(12).text('Booking', { underline: true });
    doc.fontSize(10);
    doc.text(`Booking ID: ${booking.id}`);
    doc.text(
      `Period: ${new Date(booking.start_date).toLocaleDateString()} – ${new Date(booking.end_date).toLocaleDateString()}`
    );
    doc.text(`Status: ${booking.status}`);
    if (isDeposit) {
      doc.text(`Deposit required: ${money(booking.collateral_deposit)}`);
    }
    doc.moveDown();

    if (items?.length) {
      doc.fontSize(12).text('Items', { underline: true });
      doc.fontSize(10);
      items.forEach((it) => {
        doc.text(`${it.name} × ${it.quantity} @ ${it.unit_price} = ${it.subtotal}`);
      });
      doc.moveDown();
    }

    doc.fontSize(14).text(`Amount Paid: ${money(payment.amount)}`, { align: 'right' });
    doc.moveDown();

    if (isDeposit) {
      doc.fontSize(10).fillColor('#000');
      doc.text(
        'This security deposit is held as collateral. It is refundable after return check-in, less any damage or unpaid rental charges.'
      );
      doc.moveDown();
      doc.text('Customer acknowledgment: ________________________     Date: ____________');
      doc.moveDown();
      doc.text('Received by (staff): _____________________________     Date: ____________');
      doc.moveDown();
    }

    doc
      .fontSize(9)
      .fillColor('#666')
      .text('Thank you for choosing RentFlow.', { align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

/**
 * Lease + warehouse work order — includes security deposit proof.
 */
function generateWorkOrderPdf({ booking, customer, items, createdBy, money: moneySnap, depositPayments }) {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, '../../uploads/receipts');
    ensureDir(dir);
    const filename = `work-order-${booking.id}.pdf`;
    const filePath = path.join(dir, filename);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);

    const depositExpected = Number(
      moneySnap?.deposit_expected ?? booking.collateral_deposit ?? 0
    );
    const depositPaid = Number(moneySnap?.deposit_paid ?? 0);
    const depositUnpaid = Number(moneySnap?.deposit_unpaid ?? Math.max(0, depositExpected - depositPaid));
    const depositOk = depositUnpaid <= 0.009;
    const rentalTotal = Number(moneySnap?.rental_total ?? booking.total_amount ?? 0);

    doc.pipe(stream);

    doc.fontSize(18).text('LEASE / WORK ORDER', { align: 'center' });
    doc.fontSize(10).text('RentFlow — Rental agreement & dispatch sheet', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Booking: ${booking.id}`);
    doc.text(`Customer: ${customer.full_name} | Phone: ${customer.phone || '—'}`);
    doc.text(
      `Rental period: ${new Date(booking.start_date).toLocaleString()} → ${new Date(booking.end_date).toLocaleString()}`
    );
    doc.text(`Buffer until: ${new Date(booking.buffer_end_date).toLocaleString()}`);
    doc.text(`Prepared by: ${createdBy || '—'}`);
    doc.moveDown();

    // Security deposit block — customer proof on the same print
    doc.fontSize(12).text('Security deposit (collateral)', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    doc.text(`Required: ${money(depositExpected)}`);
    doc.text(`Paid: ${money(depositPaid)}   ·   Status: ${depositOk ? 'PAID' : 'UNPAID'}`);
    if (depositPayments?.length) {
      depositPayments.forEach((p) => {
        doc.text(
          `  • ${money(p.amount)} via ${p.method}${p.reference_number ? ` (ref ${p.reference_number})` : ''} — ${new Date(p.created_at).toLocaleString()}`
        );
      });
    } else if (!depositOk) {
      doc.fillColor('#990000').text('  No approved deposit payment yet.');
      doc.fillColor('#000');
    }
    doc.moveDown(0.4);
    doc
      .fontSize(9)
      .text(
        'Deposit is held as collateral and refundable after return, less damage or unpaid rental.'
      );
    doc.moveDown();

    doc.fontSize(12).text('Rental charges', { underline: true });
    doc.fontSize(10);
    doc.text(`Rental total: ${money(rentalTotal)} (collected mainly at/after return)`);
    doc.moveDown();

    doc.fontSize(12).text('Pack list — condition at dispatch', { underline: true });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#333')
      .text(
        'Before loading, count each item by condition. Write numbers in the blanks. Good + Semi + Damaged must equal Qty out.'
      );
    doc
      .fontSize(8)
      .text(
        'Good = ready to rent · Semi = usable wear / stain · Damaged = broken or not usable'
      );
    doc.fillColor('#000');
    doc.moveDown(0.6);

    const col = {
      item: 40,
      qty: 250,
      good: 310,
      semi: 395,
      damaged: 480,
    };
    const headerY = doc.y;
    doc.fontSize(8).fillColor('#333');
    doc.text('Item', col.item, headerY, { width: 200 });
    doc.text('Qty out', col.qty, headerY, { width: 50 });
    doc.text('Good (OK)', col.good, headerY, { width: 75 });
    doc.text('Semi (wear)', col.semi, headerY, { width: 75 });
    doc.text('Damaged', col.damaged, headerY, { width: 70 });
    doc.fillColor('#000');
    doc.moveDown(0.9);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);

    items.forEach((it) => {
      const qty = Number(it.quantity) || 0;
      const y = doc.y + 2;
      doc.fontSize(9).fillColor('#000');
      doc.text(it.name || 'Item', col.item, y, { width: 200 });
      doc.text(String(qty), col.qty, y, { width: 50 });
      // Write how many units leave in each condition (not checkboxes)
      doc.text(`____ / ${qty}`, col.good, y, { width: 75 });
      doc.text(`____ / ${qty}`, col.semi, y, { width: 75 });
      doc.text(`____ / ${qty}`, col.damaged, y, { width: 70 });
      doc.moveDown(1.4);
    });

    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#000');
    doc.text(
      'Shortage / extra notes: _______________________________________________________________'
    );
    doc.moveDown(1.2);
    doc.fontSize(10);
    doc.text(
      'I confirm the items and counts above, and acknowledge the security deposit status on this lease.'
    );
    doc.moveDown();
    doc.text('Customer signature: ____________________________     Date: ____________');
    doc.moveDown();
    doc.text('Warehouse staff: _______________________________     Date: ____________');
    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(
        'Verify quantities and condition before loading. Dispatch only when security deposit is PAID.'
      );

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

function paymentLineLabel(p) {
  const ref = String(p.reference_number || '');
  if (ref.startsWith('APPLIED-FROM-DEPOSIT')) return 'Paid from deposit (rental)';
  if (ref.startsWith('APPLIED-TO-RENTAL')) return null; // ledger pair — hide duplicate
  if (p.type === 'collateral_deposit') return 'Security deposit';
  if (p.type === 'deposit_refund') return 'Deposit refund';
  if (p.type === 'final_settlement') return 'Rental payment';
  if (p.type === 'down_payment') return 'Down payment (rental)';
  if (p.type === 'installment') return 'Partial payment (rental)';
  if (p.type === 'late_fee') return 'Late fee';
  if (p.type === 'damage_fee') return 'Damage fee';
  return String(p.type || 'Payment').replace(/_/g, ' ');
}

/**
 * Full settlement slip: rented items, return condition, damage fees, and all payments.
 */
function generateSettlementPdf({ booking, customer, items, returns, payments, totalDamageFee }) {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, '../../uploads/receipts');
    ensureDir(dir);
    const filename = `settlement-${booking.id}.pdf`;
    const filePath = path.join(dir, filename);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).fillColor('#0d6e5f').text('RentFlow', { align: 'center' });
    doc.fontSize(11).fillColor('#5c6f6b').text('Event equipment rental', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(16).fillColor('#0f1c1a').text('Return Settlement', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).fillColor('#0f1c1a');
    doc.text(`Prepared for: ${customer.full_name}`);
    if (customer.phone) doc.text(`Phone: ${customer.phone}`);
    if (customer.address) doc.text(`Address: ${customer.address}`);
    doc.text(`Issued: ${new Date().toLocaleString()}`);
    doc.text(
      `Rental period: ${new Date(booking.start_date).toLocaleDateString()} – ${new Date(booking.end_date).toLocaleDateString()}`
    );
    doc.moveDown();

    const damageTotal = Number(totalDamageFee || 0);
    const rentalBase = Math.max(0, Number(booking.total_amount || 0) - damageTotal);
    let depositPaid = 0;
    let paidFromDeposit = 0;
    let rentalCollected = 0;
    let depositRefunded = 0;
    let pending = 0;
    (payments || []).forEach((p) => {
      const ref = String(p.reference_number || '');
      if (ref.startsWith('APPLIED-TO-RENTAL')) return;
      if (p.status === 'pending') {
        pending += Number(p.amount) || 0;
        return;
      }
      if (p.status !== 'approved') return;
      if (p.type === 'collateral_deposit') depositPaid += Number(p.amount) || 0;
      else if (ref.startsWith('APPLIED-FROM-DEPOSIT')) paidFromDeposit += Number(p.amount) || 0;
      else if (p.type === 'deposit_refund') depositRefunded += Number(p.amount) || 0;
      else if (
        ['down_payment', 'installment', 'final_settlement', 'late_fee', 'damage_fee'].includes(
          p.type
        )
      ) {
        rentalCollected += Number(p.amount) || 0;
      }
    });

    doc.fontSize(12).fillColor('#0d6e5f').text('At a glance', { underline: true });
    doc.fontSize(11).fillColor('#0f1c1a');
    doc.text(`Total charges: ${money(booking.total_amount)}`);
    doc.text(`Covered by deposit: ${money(paidFromDeposit)}`);
    doc.text(`Refunded to you: ${money(depositRefunded)}`);
    doc.moveDown();

    if (items?.length) {
      doc.fontSize(12).fillColor('#0d6e5f').text('What was rented', { underline: true });
      doc.fontSize(10).fillColor('#0f1c1a');
      items.forEach((it) => {
        doc.text(`${it.name} × ${it.quantity} @ ${money(it.unit_price)} = ${money(it.subtotal)}`);
      });
      doc.moveDown();
    }

    doc.fontSize(12).fillColor('#0d6e5f').text('How we calculated', { underline: true });
    doc.fontSize(10).fillColor('#0f1c1a');
    doc.text(`Equipment rental: ${money(rentalBase)}`);

    if (returns?.length) {
      let semiSum = 0;
      let fullSum = 0;
      returns.forEach((r) => {
        const name = r.item_name || r.name || r.item_id;
        const semiQty = Number(r.qty_returned_semi_damaged || 0);
        const fullQty = Number(r.qty_returned_damaged || 0);
        const semiRate = Number(r.damage_fee_semi || 0);
        const fullRate = Number(r.damage_fee_full || 0);
        const semiLine = semiQty * semiRate;
        const fullLine = fullQty * fullRate;
        semiSum += semiLine;
        fullSum += fullLine;
        if (semiQty > 0 || fullQty > 0) {
          const parts = [];
          if (semiQty > 0) parts.push(`semi ${semiQty} × ${money(semiRate)} = ${money(semiLine)}`);
          if (fullQty > 0) parts.push(`damaged ${fullQty} × ${money(fullRate)} = ${money(fullLine)}`);
          doc.text(`${name}: ${parts.join(' · ')}`);
        }
      });
      doc.text(`Semi-damage fees: ${money(semiSum)}`);
      doc.text(`Full damage fees: ${money(fullSum)}`);
      doc.text(`Damage fees total: ${money(totalDamageFee ?? semiSum + fullSum)}`);
    } else if (damageTotal > 0.009) {
      doc.text(`Damage fees: ${money(damageTotal)}`);
    }
    doc.fontSize(11).text(`Total charges: ${money(booking.total_amount)}`);
    doc.moveDown();

    doc.fontSize(12).fillColor('#0d6e5f').text('Your security deposit', { underline: true });
    doc.fontSize(10).fillColor('#0f1c1a');
    doc.text(`1. Deposit you paid: ${money(depositPaid)}`);
    doc.text(`2. Used for rental & damage: − ${money(paidFromDeposit)}`);
    if (rentalCollected > 0.009) {
      doc.text(`Extra collected (not from deposit): ${money(rentalCollected)}`);
    }
    doc.fontSize(11).text(`3. Returned to you: ${money(depositRefunded)}`);
    if (pending > 0.009) doc.text(`Waiting approval: ${money(pending)}`);
    doc.moveDown();

    if (payments?.length) {
      doc.fontSize(12).fillColor('#0d6e5f').text('How your bill was paid', { underline: true });
      doc.fontSize(10).fillColor('#0f1c1a');
      doc.text(
        `Total charges ${money(booking.total_amount)} = deposit used ${money(paidFromDeposit)}` +
          (rentalCollected > 0.009 ? ` + extra payment ${money(rentalCollected)}` : '')
      );
      doc.text(`From your security deposit (applied to charges): ${money(paidFromDeposit)}`);
      if (rentalCollected > 0.009) {
        doc.text(`Extra you paid (remaining after deposit): ${money(rentalCollected)}`);
      }
      doc.text(
        depositRefunded > 0.009
          ? `Deposit refunded to you: ${money(depositRefunded)}`
          : 'Deposit refund: 0.00 ETB (deposit fully used on charges)'
      );
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#5c6f6b').text('Receipts (money that moved)');
      doc.fillColor('#0f1c1a');
      payments.forEach((p) => {
        const ref = String(p.reference_number || '');
        if (ref.startsWith('APPLIED-FROM-DEPOSIT') || ref.startsWith('APPLIED-TO-RENTAL')) return;
        if (!['collateral_deposit', 'deposit_refund', 'down_payment', 'installment', 'final_settlement', 'late_fee'].includes(p.type)) {
          return;
        }
        let title = 'Payment';
        if (p.type === 'collateral_deposit') title = 'Security deposit received';
        else if (p.type === 'deposit_refund') title = 'Deposit refund paid out';
        else title = 'Extra payment for charges';
        doc.text(
          `${title} · ${p.method} · ${money(p.amount)} · ${p.status === 'approved' ? 'Done' : p.status}`
        );
      });
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#666').text('Thank you for choosing RentFlow. Keep this copy for your records.', {
      align: 'center',
    });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generatePaymentReceiptPdf, generateWorkOrderPdf, generateSettlementPdf };
