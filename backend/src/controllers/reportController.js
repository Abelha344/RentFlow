const { query } = require('../config/db');
const {
  exportInventoryAudit,
  exportPayments,
  exportCustomerHistory,
} = require('../services/excelService');
const path = require('path');

function dayStart(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayEndExclusive(dateStr) {
  const d = dayStart(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + 1);
  return d;
}

/** Map UI period to payment date window + booking date window. */
function resolveWindows(period, from, to, year) {
  const now = new Date();
  if (period === 'custom') {
    const start = dayStart(from);
    const endExclusive = dayEndExclusive(to);
    if (!start || !endExclusive || start >= endExclusive) return null;
    const days = Math.max(1, Math.ceil((endExclusive - start) / 86400000));
    let trunc = 'day';
    if (days > 90) trunc = 'week';
    if (days > 365) trunc = 'month';
    return {
      trunc,
      payStart: start,
      payEnd: endExclusive,
      bookStart: start,
      bookEnd: endExclusive,
      custom: true,
      year: null,
    };
  }

  const start = new Date(now);
  let trunc = 'month';
  let payEnd = now;
  let selectedYear = null;

  if (period === 'daily') {
    start.setDate(start.getDate() - 13); // last 14 days incl. today
    trunc = 'day';
  } else if (period === 'weekly') {
    start.setDate(start.getDate() - 12 * 7);
    trunc = 'week';
  } else if (period === 'annual') {
    start.setFullYear(start.getFullYear() - 5);
    trunc = 'year';
  } else {
    // Calendar year: Jan 1 → Dec 31 (or → now if viewing the current year)
    const y = Number(year);
    selectedYear = Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : now.getFullYear();
    start.setFullYear(selectedYear, 0, 1);
    start.setHours(0, 0, 0, 0);
    trunc = 'month';
    if (selectedYear < now.getFullYear()) {
      payEnd = new Date(selectedYear + 1, 0, 1); // exclusive Jan 1 next year
    } else if (selectedYear > now.getFullYear()) {
      // Future year: empty window that still pads Jan–Dec on the client
      payEnd = new Date(selectedYear, 0, 1);
    } else {
      payEnd = now;
    }
  }

  return {
    trunc,
    payStart: start,
    payEnd,
    bookStart: start,
    bookEnd: payEnd,
    custom: false,
    year: selectedYear,
  };
}

function buildInsights(byCategory, byMethod) {
  const catTotal = byCategory.reduce((s, r) => s + Number(r.value), 0);
  const sorted = [...byCategory].sort((a, b) => Number(b.value) - Number(a.value));
  const top = sorted[0] || null;
  const topShare = catTotal > 0 && top ? (Number(top.value) / catTotal) * 100 : 0;
  const categoriesActive = sorted.filter((r) => Number(r.value) > 0).length;

  const methodTotal = byMethod.reduce((s, r) => s + Number(r.value), 0);
  const topMethod = [...byMethod].sort((a, b) => Number(b.value) - Number(a.value))[0] || null;
  const topMethodShare =
    methodTotal > 0 && topMethod ? (Number(topMethod.value) / methodTotal) * 100 : 0;

  let concentration = 'balanced';
  if (topShare >= 60) concentration = 'concentrated';
  else if (topShare >= 40) concentration = 'moderate';

  const narrative = [];
  if (top && catTotal > 0) {
    narrative.push(
      `${top.name} leads the rental portfolio at ${topShare.toFixed(0)}% of booked value.`
    );
  } else {
    narrative.push('No category mix yet for this window — confirm bookings to unlock portfolio insight.');
  }
  if (categoriesActive >= 3 && topShare < 50) {
    narrative.push('Demand is diversified across multiple equipment lines.');
  } else if (topShare >= 60) {
    narrative.push('Revenue is concentrated — consider promoting underused categories.');
  }
  if (topMethod && methodTotal > 0) {
    narrative.push(
      `Collections favor ${String(topMethod.name).replace(/_/g, ' ')} (${topMethodShare.toFixed(0)}% of approved payments).`
    );
  }

  return {
    portfolio_total: catTotal,
    categories_active: categoriesActive,
    top_category: top ? { name: top.name, value: Number(top.value), share_pct: Number(topShare.toFixed(1)) } : null,
    top_collection_channel: topMethod
      ? {
          name: topMethod.name,
          value: Number(topMethod.value),
          share_pct: Number(topMethodShare.toFixed(1)),
        }
      : null,
    concentration,
    narrative,
  };
}

async function dashboardMetrics(req, res, next) {
  try {
    const [revenue, bookings, lowStock, overdue, recentPayments] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE)), 0) AS week,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0) AS month,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('year', CURRENT_DATE)), 0) AS year
         FROM payments WHERE status = 'approved'`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE status = 'out_for_rent') AS out_for_rent,
           COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
           COUNT(*) FILTER (WHERE status = 'draft') AS draft
         FROM bookings`
      ),
      query(
        `SELECT COUNT(*)::int AS count FROM inventory_items
         WHERE is_deleted = FALSE AND qty_good < min_stock_threshold`
      ),
      query(
        `SELECT b.id, b.end_date, b.late_fees_accrued, c.full_name AS customer_name, b.total_amount
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         WHERE b.status = 'overdue'
         ORDER BY b.end_date ASC
         LIMIT 10`
      ),
      query(
        `SELECT p.id, p.amount, p.type, p.method, p.status, p.created_at, c.full_name AS customer_name
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         JOIN customers c ON c.id = b.customer_id
         ORDER BY p.created_at DESC LIMIT 8`
      ),
    ]);

    res.json({
      success: true,
      data: {
        revenue: revenue.rows[0],
        bookings: bookings.rows[0],
        low_stock_count: lowStock.rows[0].count,
        overdue: overdue.rows,
        recent_payments: recentPayments.rows,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function revenueSeries(req, res, next) {
  try {
    const { period = 'monthly', from, to, year } = req.query;

    if (period === 'custom' && (!from || !to)) {
      return res.status(400).json({
        success: false,
        message: 'Custom range requires from and to dates',
      });
    }

    const win = resolveWindows(period, from, to, year);
    if (!win) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range',
      });
    }

    const { trunc, payStart, payEnd, bookStart, bookEnd } = win;
    const payParams = [payStart.toISOString(), payEnd.toISOString()];
    const bookParams = [bookStart.toISOString(), bookEnd.toISOString()];

    const [seriesRes, methodRes, typeRes, categoryRes, sumRes] = await Promise.all([
      query(
        `SELECT date_trunc($1, created_at) AS bucket,
                COALESCE(SUM(amount), 0)::numeric AS total
         FROM payments
         WHERE status = 'approved'
           AND created_at >= $2::timestamptz
           AND created_at < $3::timestamptz
         GROUP BY 1 ORDER BY 1`,
        [trunc, ...payParams]
      ),
      query(
        `SELECT method::text AS name, COALESCE(SUM(amount), 0)::numeric AS value
         FROM payments
         WHERE status = 'approved'
           AND created_at >= $1::timestamptz
           AND created_at < $2::timestamptz
         GROUP BY method ORDER BY value DESC`,
        payParams
      ),
      query(
        `SELECT type::text AS name, COALESCE(SUM(amount), 0)::numeric AS value
         FROM payments
         WHERE status = 'approved'
           AND created_at >= $1::timestamptz
           AND created_at < $2::timestamptz
         GROUP BY type ORDER BY value DESC`,
        payParams
      ),
      // Portfolio mix: rental line value by equipment category for bookings overlapping the window
      query(
        `SELECT COALESCE(NULLIF(TRIM(i.category), ''), 'Uncategorized') AS name,
                COALESCE(SUM(bi.subtotal), 0)::numeric AS value
         FROM booking_items bi
         JOIN inventory_items i ON i.id = bi.item_id
         JOIN bookings b ON b.id = bi.booking_id
         WHERE b.status IN ('confirmed', 'out_for_rent', 'returned', 'overdue')
           AND b.start_date < $2::timestamptz
           AND b.end_date >= $1::timestamptz
         GROUP BY 1
         ORDER BY value DESC`,
        bookParams
      ),
      query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM payments
         WHERE status = 'approved'
           AND created_at >= $1::timestamptz
           AND created_at < $2::timestamptz`,
        payParams
      ),
    ]);

    const byCategory = categoryRes.rows;
    const byMethod = methodRes.rows;
    const byType = typeRes.rows;
    const insights = buildInsights(byCategory, byMethod);

    res.json({
      success: true,
      data: seriesRes.rows,
      by_category: byCategory,
      by_method: byMethod,
      by_type: byType,
      insights,
      meta: {
        period: win.custom ? 'custom' : period,
        trunc,
        from: win.custom ? from : payStart.toISOString(),
        to: win.custom ? to : payEnd.toISOString(),
        year: win.year,
        range_total: sumRes.rows[0].total,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function exportInventory(req, res, next) {
  try {
    // Full current stock snapshot (period filters apply to payment log only)
    const filePath = await exportInventoryAudit();
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    next(err);
  }
}

async function exportPaymentLog(req, res, next) {
  try {
    const filePath = await exportPayments(req.query.from, req.query.to);
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    next(err);
  }
}

async function exportCustomer(req, res, next) {
  try {
    const filePath = await exportCustomerHistory(req.params.customerId);
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dashboardMetrics,
  revenueSeries,
  exportInventory,
  exportPaymentLog,
  exportCustomer,
};
