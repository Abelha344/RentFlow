/**
 * Apply schema and seed demo admin + sample inventory.
 * Usage: node scripts/migrate.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('Schema applied.');

    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [
      'admin@rentflow.local',
    ]);

    if (!existing.rows[0]) {
      const hash = await bcrypt.hash('Admin123!', 12);
      await client.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')`,
        ['System Admin', 'admin@rentflow.local', hash]
      );
      await client.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES
           ('Store Manager', 'manager@rentflow.local', $1, 'manager'),
           ('Front Desk Cashier', 'cashier@rentflow.local', $1, 'cashier')`,
        [hash]
      );
      console.log('Seed users created (password: Admin123!)');
    }

    // Never auto-seed demo stock in production (real catalogs only).
    const skipSeedInventory =
      process.env.SKIP_SEED_INVENTORY === '1' ||
      process.env.NODE_ENV === 'production' ||
      process.env.SEED_INVENTORY === '0';

    const invCount = await client.query(
      `SELECT COUNT(*)::int AS c FROM inventory_items WHERE is_deleted = FALSE`
    );
    if (!skipSeedInventory && invCount.rows[0].c === 0) {
      await client.query(
        `INSERT INTO inventory_items (
           name, category, sku, barcode, total_quantity, rental_rate_per_day,
           buffer_time_hours, qty_good, qty_semi_damaged, qty_damaged,
           min_stock_threshold, damage_fee_semi, damage_fee_full, late_fee_per_day
         ) VALUES
           ('White Party Tent 10x20', 'Tents', 'TENT-001', '200000000001', 12, 2500, 24, 12, 0, 0, 3, 500, 5000, 400),
           ('Folding Banquet Chair', 'Seating', 'CHAIR-001', '200000000002', 200, 25, 12, 200, 0, 0, 40, 10, 80, 5),
           ('Round Table 60in', 'Tables', 'TABLE-001', '200000000003', 40, 80, 12, 40, 0, 0, 8, 30, 250, 15),
           ('LED String Light 10m', 'Lighting', 'LIGHT-001', '200000000004', 30, 120, 6, 30, 0, 0, 5, 40, 200, 20),
           ('Portable Sound System', 'AV', 'AV-001', '200000000005', 6, 1500, 24, 6, 0, 0, 2, 300, 8000, 250)`
      );
      console.log('Sample inventory seeded.');
    } else if (skipSeedInventory && invCount.rows[0].c === 0) {
      console.log('Skipped sample inventory seed (production / SKIP_SEED_INVENTORY).');
    }

    // Open Telegram workflow: payments may arrive before booking is assigned
    await client.query(`
      ALTER TABLE payments ALTER COLUMN booking_id DROP NOT NULL
    `);
    await client.query(`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_telegram_chat
        ON customers(telegram_chat_id)
        WHERE telegram_chat_id IS NOT NULL AND is_deleted = FALSE
    `);
    await client.query(`
      UPDATE payments p
      SET customer_id = b.customer_id
      FROM bookings b
      WHERE p.booking_id = b.id
        AND p.customer_id IS NULL
    `);

    // Remove previously soft-deactivated staff so they no longer appear anywhere
    const inactive = await client.query(
      `SELECT id FROM users WHERE is_active = FALSE`
    );
    for (const row of inactive.rows) {
      await client.query(`UPDATE payments SET recorded_by = NULL WHERE recorded_by = $1`, [
        row.id,
      ]);
      await client.query(`UPDATE rental_returns SET returned_by = NULL WHERE returned_by = $1`, [
        row.id,
      ]);
      await client.query(`UPDATE bookings SET created_by = NULL WHERE created_by = $1`, [row.id]);
      await client.query(`UPDATE store_settings SET updated_by = NULL WHERE updated_by = $1`, [
        row.id,
      ]);
      await client.query(`UPDATE audit_logs SET user_id = NULL WHERE user_id = $1`, [row.id]);
      await client.query(`DELETE FROM users WHERE id = $1`, [row.id]);
    }
    if (inactive.rows.length) {
      console.log(`Purged ${inactive.rows.length} inactive staff account(s).`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs_archive (
        id            UUID PRIMARY KEY,
        user_id       UUID,
        action        VARCHAR(120) NOT NULL,
        target_table  VARCHAR(80),
        details_json  JSONB DEFAULT '{}'::jsonb,
        ip_address    INET,
        created_at    TIMESTAMPTZ NOT NULL,
        archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created
        ON audit_logs_archive(created_at DESC)
    `);

    console.log('Migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
