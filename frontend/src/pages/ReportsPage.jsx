import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { CalendarRange, Download, Lightbulb, TrendingUp } from 'lucide-react';
import api from '../lib/api';
import { Button, EmptyState, Input, PageHeader, Select, formatMoney } from '../components/ui';

const PIE_COLORS = ['#0d6e5f', '#1d4ed8', '#c45c26', '#7c3aed', '#ca8a04', '#be123c', '#0891b2', '#64748b'];

/** Fixed colors so Cash / Bank / Telebirr never look the same. */
const METHOD_PIE_COLORS = {
  cash: '#c45c26',
  bank_transfer: '#1d4ed8',
  telebirr: '#0d6e5f',
};

/** Fixed colors for equipment categories (AV vs Lighting must differ). */
const CATEGORY_PIE_COLORS = {
  tents: '#0d6e5f',
  seating: '#7c3aed',
  tables: '#1d4ed8',
  lighting: '#ca8a04',
  av: '#be123c',
  audio: '#be123c',
  video: '#db2777',
};

/** Fixed colors for payment stages (installment vs down payment must differ). */
const TYPE_PIE_COLORS = {
  collateral_deposit: '#0d6e5f',
  down_payment: '#ca8a04',
  installment: '#1d4ed8',
  final_settlement: '#7c3aed',
  deposit_refund: '#0891b2',
  damage_fee: '#be123c',
  late_fee: '#c45c26',
};

function pieSliceColor(name, idx) {
  const key = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (METHOD_PIE_COLORS[key]) return METHOD_PIE_COLORS[key];
  if (CATEGORY_PIE_COLORS[key]) return CATEGORY_PIE_COLORS[key];
  if (TYPE_PIE_COLORS[key]) return TYPE_PIE_COLORS[key];
  if (key.includes('bank')) return METHOD_PIE_COLORS.bank_transfer;
  if (key.includes('telebirr')) return METHOD_PIE_COLORS.telebirr;
  if (key === 'cash') return METHOD_PIE_COLORS.cash;
  if (key.includes('light')) return CATEGORY_PIE_COLORS.lighting;
  if (key === 'av' || key.includes('audio') || key.includes('sound')) {
    return CATEGORY_PIE_COLORS.av;
  }
  if (key.includes('down')) return TYPE_PIE_COLORS.down_payment;
  if (key.includes('install')) return TYPE_PIE_COLORS.installment;
  if (key.includes('refund')) return TYPE_PIE_COLORS.deposit_refund;
  if (key.includes('collateral') || (key.includes('deposit') && !key.includes('refund'))) {
    return TYPE_PIE_COLORS.collateral_deposit;
  }
  if (key.includes('settlement') || key.includes('final')) {
    return TYPE_PIE_COLORS.final_settlement;
  }
  if (key.includes('damage')) return TYPE_PIE_COLORS.damage_fee;
  if (key.includes('late')) return TYPE_PIE_COLORS.late_fee;
  return PIE_COLORS[idx % PIE_COLORS.length];
}

function labelFormat(bucket, trunc, period) {
  if (trunc === 'day' || period === 'daily') return dayjs(bucket).format('MMM D');
  if (trunc === 'year' || period === 'annual') return dayjs(bucket).format('YYYY');
  if (trunc === 'week') return dayjs(bucket).format('MMM D');
  // Month name only — year lives in the chart header badge
  return dayjs(bucket).format('MMM');
}

function bucketUnit(trunc) {
  if (trunc === 'day') return 'day';
  if (trunc === 'week') return 'week';
  if (trunc === 'year') return 'year';
  return 'month';
}

function bucketKey(date, trunc) {
  const d = dayjs(date);
  if (trunc === 'day') return d.format('YYYY-MM-DD');
  if (trunc === 'week') return d.startOf('week').format('YYYY-MM-DD');
  if (trunc === 'year') return d.format('YYYY');
  return d.format('YYYY-MM');
}

/** Full Jan→Dec calendar for the active year (clear month order). */
function padMonthlyYear(rows, year) {
  const byKey = new Map(
    (rows || []).map((row) => [bucketKey(row.bucket, 'month'), Number(row.total) || 0])
  );
  const now = dayjs();
  const out = [];
  for (let month = 0; month < 12; month += 1) {
    const cursor = dayjs().year(year).month(month).startOf('month');
    const key = bucketKey(cursor, 'month');
    const isFuture = cursor.isAfter(now, 'month');
    out.push({
      key,
      label: cursor.format('MMM'),
      fullLabel: cursor.format('MMMM YYYY'),
      year,
      total: isFuture ? 0 : byKey.get(key) ?? 0,
      isFuture,
      isCurrent: cursor.isSame(now, 'month'),
    });
  }
  return out;
}

/** Fill missing buckets for non-monthly periods. */
function padRevenueSeries(rows, trunc, fromIso, toIso, period, year) {
  if (trunc === 'month' && period === 'monthly') {
    return padMonthlyYear(rows, year || dayjs(toIso || undefined).year());
  }

  const unit = bucketUnit(trunc);
  const byKey = new Map(
    (rows || []).map((row) => [bucketKey(row.bucket, trunc), Number(row.total) || 0])
  );

  let cursor = dayjs(fromIso).startOf(unit === 'week' ? 'week' : unit);
  const end = dayjs(toIso);
  const out = [];
  let guard = 0;

  while ((cursor.isBefore(end) || cursor.isSame(end, unit)) && guard < 400) {
    const key = bucketKey(cursor, trunc);
    const isDay = trunc === 'day' || period === 'daily';
    out.push({
      key,
      label: labelFormat(cursor, trunc, period),
      fullLabel: isDay
        ? cursor.format('MMM D, YYYY')
        : trunc === 'month'
          ? cursor.format('MMMM YYYY')
          : labelFormat(cursor, trunc, period),
      year: cursor.year(),
      total: byKey.get(key) ?? 0,
      isFuture: false,
      isCurrent: isDay ? cursor.isSame(dayjs(), 'day') : false,
    });
    cursor = cursor.add(1, unit);
    guard += 1;
  }

  return out.length ? out : [];
}

function seriesYearLabel(series, period, appliedCustom, selectedYear) {
  if (period === 'monthly' && selectedYear) return String(selectedYear);
  if (period === 'custom' && appliedCustom) {
    const a = dayjs(appliedCustom.from).year();
    const b = dayjs(appliedCustom.to).year();
    return a === b ? String(a) : `${a}–${b}`;
  }
  if (!series.length) return String(dayjs().year());
  const years = [...new Set(series.map((r) => r.year).filter(Boolean))];
  if (years.length === 1) return String(years[0]);
  if (years.length > 1) return `${Math.min(...years)}–${Math.max(...years)}`;
  return String(dayjs().year());
}

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => dayjs().year() - i);

function RevenueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const value = Number(payload[0]?.value) || 0;
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 shadow-md text-sm">
      <p className="text-[var(--color-muted)] text-xs mb-0.5">
        {row.fullLabel || row.label}
        {row.isFuture ? ' · upcoming' : ''}
      </p>
      <p className="font-semibold text-[var(--color-brand)]">{formatMoney(value)}</p>
    </div>
  );
}

function barLabel({ x, y, width, value, payload }) {
  const n = Number(value) || 0;
  if (n <= 0 || x == null || y == null || width < 14 || payload?.isFuture) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fill="#085448"
      fontSize={11}
      fontWeight={600}
    >
      {n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n)}
    </text>
  );
}

function bucketLabel(row) {
  if (!row) return '—';
  return row.fullLabel?.replace(/, \d{4}$/, '') || row.label || '—';
}

function buildSeriesInsights(series) {
  const elapsed = series.filter((r) => !r.isFuture);
  const values = elapsed.map((r) => Number(r.total) || 0);
  const total = values.reduce((s, v) => s + v, 0);
  const activeCount = values.filter((v) => v > 0).length;
  const avg = activeCount ? total / activeCount : 0;
  let peakIdx = -1;
  let peak = 0;
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
  });

  const latestIdx = values.length - 1;
  const latest = latestIdx >= 0 ? values[latestIdx] : 0;

  return {
    total,
    avg,
    peak,
    peakLabel: peakIdx >= 0 ? bucketLabel(elapsed[peakIdx]) : '—',
    latest,
    latestLabel: latestIdx >= 0 ? bucketLabel(elapsed[latestIdx]) : '—',
    activeCount,
    emptyCount: Math.max(0, elapsed.length - activeCount),
    elapsedCount: elapsed.length,
  };
}

function prettyName(name) {
  return String(name || '—')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const PIE_MODES = {
  category: {
    label: 'Equipment portfolio',
    title: 'Rental portfolio mix',
    goal: 'Which equipment categories drive booked rental value in this period — use this to prioritize stock, pricing, and marketing.',
  },
  method: {
    label: 'Collection channels',
    title: 'Collections mix',
    goal: 'How customers actually pay (Cash, Bank Transfer, Telebirr) — useful for cashier staffing and reconciliation risk.',
  },
  type: {
    label: 'Payment stages',
    title: 'Payment-stage mix',
    goal: 'Share of approved money by stage (down payment, collateral, installment, settlement) — tracks cash-flow quality.',
  },
};

const EXPORT_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

function exportDateRange(period, fromDate, toDate) {
  const now = dayjs();
  if (period === 'today') {
    const d = now.format('YYYY-MM-DD');
    return { from: d, to: d, label: now.format('MMM D, YYYY') };
  }
  if (period === 'month') {
    return {
      from: now.startOf('month').format('YYYY-MM-DD'),
      to: now.format('YYYY-MM-DD'),
      label: now.format('MMMM YYYY'),
    };
  }
  if (period === 'year') {
    return {
      from: now.startOf('year').format('YYYY-MM-DD'),
      to: now.format('YYYY-MM-DD'),
      label: String(now.year()),
    };
  }
  const from = dayjs(fromDate);
  const to = dayjs(toDate);
  return {
    from: from.format('YYYY-MM-DD'),
    to: to.format('YYYY-MM-DD'),
    label: `${from.format('MMM D, YYYY')} → ${to.format('MMM D, YYYY')}`,
  };
}

export default function ReportsPage() {
  const [period, setPeriod] = useState('monthly');
  const [reportYear, setReportYear] = useState(dayjs().year());
  const [customFrom, setCustomFrom] = useState(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [customTo, setCustomTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [appliedCustom, setAppliedCustom] = useState(null);
  const [series, setSeries] = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [byMethod, setByMethod] = useState([]);
  const [byType, setByType] = useState([]);
  const [insights, setInsights] = useState(null);
  const [pieView, setPieView] = useState('category');
  const [rangeTotal, setRangeTotal] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [exportPeriod, setExportPeriod] = useState('month');
  const [exportFrom, setExportFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [exportTo, setExportTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [exportNotice, setExportNotice] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError('');

      if (period === 'custom' && !appliedCustom) {
        setSeries([]);
        setByCategory([]);
        setByMethod([]);
        setByType([]);
        setInsights(null);
        setRangeTotal(null);
        try {
          const m = await api.get('/reports/dashboard');
          if (!cancelled) setMetrics(m.data.data);
        } catch (err) {
          if (!cancelled) setError(err.response?.data?.message || 'Failed to load dashboard');
        }
        return;
      }

      const params =
        period === 'custom' && appliedCustom
          ? { period: 'custom', from: appliedCustom.from, to: appliedCustom.to }
          : period === 'monthly'
            ? { period, year: reportYear }
            : { period };

      try {
        const [r, m] = await Promise.all([
          api.get('/reports/revenue', { params }),
          api.get('/reports/dashboard'),
        ]);
        if (cancelled) return;

        const trunc = r.data.meta?.trunc || 'month';
        const fromIso = r.data.meta?.from || dayjs().subtract(12, 'month').toISOString();
        const toIso = r.data.meta?.to || dayjs().toISOString();
        const yearForPad = Number(r.data.meta?.year) || reportYear;
        setSeries(padRevenueSeries(r.data.data || [], trunc, fromIso, toIso, period, yearForPad));
        setByCategory(
          (r.data.by_category || []).map((row) => ({
            name: prettyName(row.name),
            value: Number(row.value),
          }))
        );
        setByMethod(
          (r.data.by_method || []).map((row) => ({
            name: prettyName(row.name),
            value: Number(row.value),
          }))
        );
        setByType(
          (r.data.by_type || []).map((row) => ({
            name: prettyName(row.name),
            value: Number(row.value),
          }))
        );
        setInsights(r.data.insights || null);
        setRangeTotal(
          period === 'custom' ? Number(r.data.meta?.range_total || 0) : Number(r.data.meta?.range_total || 0)
        );
        setMetrics(m.data.data);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err.response?.data?.message || 'Failed to load reports');
          setSeries([]);
          setByCategory([]);
          setByMethod([]);
          setByType([]);
          setInsights(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [period, appliedCustom, reportYear]);

  const applyCustomRange = () => {
    if (!customFrom || !customTo) {
      setError('Select both start and end dates');
      return;
    }
    if (dayjs(customFrom).isAfter(dayjs(customTo))) {
      setError('Start date must be before end date');
      return;
    }
    setError('');
    setPeriod('custom');
    setAppliedCustom({ from: customFrom, to: customTo });
  };

  const download = async (path, filename) => {
    const res = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportRange = useMemo(
    () => exportDateRange(exportPeriod, exportFrom, exportTo),
    [exportPeriod, exportFrom, exportTo]
  );

  const downloadExport = async (kind) => {
    setExportNotice('');
    if (exportPeriod === 'custom') {
      if (!exportFrom || !exportTo) {
        setExportNotice('Select both start and end dates for the export.');
        return;
      }
      if (dayjs(exportFrom).isAfter(dayjs(exportTo))) {
        setExportNotice('Export start date must be before end date.');
        return;
      }
    }

    try {
      if (kind === 'inventory') {
        await download('/reports/export/inventory', `inventory-audit-${exportPeriod}.xlsx`);
        return;
      }

      const params = new URLSearchParams({
        from: exportRange.from,
        to: exportRange.to,
      });
      await download(
        `/reports/export/payments?${params}`,
        `payments-${exportPeriod}.xlsx`
      );
    } catch (err) {
      setExportNotice(err.response?.data?.message || 'Could not download Excel file');
    }
  };

  const chartTitle =
    period === 'custom' && appliedCustom
      ? `Collected revenue (${dayjs(appliedCustom.from).format('MMM D, YYYY')} – ${dayjs(appliedCustom.to).format('MMM D, YYYY')})`
      : `Collected revenue · ${period}`;

  const seriesInsights = useMemo(() => buildSeriesInsights(series), [series]);
  const hasRevenue = seriesInsights.total > 0;
  const chartYear = useMemo(
    () => seriesYearLabel(series, period, appliedCustom, reportYear),
    [series, period, appliedCustom, reportYear]
  );
  const isMonthlyCalendar = period === 'monthly';
  const xAxisConfig = useMemo(() => {
    const n = series.length;
    if (period === 'monthly' || n <= 12) {
      return {
        interval: 0,
        angle: 0,
        height: 36,
        fontSize: 12,
        textAnchor: 'middle',
        minTickGap: 4,
        dy: 4,
      };
    }
    // Daily / dense series: every tick as "Sep 8", angled so month+day stays readable
    if (period === 'daily' || n <= 16) {
      return {
        interval: 0,
        angle: -48,
        height: 70,
        fontSize: 11,
        textAnchor: 'end',
        minTickGap: 0,
        dy: 8,
      };
    }
    return {
      interval: 'preserveStartEnd',
      angle: -40,
      height: 64,
      fontSize: 10,
      textAnchor: 'end',
      minTickGap: 20,
      dy: 6,
    };
  }, [period, series.length]);

  const dailyRangeNote = useMemo(() => {
    if (period !== 'daily' || !series.length) return '';
    const first = series[0]?.fullLabel?.replace(/, \d{4}$/, '');
    const last = series[series.length - 1]?.fullLabel?.replace(/, \d{4}$/, '');
    if (!first || !last) return '';
    return `${first} → ${last}`;
  }, [period, series]);

  const mode = PIE_MODES[pieView];
  const pieData = useMemo(() => {
    if (pieView === 'category') return byCategory;
    if (pieView === 'type') return byType;
    return byMethod;
  }, [pieView, byCategory, byMethod, byType]);

  const pieTotal = pieData.reduce((s, r) => s + r.value, 0);

  const periodNoun =
    period === 'daily' ? 'day' : period === 'weekly' ? 'week' : period === 'annual' ? 'year' : 'month';
  const periodNounPlural =
    period === 'daily' ? 'days' : period === 'weekly' ? 'weeks' : period === 'annual' ? 'years' : 'months';
  const latestTitle =
    isMonthlyCalendar || period === 'monthly'
      ? 'This month'
      : period === 'daily'
        ? 'Latest day'
        : period === 'weekly'
          ? 'Latest week'
          : 'Latest period';

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Executive revenue views and Excel exports for audits."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {period === 'monthly' && (
              <Select
                label="Year"
                value={reportYear}
                onChange={(e) => setReportYear(Number(e.target.value))}
                className="w-auto min-w-[6.5rem]"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label="View"
              value={period === 'custom' ? 'custom' : period}
              onChange={(e) => {
                const next = e.target.value;
                setPeriod(next);
                if (next !== 'custom') setAppliedCustom(null);
              }}
              className="w-auto min-w-[9rem]"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom range</option>
            </Select>
          </div>
        }
      />

      <div className="card-panel p-4 mb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-display text-lg flex items-center gap-2">
              <CalendarRange size={18} /> Custom filter
            </h2>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              Pick a start and end date to filter charts, insights, and payment exports.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Input
              label="From"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo || undefined}
            />
            <Input
              label="To"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom || undefined}
            />
            <Button type="button" onClick={applyCustomRange}>
              Apply range
            </Button>
          </div>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {[
          ['Today collected', metrics?.revenue?.today],
          ['This week', metrics?.revenue?.week],
          ['This month', metrics?.revenue?.month],
          period === 'custom' && appliedCustom
            ? ['Selected range', rangeTotal]
            : ['This year', metrics?.revenue?.year],
        ].map(([label, value]) => (
          <div key={label} className="card-panel p-4">
            <p className="text-xs uppercase text-[var(--color-muted)]">{label}</p>
            <p className="font-display text-xl mt-1">{formatMoney(value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5 mb-6">
        <div className="card-panel p-4 lg:col-span-3 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="font-display text-xl capitalize">{chartTitle}</h2>
                {isMonthlyCalendar ? (
                  <label className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] pl-3 pr-1.5 py-0.5 text-sm font-semibold text-white shadow-sm">
                    <span className="tracking-wide">Year</span>
                    <select
                      value={reportYear}
                      onChange={(e) => setReportYear(Number(e.target.value))}
                      className="rounded-full border-0 bg-white/15 px-2 py-0.5 text-sm font-semibold text-white outline-none focus:ring-2 focus:ring-white/40"
                      aria-label="Select report year"
                    >
                      {YEAR_OPTIONS.map((y) => (
                        <option key={y} value={y} className="text-[var(--color-ink)]">
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-[var(--color-brand)] px-3 py-0.5 text-sm font-semibold text-white tracking-wide shadow-sm">
                    {chartYear}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-muted)]">
                {isMonthlyCalendar
                  ? `Calendar ${reportYear} · Jan → Dec. Change the year badge to compare past years.`
                  : period === 'daily'
                    ? `Recent ${series.length || 14} days · each tick is month + day (e.g. Sep 8). ${dailyRangeNote}`
                    : 'Approved payment inflows over the selected period.'}
              </p>
            </div>
            {hasRevenue && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Period total</p>
                <p className="font-display text-2xl text-[var(--color-brand)]">
                  {formatMoney(seriesInsights.total)}
                </p>
              </div>
            )}
          </div>

          {hasRevenue && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Best {periodNoun}
                </p>
                <p className="font-semibold text-sm mt-0.5">{formatMoney(seriesInsights.peak)}</p>
                <p className="text-[11px] text-[var(--color-muted)]">{seriesInsights.peakLabel}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {latestTitle}
                </p>
                <p className="font-semibold text-sm mt-0.5">{formatMoney(seriesInsights.latest)}</p>
                <p className="text-[11px] text-[var(--color-muted)]">{seriesInsights.latestLabel}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Average collection
                </p>
                <p className="font-semibold text-sm mt-0.5">{formatMoney(seriesInsights.avg)}</p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  Across {periodNounPlural} that got paid
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  No money collected
                </p>
                <p className="font-semibold text-sm mt-0.5">
                  {seriesInsights.emptyCount}{' '}
                  <span className="font-normal text-[var(--color-muted)]">{periodNounPlural}</span>
                </p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  Paid in {seriesInsights.activeCount}{' '}
                  {seriesInsights.activeCount === 1 ? periodNoun : periodNounPlural}
                </p>
              </div>
            </div>
          )}

          <div className={`${period === 'daily' ? 'h-[22rem]' : 'h-80'}`}>
            {series.length && (hasRevenue || isMonthlyCalendar) ? (
              <div className="h-full rounded-xl bg-gradient-to-b from-[#e8f3f0] to-white px-1 pt-2 pb-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={series}
                    margin={{
                      top: 22,
                      right: 12,
                      left: 0,
                      bottom: period === 'daily' ? 28 : xAxisConfig.angle ? 12 : 8,
                    }}
                  >
                    <defs>
                      <linearGradient id="reportsRevArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d6e5f" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#0d6e5f" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="reportsRevBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14967f" />
                        <stop offset="100%" stopColor="#0d6e5f" />
                      </linearGradient>
                      <linearGradient id="reportsRevBarNow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#c45c26" />
                        <stop offset="100%" stopColor="#9a4519" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 6" stroke="#c5d6d1" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{
                        fontSize: xAxisConfig.fontSize,
                        fill: '#5c6f6b',
                        fontWeight: 500,
                      }}
                      tickLine={false}
                      axisLine={{ stroke: '#d5e0dc' }}
                      interval={xAxisConfig.interval}
                      minTickGap={xAxisConfig.minTickGap}
                      angle={xAxisConfig.angle}
                      textAnchor={xAxisConfig.textAnchor}
                      height={xAxisConfig.height}
                      dy={xAxisConfig.dy}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#5c6f6b' }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                    />
                    <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(13,110,95,0.08)' }} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="none"
                      fill="url(#reportsRevArea)"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="total"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={period === 'daily' ? 28 : 36}
                    >
                      {series.map((row) => (
                        <Cell
                          key={row.key}
                          fill={
                            row.isFuture
                              ? '#d5e0dc'
                              : row.isCurrent
                                ? 'url(#reportsRevBarNow)'
                                : 'url(#reportsRevBar)'
                          }
                          fillOpacity={row.isFuture ? 0.45 : 1}
                        />
                      ))}
                      <LabelList dataKey="total" content={barLabel} />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                message={
                  period === 'custom' && !appliedCustom
                    ? 'Select dates above and click Apply range'
                    : 'No approved payment revenue in this period'
                }
              />
            )}
          </div>
          {isMonthlyCalendar && !hasRevenue && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              No approved collections in {reportYear} yet — switch year to compare other calendars.
            </p>
          )}
          {isMonthlyCalendar && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-brand)]" /> Past months
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]" /> This month
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-line)]" /> Upcoming
              </span>
            </div>
          )}
        </div>

        <div className="card-panel p-4 lg:col-span-2 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Strategic insight
              </p>
              <h2 className="font-display text-xl mt-0.5">{mode.title}</h2>
            </div>
            <Select
              value={pieView}
              onChange={(e) => setPieView(e.target.value)}
              className="w-auto min-w-[11rem] shrink-0"
            >
              <option value="category">{PIE_MODES.category.label}</option>
              <option value="method">{PIE_MODES.method.label}</option>
              <option value="type">{PIE_MODES.type.label}</option>
            </Select>
          </div>
          <p className="text-sm text-[var(--color-muted)] mb-3">{mode.goal}</p>

          {insights?.top_category && pieView === 'category' && (
            <div className="mb-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <TrendingUp size={16} className="text-[var(--color-brand)]" />
                Top line: {insights.top_category.name}
              </div>
              <p className="text-[var(--color-muted)] mt-0.5">
                {insights.top_category.share_pct}% of booked rental value ·{' '}
                {formatMoney(insights.top_category.value)}
              </p>
            </div>
          )}

          <div className="h-56 flex-1 min-h-[14rem]">
            {pieData.length && pieTotal > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="48%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {pieData.map((row, idx) => (
                      <Cell key={idx} fill={pieSliceColor(row.name, idx)} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [
                      formatMoney(v),
                      `${name}${pieTotal ? ` (${((Number(v) / pieTotal) * 100).toFixed(0)}%)` : ''}`,
                    ]}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                message={
                  pieView === 'category'
                    ? 'No booking portfolio yet — create confirmed bookings to see category contribution'
                    : 'No approved payments yet — approve receipts to see collection mix'
                }
              />
            )}
          </div>

          {insights?.narrative?.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--color-line)] p-3 text-sm space-y-1.5">
              <p className="font-medium flex items-center gap-1.5">
                <Lightbulb size={15} className="text-[var(--color-accent)]" />
                Decision notes
              </p>
              {insights.narrative.map((line) => (
                <p key={line} className="text-[var(--color-muted)] leading-snug">
                  {line}
                </p>
              ))}
              {insights.concentration && pieView === 'category' && (
                <p className="text-xs pt-1">
                  Concentration: <span className="font-medium capitalize">{insights.concentration}</span>
                  {insights.categories_active != null && (
                    <> · {insights.categories_active} active categories</>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card-panel p-4">
        <h2 className="font-display text-xl mb-1">Excel exports</h2>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          <strong>Payment log</strong> uses the period below. <strong>Inventory audit</strong> always
          downloads your current stock (all items).
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-muted)]">Payment period</span>
          {EXPORT_PERIODS.map((p) => (
            <Button
              key={p.value}
              type="button"
              variant={exportPeriod === p.value ? 'primary' : 'secondary'}
              onClick={() => {
                setExportPeriod(p.value);
                setExportNotice('');
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {exportPeriod === 'custom' && (
          <div className="mb-3 flex flex-col sm:flex-row gap-2 sm:items-end">
            <Input
              label="From"
              type="date"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              max={exportTo || undefined}
            />
            <Input
              label="To"
              type="date"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
              min={exportFrom || undefined}
            />
          </div>
        )}

        <p className="text-xs text-[var(--color-muted)] mb-3">
          Payment log range:{' '}
          <span className="font-medium text-[var(--color-ink)]">{exportRange.label}</span>
        </p>

        {exportNotice && (
          <p className="mb-3 text-sm text-[var(--color-danger)]">{exportNotice}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" type="button" onClick={() => downloadExport('inventory')}>
            <Download size={16} /> Inventory audit
          </Button>
          <Button variant="secondary" type="button" onClick={() => downloadExport('payments')}>
            <Download size={16} /> Payment log
          </Button>
        </div>
      </div>
    </div>
  );
}
