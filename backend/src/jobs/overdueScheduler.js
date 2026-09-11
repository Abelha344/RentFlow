const cron = require('node-cron');
const { withTransaction, query } = require('../config/db');
const { notifyManagers } = require('../services/telegramService');
const { notifyCustomerDeadline } = require('../bots/telegramCustomerBot');

/**
 * Hourly overdue scan: mark past-due bookings, accrue late fees,
 * notify managers + linked customers via Telegram + Socket.io.
 */
function startOverdueScheduler(io) {
  const task = cron.schedule('0 * * * *', async () => {
    try {
      const result = await runOverdueScan(io);
      console.log(
        `[overdue-cron] newlyOverdue=${result.newlyOverdue} accruing=${result.accruing}`
      );
    } catch (err) {
      console.error('[overdue-cron] failed:', err.message);
    }
  });

  // Daily morning reminder for rentals due within 24 hours
  cron.schedule('0 8 * * *', async () => {
    try {
      await runDueSoonReminders();
    } catch (err) {
      console.error('[due-soon] failed:', err.message);
    }
  });

  console.log('node-cron overdue scheduler registered (hourly + due-soon 08:00)');
  return task;
}

async function runDueSoonReminders() {
  const { rows } = await query(
    `SELECT b.*, c.full_name, c.telegram_chat_id
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE b.status IN ('confirmed', 'out_for_rent')
       AND b.end_date > NOW()
       AND b.end_date <= NOW() + INTERVAL '24 hours'
       AND c.telegram_chat_id IS NOT NULL`
  );
  for (const row of rows) {
    await notifyCustomerDeadline({
      customer: {
        full_name: row.full_name,
        telegram_chat_id: row.telegram_chat_id,
      },
      booking: row,
      kind: 'due_soon',
    }).catch((err) => console.warn('[due-soon] telegram:', err.message));
  }
  return { reminded: rows.length };
}

async function runOverdueScan(io) {
  return withTransaction(async (client) => {
    const defaultLate = await client.query(
      `SELECT value_json FROM store_settings WHERE key = 'default_late_fee_per_day'`
    );
    const defaultFee = Number(defaultLate.rows[0]?.value_json) || 500;

    const marked = await client.query(
      `UPDATE bookings
       SET status = 'overdue', updated_at = NOW()
       WHERE status IN ('confirmed', 'out_for_rent')
         AND end_date < NOW()
         AND status <> 'returned'
       RETURNING id, customer_id, end_date, total_amount`
    );

    const overdue = await client.query(
      `SELECT b.id,
              COALESCE(
                (SELECT SUM(bi.quantity * COALESCE(NULLIF(i.late_fee_per_day, 0), $1))
                 FROM booking_items bi
                 JOIN inventory_items i ON i.id = bi.item_id
                 WHERE bi.booking_id = b.id),
                $1
              ) AS daily_fee
       FROM bookings b
       WHERE b.status = 'overdue'`,
      [defaultFee]
    );

    for (const row of overdue.rows) {
      const fee = Number(row.daily_fee) || defaultFee;
      await client.query(
        `UPDATE bookings
         SET late_fees_accrued = late_fees_accrued + $1,
             total_amount = total_amount + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [fee, row.id]
      );
    }

    for (const row of marked.rows) {
      const cust = await client.query(
        `SELECT full_name, telegram_chat_id FROM customers WHERE id = $1`,
        [row.customer_id]
      );
      const feeRow = overdue.rows.find((o) => o.id === row.id);
      const lateFee = Number(feeRow?.daily_fee) || defaultFee;
      if (cust.rows[0]?.telegram_chat_id) {
        notifyCustomerDeadline({
          customer: cust.rows[0],
          booking: row,
          kind: 'overdue',
          lateFee,
        }).catch((err) => console.warn('[overdue-customer] telegram:', err.message));
      }
    }

    if (marked.rows.length || overdue.rows.length) {
      const msg = `⏰ Overdue scan: ${marked.rows.length} newly overdue, ${overdue.rows.length} accruing late fees.`;
      notifyManagers(msg).catch((err) =>
        console.warn('[overdue-cron] telegram:', err.message)
      );
      io?.emit('bookings:overdue', {
        newlyOverdue: marked.rows,
        accruingCount: overdue.rows.length,
      });
    }

    return { newlyOverdue: marked.rows.length, accruing: overdue.rows.length };
  });
}

module.exports = { startOverdueScheduler, runOverdueScan, runDueSoonReminders };
