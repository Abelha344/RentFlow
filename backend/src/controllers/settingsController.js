const { query } = require('../config/db');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { RETENTION_DAYS } = require('../jobs/auditRetention');

async function listSettings(req, res, next) {
  try {
    const { rows } = await query(`SELECT key, value_json, updated_at FROM store_settings ORDER BY key`);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value_json]));
    res.json({ success: true, data: map, meta: rows });
  } catch (err) {
    next(err);
  }
}

async function updateSetting(req, res, next) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const { rows } = await query(
      `INSERT INTO store_settings (key, value_json, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value_json = EXCLUDED.value_json,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING *`,
      [key, JSON.stringify(value), req.user.id]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: 'settings.update',
      targetTable: 'store_settings',
      details: { key, value },
      ipAddress: clientIp(req),
    });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

function resolveAuditRange(queryParams) {
  const period = String(queryParams.period || 'week').toLowerCase();
  const now = new Date();
  let from = null;
  let to = null;

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (period === 'today') {
    from = startOfDay(now);
    to = endOfDay(now);
  } else if (period === 'week') {
    from = startOfDay(now);
    from.setDate(from.getDate() - 6);
    to = endOfDay(now);
  } else if (period === 'month') {
    from = startOfDay(now);
    from.setDate(1);
    to = endOfDay(now);
  } else if (period === 'custom') {
    if (queryParams.from) from = new Date(queryParams.from);
    if (queryParams.to) to = endOfDay(new Date(queryParams.to));
    if (from && Number.isNaN(from.getTime())) from = null;
    if (to && Number.isNaN(to.getTime())) to = null;
  } else {
    // default: last 7 days
    from = startOfDay(now);
    from.setDate(from.getDate() - 6);
    to = endOfDay(now);
  }

  return { period, from, to };
}

async function listAuditLogs(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const { action, user_id } = req.query;
    const { period, from, to } = resolveAuditRange(req.query);

    const params = [];
    const clauses = ['1=1'];

    if (from) {
      params.push(from.toISOString());
      clauses.push(`a.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to.toISOString());
      clauses.push(`a.created_at <= $${params.length}`);
    }
    if (action) {
      params.push(`%${action}%`);
      clauses.push(`a.action ILIKE $${params.length}`);
    }
    if (user_id) {
      params.push(user_id);
      clauses.push(`a.user_id = $${params.length}`);
    }

    const where = clauses.join(' AND ');

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM audit_logs a WHERE ${where}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await query(
      `SELECT a.*, u.full_name AS user_name, u.email AS user_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      data: rows,
      meta: {
        page,
        limit,
        total,
        total_pages: totalPages,
        period,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        retention_days: RETENTION_DAYS,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listSettings, updateSetting, listAuditLogs };
