-- Clear demo / seed inventory for production (safe soft-delete).
-- Run in Neon SQL Editor, then refresh Inventory in the app.
--
-- Seed SKUs from migrate.js:
--   TENT-001, CHAIR-001, TABLE-001, LIGHT-001, AV-001

UPDATE inventory_items
SET is_deleted = TRUE
WHERE is_deleted = FALSE
  AND (
    sku IN ('TENT-001', 'CHAIR-001', 'TABLE-001', 'LIGHT-001', 'AV-001')
    OR name IN (
      'White Party Tent 10x20',
      'Folding Banquet Chair',
      'Round Table 60in',
      'LED String Light 10m',
      'Portable Sound System'
    )
  );

-- Confirm what remains visible:
SELECT id, name, sku, is_deleted
FROM inventory_items
ORDER BY created_at;
