-- RentFlow PostgreSQL Schema
-- Soft deletes via is_deleted / deleted_at where applicable

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'manager', 'cashier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'draft', 'confirmed', 'out_for_rent', 'returned', 'overdue', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_type AS ENUM (
    'down_payment', 'collateral_deposit', 'installment', 'final_settlement',
    'late_fee', 'damage_fee', 'deposit_refund'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'deposit_refund';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'bank_transfer', 'telebirr');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       VARCHAR(150) NOT NULL,
  email           VARCHAR(180) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'cashier',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Customers (soft delete)
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       VARCHAR(180) NOT NULL,
  phone           VARCHAR(40),
  email           VARCHAR(180),
  address         TEXT NOT NULL DEFAULT '',
  id_number       VARCHAR(80),
  id_card_url     TEXT,
  telegram_chat_id VARCHAR(80),
  rating          SMALLINT NOT NULL DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
  notes           TEXT,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_customers_rating ON customers(rating) WHERE is_deleted = FALSE;

-- Inventory (soft delete)
CREATE TABLE IF NOT EXISTS inventory_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(200) NOT NULL,
  category              VARCHAR(100),
  sku                   VARCHAR(60) NOT NULL UNIQUE,
  barcode               VARCHAR(80) UNIQUE,
  total_quantity        INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  rental_rate_per_day   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  buffer_time_hours     INTEGER NOT NULL DEFAULT 24,
  qty_good              INTEGER NOT NULL DEFAULT 0 CHECK (qty_good >= 0),
  qty_semi_damaged      INTEGER NOT NULL DEFAULT 0 CHECK (qty_semi_damaged >= 0),
  qty_damaged           INTEGER NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  min_stock_threshold   INTEGER NOT NULL DEFAULT 2,
  damage_fee_semi       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  damage_fee_full       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  late_fee_per_day      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_qty_sum CHECK (
    qty_good + qty_semi_damaged + qty_damaged = total_quantity
  )
);

CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory_items(barcode) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category) WHERE is_deleted = FALSE;

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id),
  start_date          TIMESTAMPTZ NOT NULL,
  end_date            TIMESTAMPTZ NOT NULL,
  buffer_end_date     TIMESTAMPTZ NOT NULL,
  status              booking_status NOT NULL DEFAULT 'draft',
  total_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  collateral_deposit  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  late_fees_accrued   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bookings_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(start_date, end_date, buffer_end_date);

-- Booking line items
CREATE TABLE IF NOT EXISTS booking_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES inventory_items(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12, 2) NOT NULL,
  subtotal    NUMERIC(14, 2) NOT NULL,
  UNIQUE (booking_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_item ON booking_items(item_id);

-- Rental returns / check-ins
CREATE TABLE IF NOT EXISTS rental_returns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                UUID NOT NULL REFERENCES bookings(id),
  item_id                   UUID NOT NULL REFERENCES inventory_items(id),
  qty_returned_good         INTEGER NOT NULL DEFAULT 0 CHECK (qty_returned_good >= 0),
  qty_returned_semi_damaged INTEGER NOT NULL DEFAULT 0 CHECK (qty_returned_semi_damaged >= 0),
  qty_returned_damaged      INTEGER NOT NULL DEFAULT 0 CHECK (qty_returned_damaged >= 0),
  damage_fee                NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes                     TEXT,
  returned_by               UUID REFERENCES users(id),
  returned_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_returns_booking ON rental_returns(booking_id);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID REFERENCES bookings(id),
  customer_id       UUID REFERENCES customers(id),
  amount            NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  type              payment_type NOT NULL,
  method            payment_method NOT NULL,
  reference_number  VARCHAR(120),
  receipt_url       TEXT,
  pdf_receipt_url   TEXT,
  status            VARCHAR(30) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  recorded_by       UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- Store policies / settings (key-value)
CREATE TABLE IF NOT EXISTS store_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id)
);

-- Audit logs (active — retained 90 days; older rows archived by cron)
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  action        VARCHAR(120) NOT NULL,
  target_table  VARCHAR(80),
  details_json  JSONB DEFAULT '{}'::jsonb,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS audit_logs_archive (
  id            UUID PRIMARY KEY,
  user_id       UUID,
  action        VARCHAR(120) NOT NULL,
  target_table  VARCHAR(80),
  details_json  JSONB DEFAULT '{}'::jsonb,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created ON audit_logs_archive(created_at DESC);

-- Default store policies
INSERT INTO store_settings (key, value_json)
VALUES
  ('low_rating_collateral_multiplier', '2'::jsonb),
  ('default_buffer_hours', '24'::jsonb),
  ('default_late_fee_per_day', '500'::jsonb),
  ('currency', '"ETB"'::jsonb),
  ('collateral_tier_low', '500'::jsonb),
  ('collateral_tier_medium', '1500'::jsonb),
  ('collateral_tier_higher', '5000'::jsonb)
ON CONFLICT (key) DO NOTHING;
