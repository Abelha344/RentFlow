const { query } = require('../config/db');
const { generateSku, generateBarcode } = require('../utils/sku');
const { getStockSnapshot } = require('../services/stockService');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { invalidateInventoryCache } = require('../config/cache');
const { dispatchTelegram } = require('../services/asyncJobs');

async function listItems(req, res, next) {
  try {
    const { search, category, low_stock } = req.query;
    const snapshot = await getStockSnapshot();
    let rows = snapshot;

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name?.toLowerCase().includes(q) ||
          r.category?.toLowerCase().includes(q)
      );
    }
    if (category) {
      rows = rows.filter((r) => r.category === category);
    }
    if (low_stock === 'true') {
      rows = rows.filter((r) => r.is_low_stock);
    }

    res.json({ success: true, data: rows.map(publicInventoryItem) });
  } catch (err) {
    next(err);
  }
}

function publicInventoryItem(row) {
  if (!row) return row;
  const { sku, barcode, ...rest } = row;
  return rest;
}

async function getItem(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT * FROM inventory_items WHERE id = $1 AND is_deleted = FALSE`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, data: publicInventoryItem(rows[0]) });
  } catch (err) {
    next(err);
  }
}

async function createItem(req, res, next) {
  try {
    const {
      name,
      category,
      total_quantity,
      rental_rate_per_day,
      buffer_time_hours = 24,
      min_stock_threshold = 2,
      damage_fee_semi = 0,
      damage_fee_full = 0,
      late_fee_per_day = 0,
    } = req.body;

    const qty = Number(total_quantity) || 0;
    const rate = Number(rental_rate_per_day) || 0;
    const bufferHours = Number(buffer_time_hours) || 24;
    const minStock = Number(min_stock_threshold) || 0;
    const feeSemi = Number(damage_fee_semi) || 0;
    const feeFull = Number(damage_fee_full) || 0;
    const lateFee = Number(late_fee_per_day) || 0;

    // Internal only — never shown in the product UI
    let rows;
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      const finalSku = generateSku(category || name);
      const finalBarcode = generateBarcode();
      try {
        const result = await query(
          `INSERT INTO inventory_items (
             name, category, sku, barcode, total_quantity, rental_rate_per_day,
             buffer_time_hours, qty_good, qty_semi_damaged, qty_damaged,
             min_stock_threshold, damage_fee_semi, damage_fee_full, late_fee_per_day
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$5,0,0,$8,$9,$10,$11)
           RETURNING id, name, category, total_quantity, rental_rate_per_day,
             buffer_time_hours, qty_good, qty_semi_damaged, qty_damaged,
             min_stock_threshold, damage_fee_semi, damage_fee_full, late_fee_per_day,
             created_at`,
          [
            name,
            category || null,
            finalSku,
            finalBarcode,
            qty,
            rate,
            bufferHours,
            minStock,
            feeSemi,
            feeFull,
            lateFee,
          ]
        );
        rows = result.rows;
        lastErr = null;
        break;
      } catch (err) {
        // Soft-deleted seed rows still occupy UNIQUE sku/barcode — retry with new codes
        if (err.code === '23505') {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (lastErr || !rows?.[0]) {
      throw lastErr || new Error('Could not create inventory item');
    }

    await writeAuditLog({
      userId: req.user.id,
      action: 'inventory.create',
      targetTable: 'inventory_items',
      details: { item_id: rows[0].id, name: rows[0].name },
      ipAddress: clientIp(req),
    });

    invalidateInventoryCache();
    const io = req.app.get('io');
    io?.emit('inventory:updated', rows[0]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateItem(req, res, next) {
  try {
    const { id } = req.params;
    const fields = [
      'name',
      'category',
      'rental_rate_per_day',
      'buffer_time_hours',
      'min_stock_threshold',
      'damage_fee_semi',
      'damage_fee_full',
      'late_fee_per_day',
    ];

    const existing = await query(
      `SELECT * FROM inventory_items WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const updates = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(req.body[f]);
      }
    }

    if (req.body.rental_rate_per_day !== undefined &&
        Number(req.body.rental_rate_per_day) !== Number(existing.rows[0].rental_rate_per_day)) {
      await writeAuditLog({
        userId: req.user.id,
        action: 'inventory.price_change',
        targetTable: 'inventory_items',
        details: {
          item_id: id,
          from: existing.rows[0].rental_rate_per_day,
          to: req.body.rental_rate_per_day,
        },
        ipAddress: clientIp(req),
      });
    }

    if (!updates.length) {
      return res.json({ success: true, data: publicInventoryItem(existing.rows[0]) });
    }

    values.push(id);
    const { rows } = await query(
      `UPDATE inventory_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    const item = publicInventoryItem(rows[0]);
    invalidateInventoryCache();
    const io = req.app.get('io');
    io?.emit('inventory:updated', item);

    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
}

async function adjustStock(req, res, next) {
  try {
    const { id } = req.params;
    const { qty_good, qty_semi_damaged, qty_damaged, reason } = req.body;

    const good = Number(qty_good);
    const semi = Number(qty_semi_damaged);
    const damaged = Number(qty_damaged);
    const total = good + semi + damaged;

    const { rows } = await query(
      `UPDATE inventory_items
       SET qty_good = $1, qty_semi_damaged = $2, qty_damaged = $3, total_quantity = $4
       WHERE id = $5 AND is_deleted = FALSE
       RETURNING *`,
      [good, semi, damaged, total, id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    await writeAuditLog({
      userId: req.user.id,
      action: 'inventory.stock_override',
      targetTable: 'inventory_items',
      details: { item_id: id, qty_good: good, qty_semi_damaged: semi, qty_damaged: damaged, reason },
      ipAddress: clientIp(req),
    });

    const item = publicInventoryItem(rows[0]);
    invalidateInventoryCache();
    const io = req.app.get('io');
    io?.emit('inventory:updated', item);

    if (item.qty_good < item.min_stock_threshold) {
      io?.emit('stock:low', {
        item,
        available: item.qty_good,
        threshold: item.min_stock_threshold,
      });
      dispatchTelegram(
        {
          type: 'low_stock',
          message: `⚠️ Low stock: <b>${item.name}</b> — good qty ${item.qty_good} (threshold ${item.min_stock_threshold})`,
        },
        io
      );
    }

    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
}

async function softDeleteItem(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE inventory_items SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    await writeAuditLog({
      userId: req.user.id,
      action: 'inventory.soft_delete',
      targetTable: 'inventory_items',
      details: { item_id: req.params.id },
      ipAddress: clientIp(req),
    });
    invalidateInventoryCache();
    res.json({ success: true, message: 'Item soft-deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  adjustStock,
  softDeleteItem,
};
