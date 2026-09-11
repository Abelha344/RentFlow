const { query } = require('../config/db');

/**
 * Available quantity for an item over [start, bufferEnd], excluding a booking.
 * Considers qty_good only (rentable stock) minus overlapping active reservations.
 */
async function getAvailableQuantity(itemId, startDate, bufferEndDate, excludeBookingId = null, client = null) {
  const runner = client ? client.query.bind(client) : query;

  const itemRes = await runner(
    `SELECT id, qty_good, total_quantity, min_stock_threshold, name
     FROM inventory_items
     WHERE id = $1 AND is_deleted = FALSE`,
    [itemId]
  );
  if (!itemRes.rows[0]) {
    const err = new Error('Inventory item not found');
    err.status = 404;
    throw err;
  }

  const item = itemRes.rows[0];
  const reservedRes = await runner(
    `SELECT COALESCE(SUM(bi.quantity), 0)::int AS reserved
     FROM booking_items bi
     JOIN bookings b ON b.id = bi.booking_id
     WHERE bi.item_id = $1
       AND b.status IN ('draft', 'confirmed', 'out_for_rent', 'overdue')
       AND ($4::uuid IS NULL OR b.id <> $4)
       AND b.start_date < $3::timestamptz
       AND b.buffer_end_date > $2::timestamptz`,
    [itemId, startDate, bufferEndDate, excludeBookingId]
  );

  const reserved = reservedRes.rows[0].reserved;
  const available = Math.max(0, item.qty_good - reserved);

  return {
    itemId: item.id,
    name: item.name,
    qtyGood: item.qty_good,
    reserved,
    available,
    minStockThreshold: item.min_stock_threshold,
  };
}

/**
 * Check all lines for a booking window.
 * @param {{ item_id: string, quantity: number }[]} items
 */
async function checkStockAvailability(items, startDate, bufferEndDate, excludeBookingId = null, client = null) {
  const results = [];
  let allOk = true;

  for (const line of items) {
    const avail = await getAvailableQuantity(
      line.item_id,
      startDate,
      bufferEndDate,
      excludeBookingId,
      client
    );
    const ok = line.quantity <= avail.available;
    if (!ok) allOk = false;
    results.push({
      ...avail,
      requested: line.quantity,
      sufficient: ok,
    });
  }

  return { allOk, items: results };
}

/**
 * Real-time stock snapshot for dashboard / inventory list.
 */
async function getStockSnapshot(asOf = new Date()) {
  const { rows } = await query(
    `SELECT
       i.id,
       i.name,
       i.category,
       i.qty_good,
       i.qty_semi_damaged,
       i.qty_damaged,
       i.total_quantity,
       i.min_stock_threshold,
       i.rental_rate_per_day,
       i.damage_fee_semi,
       i.damage_fee_full,
       i.late_fee_per_day,
       i.buffer_time_hours,
       COALESCE(r.reserved, 0)::int AS reserved_now,
       GREATEST(i.qty_good - COALESCE(r.reserved, 0), 0)::int AS available_now,
       (GREATEST(i.qty_good - COALESCE(r.reserved, 0), 0) < i.min_stock_threshold) AS is_low_stock
     FROM inventory_items i
     LEFT JOIN LATERAL (
       SELECT SUM(bi.quantity) AS reserved
       FROM booking_items bi
       JOIN bookings b ON b.id = bi.booking_id
       WHERE bi.item_id = i.id
         AND b.status IN ('draft', 'confirmed', 'out_for_rent', 'overdue')
         AND b.start_date <= $1::timestamptz
         AND b.buffer_end_date >= $1::timestamptz
     ) r ON TRUE
     WHERE i.is_deleted = FALSE
     ORDER BY i.name`,
    [asOf]
  );
  return rows;
}

module.exports = {
  getAvailableQuantity,
  checkStockAvailability,
  getStockSnapshot,
};
