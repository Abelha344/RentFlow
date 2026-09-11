const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const { getStockSnapshot } = require('./stockService');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Inventory audit = current stock snapshot (all active items).
 * Period filters apply to payment log; inventory is always “what we have now”.
 */
async function exportInventoryAudit() {
  const snapshot = await getStockSnapshot();
  const rows = snapshot.map((r) => ({
    name: r.name,
    category: r.category,
    available: r.available_now,
    out_for_rent: r.reserved_now,
    total: r.total_quantity,
    good: r.qty_good,
    semi: r.qty_semi_damaged,
    damaged: r.qty_damaged,
    rate_per_day: Number(r.rental_rate_per_day),
    late_fee_per_day: Number(r.late_fee_per_day),
    damage_fee_semi: Number(r.damage_fee_semi),
    damage_fee_full: Number(r.damage_fee_full),
    min_threshold: r.min_stock_threshold,
    low_stock: r.is_low_stock ? 'Yes' : 'No',
  }));

  return writeSheet('inventory-audit', 'Inventory', rows, [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Available', key: 'available', width: 12 },
    { header: 'Out for rent', key: 'out_for_rent', width: 12 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Good', key: 'good', width: 10 },
    { header: 'Semi', key: 'semi', width: 10 },
    { header: 'Damaged', key: 'damaged', width: 10 },
    { header: 'Rate/Day', key: 'rate_per_day', width: 12 },
    { header: 'Late fee/Day', key: 'late_fee_per_day', width: 12 },
    { header: 'Damage semi', key: 'damage_fee_semi', width: 12 },
    { header: 'Damage full', key: 'damage_fee_full', width: 12 },
    { header: 'Min threshold', key: 'min_threshold', width: 14 },
    { header: 'Low stock', key: 'low_stock', width: 10 },
  ]);
}

async function exportPayments(from, to) {
  // Calendar-day filter in East Africa Time (business local), inclusive
  const fromDate = from ? String(from).trim().slice(0, 10) : null;
  const toDate = to ? String(to).trim().slice(0, 10) : null;

  const { rows } = await query(
    `SELECT p.id, p.booking_id, p.amount, p.type, p.method, p.reference_number,
            p.status, p.created_at,
            COALESCE(c.full_name, c2.full_name, '—') AS customer_name,
            u.full_name AS recorded_by_name
     FROM payments p
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN customers c ON c.id = b.customer_id
     LEFT JOIN customers c2 ON c2.id = p.customer_id
     LEFT JOIN users u ON u.id = p.recorded_by
     WHERE ($1::date IS NULL OR (p.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date >= $1::date)
       AND ($2::date IS NULL OR (p.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date <= $2::date)
     ORDER BY p.created_at DESC`,
    [fromDate, toDate]
  );

  const mapped = rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    created_at: r.created_at
      ? new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)
      : '',
  }));

  return writeSheet('payments-export', 'Payments', mapped, [
    { header: 'ID', key: 'id', width: 36 },
    { header: 'Booking', key: 'booking_id', width: 36 },
    { header: 'Customer', key: 'customer_name', width: 22 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Type', key: 'type', width: 18 },
    { header: 'Method', key: 'method', width: 14 },
    { header: 'Reference', key: 'reference_number', width: 18 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Recorded By', key: 'recorded_by_name', width: 18 },
    { header: 'Created', key: 'created_at', width: 22 },
  ]);
}

async function exportCustomerHistory(customerId) {
  const { rows } = await query(
    `SELECT b.id AS booking_id, b.start_date, b.end_date, b.status, b.total_amount,
            b.collateral_deposit, b.created_at,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved'), 0) AS paid_total
     FROM bookings b
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE b.customer_id = $1
     GROUP BY b.id
     ORDER BY b.created_at DESC`,
    [customerId]
  );
  return writeSheet(`customer-${customerId}`, 'History', rows, [
    { header: 'Booking', key: 'booking_id', width: 36 },
    { header: 'Start', key: 'start_date', width: 22 },
    { header: 'End', key: 'end_date', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Total', key: 'total_amount', width: 12 },
    { header: 'Deposit', key: 'collateral_deposit', width: 12 },
    { header: 'Paid', key: 'paid_total', width: 12 },
    { header: 'Created', key: 'created_at', width: 22 },
  ]);
}

async function writeSheet(basename, sheetName, rows, columns) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RentFlow';
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  rows.forEach((r) => sheet.addRow(r));
  sheet.getRow(1).font = { bold: true };

  const dir = path.join(__dirname, '../../uploads/exports');
  ensureDir(dir);
  const filePath = path.join(dir, `${basename}-${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = {
  exportInventoryAudit,
  exportPayments,
  exportCustomerHistory,
};
