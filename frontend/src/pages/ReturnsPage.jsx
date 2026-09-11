import { useEffect, useMemo, useState } from 'react';
import { Mail, Printer, Send } from 'lucide-react';
import dayjs from 'dayjs';
import api from '../lib/api';
import { assetUrl } from '../lib/assets';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import { Badge, Button, EmptyState, Input, PageHeader, Select, formatMoney } from '../components/ui';
import { labelBookingStatus, labelPaymentMethod } from '../lib/labels';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'out_for_rent', label: 'Out for rent' },
  { value: 'returned', label: 'Returned' },
  { value: 'overdue', label: 'Overdue' },
];

function Step({ n, title, active, done, children }) {
  return (
    <section
      className={`rounded-xl border p-4 space-y-3 ${
        active
          ? 'border-[var(--color-brand)] bg-white'
          : 'border-[var(--color-line)] bg-[var(--color-surface)]/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
            done
              ? 'bg-[var(--color-ok)] text-white'
              : active
                ? 'bg-[var(--color-brand)] text-white'
                : 'bg-[var(--color-line)] text-[var(--color-muted)]'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <h3 className="font-display text-lg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function ReturnsPage() {
  const { user } = useAuth();
  const canApprove = can.approvePayment(user?.role);
  const [activeBookings, setActiveBookings] = useState([]);
  const [statusFilter, setStatusFilter] = useState('out_for_rent');
  const [bookingId, setBookingId] = useState('');
  const [booking, setBooking] = useState(null);
  const [lines, setLines] = useState({});
  const [result, setResult] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [settling, setSettling] = useState(false);
  const [payMethod, setPayMethod] = useState('telebirr');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [sharing, setSharing] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const lineList = useMemo(() => Object.values(lines), [lines]);
  const totalBooked = useMemo(
    () => lineList.reduce((sum, l) => sum + Number(l.booked || 0), 0),
    [lineList]
  );

  const returnedTotal = (line) =>
    Number(line.qty_returned_good || 0) +
    Number(line.qty_returned_semi_damaged || 0) +
    Number(line.qty_returned_damaged || 0);

  const allCountsMatch = useMemo(
    () => lineList.every((l) => returnedTotal(l) === Number(l.booked)),
    [lineList]
  );

  const estimatedDamage = useMemo(
    () =>
      lineList.reduce((sum, l) => {
        const semi = Number(l.qty_returned_semi_damaged || 0) * Number(l.damage_fee_semi || 0);
        const full = Number(l.qty_returned_damaged || 0) * Number(l.damage_fee_full || 0);
        return sum + semi + full;
      }, 0),
    [lineList]
  );

  useEffect(() => {
    api
      .get('/bookings')
      .then(({ data }) => {
        const list = (data.data || []).filter((b) => b.status !== 'cancelled');
        setActiveBookings(list);
      })
      .catch(console.error);
  }, []);

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return activeBookings;
    return activeBookings.filter((b) => b.status === statusFilter);
  }, [activeBookings, statusFilter]);

  const loadBooking = async (id) => {
    setBookingId(id);
    setResult(null);
    setSettlement(null);
    setShareMsg('');
    if (!id) {
      setBooking(null);
      setLines({});
      return;
    }
    const { data } = await api.get(`/bookings/${id}`);
    setBooking(data.data);
    const init = {};
    data.data.items.forEach((it) => {
      init[it.item_id] = {
        item_id: it.item_id,
        name: it.name,
        booked: it.quantity,
        damage_fee_semi: it.damage_fee_semi,
        damage_fee_full: it.damage_fee_full,
        qty_returned_good: it.quantity,
        qty_returned_semi_damaged: 0,
        qty_returned_damaged: 0,
      };
    });
    setLines(init);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!allCountsMatch || submitting) return;
    setSubmitting(true);
    setShareMsg('');
    try {
      const items = Object.values(lines).map(
        ({ item_id, qty_returned_good, qty_returned_semi_damaged, qty_returned_damaged }) => ({
          item_id,
          qty_returned_good: Number(qty_returned_good),
          qty_returned_semi_damaged: Number(qty_returned_semi_damaged),
          qty_returned_damaged: Number(qty_returned_damaged),
        })
      );
      const { data } = await api.post(`/returns/${bookingId}`, { items });
      setResult(data.data);
      setSettlement(data.data?.settlement || null);
      setPayAmount(
        data.data?.money?.rental_unpaid > 0 ? String(data.data.money.rental_unpaid) : ''
      );
    } catch (err) {
      setShareMsg(err.response?.data?.message || 'Check-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const applySettlementState = (payload, message) => {
    setSettlement(payload);
    setResult((prev) =>
      prev
        ? {
            ...prev,
            money: payload.money || prev.money,
            payments: payload.payments || prev.payments,
            damage_breakdown: payload.damage_breakdown || prev.damage_breakdown,
            totalDamageFee:
              payload.totalDamageFee != null ? payload.totalDamageFee : prev.totalDamageFee,
          }
        : prev
    );
    const unpaid = Number(payload.money?.rental_unpaid || 0);
    setPayAmount(unpaid > 0.009 ? String(unpaid) : '');
    setShareMsg(message || payload.next?.message || 'Updated');
  };

  const runSettle = async () => {
    if (!bookingId || settling) return;
    setSettling(true);
    setShareMsg('');
    try {
      const { data } = await api.post(`/returns/${bookingId}/settle`, { method: payMethod });
      applySettlementState(data.data, data.message);
    } catch (err) {
      setShareMsg(err.response?.data?.message || 'Settlement failed');
    } finally {
      setSettling(false);
    }
  };

  const collectRentalHere = async (e) => {
    e?.preventDefault?.();
    if (!bookingId || settling) return;
    setSettling(true);
    setShareMsg('');
    try {
      const { data } = await api.post(`/returns/${bookingId}/collect-rental`, {
        amount: payAmount || undefined,
        method: payMethod,
        reference_number: payRef || undefined,
      });
      applySettlementState(data.data, data.message);
      setPayRef('');
    } catch (err) {
      setShareMsg(err.response?.data?.message || 'Could not collect rental');
    } finally {
      setSettling(false);
    }
  };

  const confirmRefundHere = async () => {
    if (!bookingId || settling) return;
    setSettling(true);
    setShareMsg('');
    try {
      const { data } = await api.post(`/returns/${bookingId}/confirm-refund`, {
        method: payMethod,
      });
      applySettlementState(data.data, data.message);
    } catch (err) {
      setShareMsg(err.response?.data?.message || 'Could not confirm refund');
    } finally {
      setSettling(false);
    }
  };

  const shareSettlement = async (channel) => {
    if (!bookingId) return;
    setSharing(channel);
    setShareMsg('');
    try {
      const { data } = await api.post(`/returns/${bookingId}/share`, { channel });
      setShareMsg(data.message || `Shared via ${channel}`);
      if (channel === 'telegram') {
        setResult((prev) =>
          prev ? { ...prev, share: { ...prev.share, telegram: true } } : prev
        );
      }
    } catch (err) {
      const payload = err.response?.data;
      setShareMsg(payload?.message || `Could not share via ${channel}`);
    } finally {
      setSharing('');
    }
  };

  const printSettlementPdf = async () => {
    if (!bookingId) return;
    setSharing('print');
    setShareMsg('');
    try {
      const { data } = await api.post(`/returns/${bookingId}/settlement-pdf`);
      const url = data?.data?.url;
      if (!url) throw new Error('No PDF URL');
      window.open(assetUrl(url), '_blank');
      setShareMsg('Settlement PDF opened — use Print in the PDF viewer.');
    } catch (err) {
      setShareMsg(err.response?.data?.message || 'Could not open settlement PDF');
    } finally {
      setSharing('');
    }
  };

  const paymentsApproved = (result?.payments || [])
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const money = result?.money;
  const balanceDue = money
    ? Number(money.balance_due)
    : Math.max(0, Number(result?.booking?.total_amount || 0) - paymentsApproved);

  const depositAppliedToRental = (result?.payments || [])
    .filter(
      (p) =>
        p.status === 'approved' &&
        p.type === 'final_settlement' &&
        String(p.reference_number || '').startsWith('APPLIED-FROM-DEPOSIT')
    )
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const rentalPaidByCustomerCash = Math.max(
    0,
    Number(money?.rental_paid ?? 0) - depositAppliedToRental
  );
  const depositPaidTotal = (result?.payments || [])
    .filter((p) => p.status === 'approved' && p.type === 'collateral_deposit')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const depositRefundedTotal = (result?.payments || [])
    .filter(
      (p) =>
        p.status === 'approved' &&
        p.type === 'deposit_refund' &&
        !String(p.reference_number || '').startsWith('APPLIED-TO-RENTAL')
    )
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const pendingRefundTotal = (result?.payments || [])
    .filter((p) => p.status === 'pending' && p.type === 'deposit_refund')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const rentalBase =
    result?.damage_breakdown?.rental_base ??
    Math.max(
      0,
      Number(result?.booking?.total_amount || 0) - Number(result?.totalDamageFee || 0)
    );
  const semiFees = Number(result?.damage_breakdown?.semi_total || 0);
  const fullFees = Number(result?.damage_breakdown?.full_total || 0);
  const damageTotal = Number(
    result?.damage_breakdown?.damage_total ?? result?.totalDamageFee ?? 0
  );
  const totalCharges = Number(money?.rental_total ?? result?.booking?.total_amount ?? 0);
  const stillToCollect = Number(money?.rental_unpaid ?? balanceDue ?? 0);
  const refundHighlight =
    depositRefundedTotal > 0.009
      ? depositRefundedTotal
      : pendingRefundTotal > 0.009
        ? pendingRefundTotal
        : Number(money?.deposit_held || money?.deposit_refundable || 0);
  const settlementComplete =
    Boolean(result) &&
    stillToCollect <= 0.009 &&
    Number(money?.deposit_held || 0) <= 0.009 &&
    pendingRefundTotal <= 0.009;

  const step1Done = Boolean(bookingId && booking);
  const step2Done = step1Done && !result;
  const showCheckIn = step1Done && !result;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="no-print">
      <PageHeader
        title="Return Equipment"
        subtitle="Check-in → collect rental → refund deposit — all on this page."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-muted)]">Status</span>
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant={statusFilter === f.value ? 'primary' : 'secondary'}
            onClick={() => {
              setStatusFilter(f.value);
              // Clear selection if it no longer matches the filter
              if (
                bookingId &&
                f.value !== 'all' &&
                booking?.status &&
                booking.status !== f.value
              ) {
                loadBooking('');
              }
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
        {[
          { n: 1, label: 'Select booking' },
          { n: 2, label: 'Check list' },
          { n: 3, label: 'Set condition' },
          { n: 4, label: 'Finish' },
        ].map((s) => (
          <div
            key={s.n}
            className={`rounded-lg border px-2 py-2 ${
              (s.n === 1 && step1Done) ||
              (s.n === 2 && step1Done) ||
              (s.n === 3 && showCheckIn) ||
              (s.n === 4 && result)
                ? 'border-[var(--color-brand)] bg-white'
                : 'border-[var(--color-line)] bg-[var(--color-surface)]'
            }`}
          >
            <p className="font-bold text-[var(--color-brand)]">{s.n}</p>
            <p className="text-[var(--color-muted)]">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Step n={1} title="Select booking" active={!step1Done || !result} done={step1Done}>
          <Select
            label="Customer booking"
            value={bookingId}
            onChange={(e) => loadBooking(e.target.value)}
          >
            <option value="">Choose…</option>
            {filteredBookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.customer_name} · {labelBookingStatus(b.status)}
                {Number(b.balance_due) > 0 ? ` · unpaid ${formatMoney(b.balance_due)}` : ''}
              </option>
            ))}
          </Select>
          {!filteredBookings.length && (
            <p className="text-sm text-[var(--color-muted)]">
              No {statusFilter === 'all' ? '' : `${labelBookingStatus(statusFilter)} `}
              bookings to show
            </p>
          )}
        </Step>

        {booking && !result && (
          <>
            <Step n={2} title="What they rented" active done={step2Done}>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <p>
                  <span className="font-semibold">{booking.customer_name}</span>
                  <span className="text-[var(--color-muted)]">
                    {' '}
                    · {dayjs(booking.start_date).format('MMM D')} →{' '}
                    {dayjs(booking.end_date).format('MMM D')}
                  </span>
                </p>
                <Badge>{String(booking.status || '').replace(/_/g, ' ')}</Badge>
              </div>
              <ul className="space-y-2">
                {lineList.map((line) => (
                  <li
                    key={`s-${line.item_id}`}
                    className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-white px-3 py-2"
                  >
                    <span className="rounded-md bg-[var(--color-brand)] px-2.5 py-1 text-white font-bold">
                      ×{line.booked}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{line.name}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        Qty rented: {line.booked}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-[var(--color-muted)]">
                {lineList.length} item{lineList.length === 1 ? '' : 's'} · {totalBooked} units
              </p>
            </Step>

            <Step n={3} title="Set condition" active>
              <p className="text-sm text-[var(--color-muted)]">
                Good + Semi + Damaged must equal rented quantity. Fees come from inventory (per
                unit).
              </p>

              <form onSubmit={submit} className="space-y-3">
                {lineList.map((line) => {
                  const back = returnedTotal(line);
                  const ok = back === Number(line.booked);
                  const semiQty = Number(line.qty_returned_semi_damaged || 0);
                  const fullQty = Number(line.qty_returned_damaged || 0);
                  const semiRate = Number(line.damage_fee_semi || 0);
                  const fullRate = Number(line.damage_fee_full || 0);
                  const semiTotal = semiQty * semiRate;
                  const fullTotal = fullQty * fullRate;
                  const lineFee = semiTotal + fullTotal;
                  const feesUnset = semiRate <= 0 && fullRate <= 0;
                  return (
                    <div
                      key={line.item_id}
                      className={`rounded-lg border p-3 bg-white space-y-2 ${
                        ok ? 'border-[var(--color-line)]' : 'border-amber-400'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="font-semibold">{line.name}</p>
                          <p className="text-xs text-[var(--color-muted)]">
                            Semi fee {formatMoney(semiRate)} / unit · Full damage{' '}
                            {formatMoney(fullRate)} / unit
                          </p>
                          {feesUnset && (semiQty > 0 || fullQty > 0) && (
                            <p className="text-xs text-amber-800 mt-0.5">
                              No fees set on this item — set them in Inventory if damage should be
                              charged.
                            </p>
                          )}
                          {!feesUnset &&
                            ((semiQty > 0 && semiRate <= 0) ||
                              (fullQty > 0 && fullRate <= 0)) && (
                              <p className="text-xs text-amber-800 mt-0.5">
                                {semiQty > 0 && semiRate <= 0
                                  ? 'Semi-damage fee is 0 on this item. '
                                  : ''}
                                {fullQty > 0 && fullRate <= 0
                                  ? 'Full damage fee is 0 on this item. '
                                  : ''}
                                Update Inventory to charge.
                              </p>
                            )}
                        </div>
                        <div className="text-right">
                          <Badge>Rented {line.booked}</Badge>
                          <p
                            className={`mt-1 text-xs font-semibold ${
                              ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'
                            }`}
                          >
                            Back {back}/{line.booked}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          label="Good"
                          type="number"
                          min="0"
                          value={line.qty_returned_good}
                          onChange={(e) =>
                            setLines({
                              ...lines,
                              [line.item_id]: { ...line, qty_returned_good: e.target.value },
                            })
                          }
                        />
                        <Input
                          label="Semi"
                          type="number"
                          min="0"
                          value={line.qty_returned_semi_damaged}
                          onChange={(e) =>
                            setLines({
                              ...lines,
                              [line.item_id]: {
                                ...line,
                                qty_returned_semi_damaged: e.target.value,
                              },
                            })
                          }
                        />
                        <Input
                          label="Damaged"
                          type="number"
                          min="0"
                          value={line.qty_returned_damaged}
                          onChange={(e) =>
                            setLines({
                              ...lines,
                              [line.item_id]: { ...line, qty_returned_damaged: e.target.value },
                            })
                          }
                        />
                      </div>
                      {(semiQty > 0 || fullQty > 0) && (
                        <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2 text-xs space-y-0.5">
                          {semiQty > 0 && (
                            <p className="flex justify-between gap-2">
                              <span>
                                Semi {semiQty} × {formatMoney(semiRate)}
                              </span>
                              <span className="font-medium">{formatMoney(semiTotal)}</span>
                            </p>
                          )}
                          {fullQty > 0 && (
                            <p className="flex justify-between gap-2">
                              <span>
                                Full damage {fullQty} × {formatMoney(fullRate)}
                              </span>
                              <span className="font-medium">{formatMoney(fullTotal)}</span>
                            </p>
                          )}
                          <p className="flex justify-between gap-2 border-t border-[var(--color-line)] pt-1 font-semibold text-[var(--color-danger)]">
                            <span>Line damage fee</span>
                            <span>{formatMoney(lineFee)}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm space-y-1">
                  <p className="font-medium text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    Damage fee calculation
                  </p>
                  <p className="flex justify-between gap-2">
                    <span>Semi-damage fees</span>
                    <span>
                      {formatMoney(
                        lineList.reduce(
                          (s, l) =>
                            s +
                            Number(l.qty_returned_semi_damaged || 0) *
                              Number(l.damage_fee_semi || 0),
                          0
                        )
                      )}
                    </span>
                  </p>
                  <p className="flex justify-between gap-2">
                    <span>Full damage fees</span>
                    <span>
                      {formatMoney(
                        lineList.reduce(
                          (s, l) =>
                            s +
                            Number(l.qty_returned_damaged || 0) * Number(l.damage_fee_full || 0),
                          0
                        )
                      )}
                    </span>
                  </p>
                  <p className="flex justify-between gap-2 border-t border-[var(--color-line)] pt-1 font-semibold">
                    <span>Total damage fee</span>
                    <span className="text-[var(--color-danger)]">
                      {formatMoney(estimatedDamage)}
                    </span>
                  </p>
                </div>

                {!allCountsMatch && (
                  <p className="text-sm text-amber-800">
                    Fix counts: Good + Semi + Damaged must equal rented.
                  </p>
                )}

                <Button
                  className="w-full py-3 text-base"
                  type="submit"
                  disabled={!allCountsMatch || submitting}
                >
                  {submitting ? 'Saving…' : '4 · Complete check-in'}
                </Button>
              </form>
            </Step>
          </>
        )}

        {!booking && !result && (
          <EmptyState message="Step 1: choose the customer booking above" />
        )}
      </div>
      </div>

        {result && (
          <div className="space-y-4 mt-2">
            {/* Client-facing settlement receipt */}
            <article className="print-receipt card-panel overflow-hidden border border-[var(--color-line)] shadow-sm">
              <header className="print-hero bg-gradient-to-br from-[#0d6e5f] to-[#085448] px-5 py-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl tracking-tight">RentFlow</p>
                    <p className="text-sm text-white/80 mt-0.5">Return settlement</p>
                  </div>
                  <div className="text-right text-sm text-white/90">
                    <p>{dayjs().format('MMM D, YYYY · HH:mm')}</p>
                    <p className="text-xs text-white/70 mt-0.5">
                      Booking {String(result.booking?.id || bookingId).slice(0, 8)}…
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-white/12 px-4 py-3 backdrop-blur-sm">
                  <p className="text-xs uppercase tracking-wide text-white/70">Prepared for</p>
                  <p className="font-display text-xl mt-0.5">
                    {result.customer?.full_name || 'Customer'}
                  </p>
                  {(result.customer?.phone || result.booking?.start_date) && (
                    <p className="text-sm text-white/80 mt-1">
                      {result.customer?.phone ? `${result.customer.phone} · ` : ''}
                      {result.booking?.start_date
                        ? `${dayjs(result.booking.start_date).format('MMM D')} → ${dayjs(result.booking.end_date).format('MMM D')}`
                        : ''}
                    </p>
                  )}
                </div>
              </header>

              <div className="p-5 space-y-5">
                <div className="grid sm:grid-cols-3 gap-3 print-hero">
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      Total charges
                    </p>
                    <p className="font-display text-2xl mt-1 tabular-nums">
                      {formatMoney(totalCharges)}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-1">Rental + damage</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      Covered by deposit
                    </p>
                    <p className="font-display text-2xl mt-1 tabular-nums text-[var(--color-brand)]">
                      {formatMoney(depositAppliedToRental)}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      {rentalPaidByCustomerCash > 0.009
                        ? `+ ${formatMoney(rentalPaidByCustomerCash)} paid separately`
                        : 'No extra cash needed'}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border px-4 py-3 ${
                      settlementComplete
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      {depositRefundedTotal > 0.009
                        ? 'Refunded to you'
                        : pendingRefundTotal > 0.009
                          ? 'Refund pending'
                          : Number(money?.deposit_held || 0) > 0.009
                            ? 'Deposit to refund'
                            : 'Refund'}
                    </p>
                    <p
                      className={`font-display text-2xl mt-1 tabular-nums ${
                        settlementComplete ? 'text-[var(--color-ok)]' : 'text-amber-900'
                      }`}
                    >
                      {formatMoney(refundHighlight)}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      From {formatMoney(depositPaidTotal || money?.deposit_paid || 0)} deposit
                    </p>
                  </div>
                </div>

                <section>
                  <h4 className="font-display text-lg mb-2">How we calculated</h4>
                  <div className="rounded-xl border border-[var(--color-line)] overflow-hidden">
                    <div className="flex justify-between gap-3 px-4 py-2.5 text-sm bg-white">
                      <span>Equipment rental</span>
                      <span className="font-semibold tabular-nums">{formatMoney(rentalBase)}</span>
                    </div>
                    <div className="flex justify-between gap-3 px-4 py-2.5 text-sm bg-[var(--color-surface)]/60 border-t border-[var(--color-line)]">
                      <span>Semi-damage fees</span>
                      <span className="font-semibold tabular-nums">{formatMoney(semiFees)}</span>
                    </div>
                    <div className="flex justify-between gap-3 px-4 py-2.5 text-sm bg-white border-t border-[var(--color-line)]">
                      <span>Full damage fees</span>
                      <span className="font-semibold tabular-nums">{formatMoney(fullFees)}</span>
                    </div>
                    {damageTotal > 0.009 &&
                      (result.damage_breakdown?.lines || []).filter((l) => l.line_total > 0.009)
                        .length > 0 && (
                        <ul className="px-4 py-2.5 text-xs text-[var(--color-muted)] space-y-1 border-t border-[var(--color-line)] bg-[var(--color-surface)]/40">
                          {(result.damage_breakdown.lines || [])
                            .filter((l) => l.line_total > 0.009)
                            .map((l) => (
                              <li key={l.item_id} className="flex justify-between gap-2">
                                <span>
                                  {l.item_name}
                                  {l.qty_semi > 0
                                    ? ` · semi ${l.qty_semi} × ${formatMoney(l.fee_semi_each)}`
                                    : ''}
                                  {l.qty_full > 0
                                    ? ` · damaged ${l.qty_full} × ${formatMoney(l.fee_full_each)}`
                                    : ''}
                                </span>
                                <span className="tabular-nums shrink-0">
                                  {formatMoney(l.line_total)}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    <div className="flex justify-between gap-3 px-4 py-3 text-sm border-t border-[var(--color-line)] bg-[var(--color-surface)]">
                      <span className="font-medium">Total charges</span>
                      <span className="font-display text-lg tabular-nums">
                        {formatMoney(totalCharges)}
                      </span>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="font-display text-lg mb-2">Your security deposit</h4>
                  <ol className="rounded-xl border border-[var(--color-line)] overflow-hidden text-sm">
                    <li className="flex justify-between gap-3 px-4 py-2.5 bg-white">
                      <span className="text-[var(--color-muted)]">1. Deposit you paid</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(depositPaidTotal || money?.deposit_paid || 0)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-3 px-4 py-2.5 bg-[var(--color-surface)]/60 border-t border-[var(--color-line)]">
                      <span className="text-[var(--color-muted)]">
                        2. Used for rental &amp; damage
                      </span>
                      <span className="font-semibold tabular-nums text-[var(--color-brand)]">
                        − {formatMoney(depositAppliedToRental)}
                      </span>
                    </li>
                    {rentalPaidByCustomerCash > 0.009 && (
                      <li className="flex justify-between gap-3 px-4 py-2.5 bg-white border-t border-[var(--color-line)]">
                        <span className="text-[var(--color-muted)]">
                          Extra collected (not from deposit)
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(rentalPaidByCustomerCash)}
                        </span>
                      </li>
                    )}
                    <li className="flex justify-between gap-3 px-4 py-3 border-t border-[var(--color-line)] bg-emerald-50/80">
                      <span className="font-medium text-emerald-950">
                        3.{' '}
                        {depositRefundedTotal > 0.009
                          ? 'Returned to you'
                          : pendingRefundTotal > 0.009
                            ? 'Waiting approval to return'
                            : Number(money?.deposit_held || 0) > 0.009
                              ? 'Still to return to you'
                              : 'Balance returned'}
                      </span>
                      <span className="font-display text-lg tabular-nums text-[var(--color-ok)]">
                        {formatMoney(refundHighlight)}
                      </span>
                    </li>
                  </ol>
                </section>

                {stillToCollect > 0.009 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex justify-between gap-3 text-sm">
                    <span className="font-medium text-red-900">Still to collect</span>
                    <span className="font-display text-lg tabular-nums text-[var(--color-danger)]">
                      {formatMoney(stillToCollect)}
                    </span>
                  </div>
                )}

                {settlementComplete && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-emerald-950">Settlement complete</p>
                      <p className="text-xs text-emerald-800/80 mt-0.5">
                        Thank you for renting with RentFlow
                      </p>
                    </div>
                    <Badge tone="ok">Paid in full</Badge>
                  </div>
                )}

                <section>
                  <h4 className="font-display text-lg mb-2">How your bill was paid</h4>
                  <div className="rounded-xl border border-[var(--color-line)] overflow-hidden text-sm">
                    <div className="px-4 py-3 bg-[var(--color-surface)]/70 border-b border-[var(--color-line)]">
                      <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                        Total charges {formatMoney(totalCharges)} = deposit used{' '}
                        {formatMoney(depositAppliedToRental)}
                        {rentalPaidByCustomerCash > 0.009
                          ? ` + extra payment ${formatMoney(rentalPaidByCustomerCash)}`
                          : ''}
                        {stillToCollect > 0.009
                          ? ` + still owed ${formatMoney(stillToCollect)}`
                          : ''}
                      </p>
                    </div>

                    <ul className="divide-y divide-[var(--color-line)]">
                      <li className="flex justify-between gap-3 px-4 py-2.5">
                        <div>
                          <p className="font-medium">From your security deposit</p>
                          <p className="text-xs text-[var(--color-muted)]">
                            Applied toward rental &amp; damage
                            {depositPaidTotal > 0.009
                              ? ` · deposit was ${formatMoney(depositPaidTotal)}`
                              : ''}
                          </p>
                        </div>
                        <span className="font-semibold tabular-nums shrink-0">
                          {formatMoney(depositAppliedToRental)}
                        </span>
                      </li>
                      {rentalPaidByCustomerCash > 0.009 && (
                        <li className="flex justify-between gap-3 px-4 py-2.5">
                          <div>
                            <p className="font-medium">Extra you paid</p>
                            <p className="text-xs text-[var(--color-muted)]">
                              {[
                                ...new Set(
                                  (result.payments || [])
                                    .filter(
                                      (p) =>
                                        p.status === 'approved' &&
                                        ['down_payment', 'installment', 'final_settlement', 'late_fee', 'damage_fee'].includes(
                                          p.type
                                        ) &&
                                        !String(p.reference_number || '').startsWith(
                                          'APPLIED-FROM-DEPOSIT'
                                        )
                                    )
                                    .map((p) => labelPaymentMethod(p.method))
                                ),
                              ].join(' · ') || 'Cash / transfer'}
                              {' · '}remaining after deposit
                            </p>
                          </div>
                          <span className="font-semibold tabular-nums shrink-0">
                            {formatMoney(rentalPaidByCustomerCash)}
                          </span>
                        </li>
                      )}
                      {stillToCollect > 0.009 && (
                        <li className="flex justify-between gap-3 px-4 py-2.5 text-[var(--color-danger)]">
                          <div>
                            <p className="font-medium">Still to pay</p>
                            <p className="text-xs opacity-80">Outstanding balance</p>
                          </div>
                          <span className="font-semibold tabular-nums shrink-0">
                            {formatMoney(stillToCollect)}
                          </span>
                        </li>
                      )}
                      <li className="flex justify-between gap-3 px-4 py-2.5 bg-emerald-50/60">
                        <div>
                          <p className="font-medium text-emerald-950">
                            {depositRefundedTotal > 0.009
                              ? 'Deposit refunded to you'
                              : pendingRefundTotal > 0.009
                                ? 'Deposit refund waiting'
                                : Number(money?.deposit_held || 0) > 0.009
                                  ? 'Deposit still to refund'
                                  : 'Deposit refund'}
                          </p>
                          <p className="text-xs text-[var(--color-muted)]">
                            {depositRefundedTotal > 0.009 || refundHighlight > 0.009
                              ? 'Leftover after charges'
                              : 'None — deposit fully used on charges'}
                          </p>
                        </div>
                        <span className="font-semibold tabular-nums shrink-0 text-[var(--color-ok)]">
                          {formatMoney(refundHighlight)}
                        </span>
                      </li>
                    </ul>

                    {(result.payments || []).some(
                      (p) =>
                        p.status === 'approved' &&
                        (p.type === 'collateral_deposit' ||
                          (['down_payment', 'installment', 'final_settlement'].includes(p.type) &&
                            !String(p.reference_number || '').startsWith('APPLIED-FROM-DEPOSIT')) ||
                          (p.type === 'deposit_refund' &&
                            !String(p.reference_number || '').startsWith('APPLIED-TO-RENTAL')))
                    ) && (
                      <div className="border-t border-[var(--color-line)] px-4 py-3 bg-white">
                        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-2">
                          Receipts (money that moved)
                        </p>
                        <ul className="space-y-1.5">
                          {(result.payments || [])
                            .filter((p) => {
                              if (p.status !== 'approved' && p.status !== 'pending') return false;
                              const ref = String(p.reference_number || '');
                              if (ref.startsWith('APPLIED-FROM-DEPOSIT')) return false;
                              if (ref.startsWith('APPLIED-TO-RENTAL')) return false;
                              return (
                                p.type === 'collateral_deposit' ||
                                p.type === 'deposit_refund' ||
                                ['down_payment', 'installment', 'final_settlement', 'late_fee'].includes(
                                  p.type
                                )
                              );
                            })
                            .map((p) => {
                              let title = 'Payment';
                              if (p.type === 'collateral_deposit') title = 'Security deposit received';
                              else if (p.type === 'deposit_refund') title = 'Deposit refund paid out';
                              else title = 'Extra payment for charges';
                              return (
                                <li
                                  key={p.id}
                                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                >
                                  <span className="text-[var(--color-muted)]">
                                    {title} · {labelPaymentMethod(p.method)}
                                    {p.created_at
                                      ? ` · ${dayjs(p.created_at).format('MMM D, HH:mm')}`
                                      : ''}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className="font-semibold text-[var(--color-ink)] tabular-nums">
                                      {formatMoney(p.amount)}
                                    </span>
                                    <Badge tone={p.status === 'approved' ? 'ok' : 'warn'}>
                                      {p.status === 'approved' ? 'Done' : 'Waiting'}
                                    </Badge>
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    )}
                  </div>
                </section>

                <p className="print-only text-center text-xs text-[var(--color-muted)] pt-2">
                  RentFlow · Event equipment rental · Keep this copy for your records
                </p>
              </div>
            </article>

            <div className="no-print rounded-xl border border-[var(--color-brand)]/30 bg-white p-4 space-y-4">
              <div>
                <p className="font-medium">Finish settlement (staff)</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Collect rental unpaid, then refund remaining deposit
                </p>
              </div>

              {(settlement?.steps || []).length > 0 && (
                <ul className="text-xs space-y-1 rounded-lg bg-[var(--color-surface)] p-2">
                  {settlement.steps.map((s, i) => (
                    <li key={i} className="text-[var(--color-ok)]">
                      ✓ {s.message}
                    </li>
                  ))}
                </ul>
              )}

              {Number(money?.rental_unpaid) > 0.009 ? (
                <form onSubmit={collectRentalHere} className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-red-700">Step A · Collect rental</p>
                    <p className="font-semibold text-red-950">
                      Collect {formatMoney(money.rental_unpaid)}
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <Input
                      label="Amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                      disabled={settling}
                    />
                    <Select
                      label="Method"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      disabled={settling}
                    >
                      {['cash', 'telebirr', 'bank_transfer'].map((m) => (
                        <option key={m} value={m}>
                          {labelPaymentMethod(m)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      label="Reference #"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      disabled={settling}
                      placeholder="Optional"
                    />
                  </div>
                  <Button className="w-full" type="submit" disabled={settling}>
                    {settling
                      ? 'Saving…'
                      : canApprove
                        ? `Collect & continue ${formatMoney(payAmount || money.rental_unpaid)}`
                        : `Save rental ${formatMoney(payAmount || money.rental_unpaid)}`}
                  </Button>
                  {!canApprove && (
                    <p className="text-xs text-amber-800">
                      Saved for manager approval. After approval, deposit refund is prepared automatically.
                    </p>
                  )}
                </form>
              ) : Number(money?.deposit_held) > 0.009 ||
                (result.payments || []).some(
                  (p) => p.type === 'deposit_refund' && p.status === 'pending'
                ) ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-amber-800">
                      Step B · Refund deposit
                    </p>
                    <p className="font-semibold text-amber-950">
                      Return {formatMoney(money?.deposit_held || money?.deposit_refundable || 0)}{' '}
                      to customer
                    </p>
                  </div>
                  <Select
                    label="Refund method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    disabled={settling}
                  >
                    {['cash', 'telebirr', 'bank_transfer'].map((m) => (
                      <option key={m} value={m}>
                        {labelPaymentMethod(m)}
                      </option>
                    ))}
                  </Select>
                  <Button className="w-full" disabled={settling} onClick={confirmRefundHere}>
                    {settling
                      ? 'Working…'
                      : canApprove
                        ? 'Confirm deposit refund now'
                        : 'Queue deposit refund'}
                  </Button>
                  {!canApprove && (
                    <p className="text-xs text-amber-800">
                      Refund will wait for manager approval on Payments.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-2">
                  <p className="font-medium text-emerald-900">Settlement complete</p>
                  <Badge tone="ok">Done</Badge>
                </div>
              )}

              <Button type="button" variant="secondary" disabled={settling} onClick={runSettle}>
                Refresh auto steps
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 no-print">
              <Button
                variant="secondary"
                type="button"
                disabled={Boolean(sharing)}
                onClick={printSettlementPdf}
              >
                <Printer size={16} />
                {sharing === 'print' ? 'Opening…' : 'Print for customer'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(sharing)}
                onClick={() => shareSettlement('telegram')}
              >
                <Send size={16} />
                {sharing === 'telegram' ? 'Sending…' : 'Telegram'}
              </Button>
              {result.share?.email && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(sharing)}
                  onClick={() => shareSettlement('email')}
                >
                  <Mail size={16} />
                  {sharing === 'email' ? 'Sending…' : 'Email'}
                </Button>
              )}
            </div>

            {!result.share?.telegram && (
              <div className="no-print rounded-lg border border-[var(--color-line)] p-3">
                <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                  Telegram not linked on this booking customer yet. Anyone can open the RentFlow bot,
                  tap Start, and send a payment screenshot + transaction ID. After you approve, they
                  get the official receipt from the bot.
                </p>
              </div>
            )}

            {shareMsg && (
              <p className="no-print text-sm rounded-lg border border-[var(--color-line)] px-3 py-2">
                {shareMsg}
              </p>
            )}
          </div>
        )}
    </div>
  );
}
