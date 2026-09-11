import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { AlertTriangle, Clock } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import { Badge, EmptyState, PageHeader, StatCard, formatMoney } from '../components/ui';

const CHART_DAYS = 14;

/** Build a continuous last-N-days series so the chart never collapses to a single thin spike. */
function padDailySeries(rows, days = CHART_DAYS) {
  const byDay = new Map(
    (rows || []).map((row) => [dayjs(row.bucket).format('YYYY-MM-DD'), Number(row.total) || 0])
  );

  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = dayjs().subtract(i, 'day');
    const key = d.format('YYYY-MM-DD');
    out.push({
      key,
      label: d.format('MMM D'),
      total: byDay.get(key) ?? 0,
    });
  }
  return out;
}

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value) || 0;
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 shadow-md text-sm">
      <p className="text-[var(--color-muted)] text-xs mb-0.5">{label}</p>
      <p className="font-semibold text-[var(--color-brand)]">{formatMoney(value)}</p>
    </div>
  );
}

function barLabel({ x, y, width, value }) {
  const n = Number(value) || 0;
  if (n <= 0 || x == null || y == null) return null;
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

export default function DashboardPage() {
  const { user } = useAuth();
  const canViewRevenue = can.viewRevenueCharts(user?.role);
  const [metrics, setMetrics] = useState(null);
  const [rawSeries, setRawSeries] = useState([]);

  useEffect(() => {
    (async () => {
      const m = await api.get('/reports/dashboard');
      setMetrics(m.data.data);

      if (canViewRevenue) {
        const r = await api.get('/reports/revenue?period=daily');
        setRawSeries(r.data.data || []);
      } else {
        setRawSeries([]);
      }
    })().catch(console.error);
  }, [canViewRevenue]);

  const series = useMemo(() => padDailySeries(rawSeries, CHART_DAYS), [rawSeries]);
  const periodTotal = useMemo(
    () => series.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    [series]
  );
  const hasRevenue = periodTotal > 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          canViewRevenue
            ? 'Live operations overview for the store floor.'
            : 'Agent workspace — bookings, customers, returns, and payments.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {canViewRevenue ? (
          <>
            <StatCard label="Today revenue" value={formatMoney(metrics?.revenue?.today)} />
            <StatCard label="This week" value={formatMoney(metrics?.revenue?.week)} />
            <StatCard label="This month" value={formatMoney(metrics?.revenue?.month)} />
          </>
        ) : (
          <>
            <StatCard label="Confirmed" value={metrics?.bookings?.confirmed ?? 0} />
            <StatCard label="Out for rent" value={metrics?.bookings?.out_for_rent ?? 0} />
            <StatCard label="Overdue" value={metrics?.bookings?.overdue ?? 0} />
          </>
        )}
        <StatCard
          label="Low stock items"
          value={metrics?.low_stock_count ?? '—'}
          hint="Below min threshold"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2 card-panel p-4 overflow-hidden">
          {canViewRevenue ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-xl">Daily revenue</h2>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                    Last {CHART_DAYS} days · approved payments
                  </p>
                </div>
                <p className="text-sm font-semibold text-[var(--color-brand)]">
                  {formatMoney(periodTotal)}
                  <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">period total</span>
                </p>
              </div>

              {!hasRevenue ? (
                <EmptyState message="No approved payments in the last 14 days yet" />
              ) : (
                <div className="h-72 rounded-xl bg-gradient-to-b from-[#e8f3f0] to-white px-1 pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0d6e5f" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#0d6e5f" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="revBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#14967f" />
                          <stop offset="100%" stopColor="#0d6e5f" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 6" stroke="#c5d6d1" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#5c6f6b' }}
                        tickLine={false}
                        axisLine={{ stroke: '#d5e0dc' }}
                        interval="preserveStartEnd"
                        minTickGap={18}
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
                        fill="url(#revArea)"
                        isAnimationActive
                        animationDuration={700}
                      />
                      <Bar
                        dataKey="total"
                        fill="url(#revBar)"
                        radius={[8, 8, 2, 2]}
                        maxBarSize={36}
                        isAnimationActive
                        animationDuration={800}
                      >
                        <LabelList dataKey="total" content={barLabel} />
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="font-display text-xl mb-2">Agent quick actions</h2>
              <p className="text-sm text-[var(--color-muted)] mb-4">
                Use the sidebar for day-to-day work. Reports and system settings are limited to
                managers and admins.
              </p>
              <ul className="grid sm:grid-cols-2 gap-2 text-sm">
                {[
                  ['Customers', 'Create profiles and upload KYC'],
                  ['Schedule & Bookings', 'Check availability and create bookings'],
                  ['Return Equipment', 'Scan and check in returns'],
                  ['Payments & Receipts', 'Record cash, bank, or Telebirr payments'],
                ].map(([title, desc]) => (
                  <li key={title} className="rounded-lg border border-[var(--color-line)] p-3">
                    <p className="font-medium">{title}</p>
                    <p className="text-[var(--color-muted)] text-xs mt-1">{desc}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card-panel p-4">
          <h2 className="font-display text-xl mb-3 flex items-center gap-2">
            <Clock size={18} /> Booking pipeline
          </h2>
          <ul className="space-y-3 text-sm">
            {[
              ['Confirmed', metrics?.bookings?.confirmed],
              ['Out for rent', metrics?.bookings?.out_for_rent],
              ['Overdue', metrics?.bookings?.overdue],
              ['Draft', metrics?.bookings?.draft],
            ].map(([label, value]) => (
              <li key={label} className="flex justify-between border-b border-[var(--color-line)] pb-2">
                <span className="text-[var(--color-muted)]">{label}</span>
                <span className="font-medium">{value ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-panel p-4">
          <h2 className="font-display text-xl mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-[var(--color-warn)]" /> Overdue bookings
          </h2>
          {!metrics?.overdue?.length ? (
            <EmptyState message="No overdue rentals" />
          ) : (
            <ul className="space-y-2">
              {metrics.overdue.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-2 text-sm border-b border-[var(--color-line)] py-2"
                >
                  <div>
                    <p className="font-medium">{b.customer_name}</p>
                    <p className="text-[var(--color-muted)] text-xs">
                      Due {dayjs(b.end_date).format('MMM D, YYYY')}
                    </p>
                  </div>
                  <Badge tone="danger">{formatMoney(b.late_fees_accrued)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-panel p-4">
          <h2 className="font-display text-xl mb-3">Recent payments</h2>
          {!metrics?.recent_payments?.length ? (
            <EmptyState message="No payments yet" />
          ) : (
            <ul className="space-y-2">
              {metrics.recent_payments.map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between text-sm border-b border-[var(--color-line)] py-2"
                >
                  <div>
                    <p className="font-medium">{p.customer_name}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {p.type} · {p.method}
                    </p>
                  </div>
                  <div className="text-right">
                    <p>{formatMoney(p.amount)}</p>
                    <Badge tone={p.status === 'approved' ? 'ok' : 'warn'}>{p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
