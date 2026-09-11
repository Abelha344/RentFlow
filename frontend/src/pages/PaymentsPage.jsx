import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { assetUrl } from '../lib/assets';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatCard,
  STATUS_TONE,
  formatMoney,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import {
  labelBookingStatus,
  labelPayStatus,
  labelPaymentMethod,
  labelPaymentStatus,
  labelPaymentType,
} from '../lib/labels';

const VIEW_FILTERS = [
  { value: 'needs_payment', label: 'Needs payment' },
  { value: 'waiting_approval', label: 'Waiting approval' },
  { value: 'refund_ready', label: 'Refund deposit' },
  { value: 'all', label: 'All bookings' },
];

const LIST_PAGE_SIZE = 10;

function bookingCoversDate(booking, dateStr) {
  if (!dateStr) return true;
  const day = dayjs(dateStr).startOf('day');
  if (!day.isValid()) return true;
  const start = dayjs(booking.start_date).startOf('day');
  const end = dayjs(booking.end_date).startOf('day');
  return (
    (day.isSame(start, 'day') || day.isAfter(start)) &&
    (day.isSame(end, 'day') || day.isBefore(end))
  );
}

/**
 * One clear next step for the payments workflow:
 * 1) Collect deposit → 2) Collect rental (after return) → 3) Refund leftover deposit
 */
function nextPaymentAction(booking) {
  if (!booking || booking.status === 'cancelled') {
    return { kind: 'none', label: '—', hint: '' };
  }

  const depositUnpaid = Number(booking.deposit_unpaid || 0);
  const rentalUnpaid = Number(booking.rental_unpaid || 0);
  const refundable = Number(booking.deposit_refundable || 0);
  const pending = Number(booking.pending_total || 0);
  const returned = booking.status === 'returned';
  const out = ['out_for_rent', 'overdue'].includes(booking.status);

  if (depositUnpaid > 0.009 && pending > 0.009) {
    return {
      kind: 'waiting',
      label: 'Waiting approval',
      hint: 'Deposit recorded — approve to continue',
      amount: pending,
    };
  }

  if (depositUnpaid > 0.009) {
    return {
      kind: 'deposit',
      intent: 'deposit',
      label: `Collect deposit ${formatMoney(depositUnpaid)}`,
      hint: 'Required before dispatch',
      amount: depositUnpaid,
      primary: true,
    };
  }

  if (!returned && rentalUnpaid > 0.009) {
    return {
      kind: 'wait_return',
      label: out ? 'Out — rental after return' : 'Deposit paid',
      hint: `Rental ${formatMoney(rentalUnpaid)} after check-in`,
      amount: rentalUnpaid,
    };
  }

  if (rentalUnpaid > 0.009) {
    return {
      kind: 'rental',
      intent: 'rental',
      label: `Collect rental ${formatMoney(rentalUnpaid)}`,
      hint: refundable > 0.009 ? `Then refund deposit ${formatMoney(refundable)}` : 'Then finish settlement',
      amount: rentalUnpaid,
      primary: true,
    };
  }

  if (refundable > 0.009 && returned) {
    const pendingRefundHint =
      pending > 0.009 ? 'Refund waiting approval' : 'Return leftover collateral';
    return {
      kind: 'refund',
      intent: 'refund',
      label: `Refund deposit ${formatMoney(refundable)}`,
      hint: pendingRefundHint,
      amount: refundable,
      primary: true,
    };
  }

  if (!returned && Number(booking.deposit_held || booking.deposit_paid || 0) > 0.009) {
    return {
      kind: 'wait_return',
      label: out ? 'Out — refund after return' : 'Deposit held',
      hint: 'Deposit refund only after check-in',
    };
  }

  if (pending > 0.009) {
    return {
      kind: 'waiting',
      label: 'Waiting approval',
      hint: formatMoney(pending),
      amount: pending,
    };
  }

  return {
    kind: 'done',
    label: 'Settled',
    hint: 'No action needed',
  };
}

function intentDefaults(booking, intent) {
  if (!booking) return null;
  const depositUnpaid = Number(booking.deposit_unpaid || 0);
  const rentalUnpaid = Number(booking.rental_unpaid || 0);
  const refundable = Number(booking.deposit_refundable || 0);

  if (intent === 'deposit') {
    return {
      amount: depositUnpaid,
      type: 'collateral_deposit',
      label: 'Security deposit (required before dispatch)',
    };
  }
  if (intent === 'refund') {
    return {
      amount: refundable,
      type: 'deposit_refund',
      label: 'Refund security deposit (after return)',
    };
  }
  // rental / default
  return {
    amount: rentalUnpaid,
    type: rentalUnpaid > 0 && Number(booking.rental_paid) > 0 ? 'installment' : 'final_settlement',
    label: 'Rental payment (after return check-in)',
  };
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const canApprove = can.approvePayment(user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [viewFilter, setViewFilter] = useState('needs_payment');
  const [listSearch, setListSearch] = useState('');
  const [listDate, setListDate] = useState('');
  const [listPage, setListPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState('');
  const [notice, setNotice] = useState('');
  const savingLock = useRef(false);
  const [form, setForm] = useState({
    booking_id: '',
    amount: '',
    type: 'collateral_deposit',
    method: 'telebirr',
    reference_number: '',
  });
  const [receipt, setReceipt] = useState(null);
  const [leaseHintBookingId, setLeaseHintBookingId] = useState('');
  const [review, setReview] = useState(null);
  const [reviewForm, setReviewForm] = useState({
    reference_number: '',
    booking_id: '',
    amount: '',
    type: 'installment',
    method: 'telebirr',
  });
  const [officialReceipt, setOfficialReceipt] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [formError, setFormError] = useState('');

  const load = async () => {
    const [p, b] = await Promise.all([api.get('/payments'), api.get('/bookings')]);
    setPayments(p.data.data);
    setBookings(b.data.data);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    const bookingId = searchParams.get('booking');
    const intent = searchParams.get('intent') || 'deposit';
    if (!bookingId || !bookings.length) return;
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    openRecord(booking, intent);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, searchParams]);

  const filteredBookings = useMemo(() => {
    const open = bookings.filter((b) => b.status !== 'cancelled');
    let rows = open;
    if (viewFilter === 'needs_payment') {
      rows = open.filter((b) => Number(b.balance_due) > 0.009);
    } else if (viewFilter === 'waiting_approval') {
      rows = open.filter((b) => Number(b.pending_total) > 0.009);
    } else if (viewFilter === 'refund_ready') {
      rows = open.filter((b) => Number(b.deposit_refundable) > 0.009);
    }

    const q = listSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((b) => String(b.customer_name || '').toLowerCase().includes(q));
    }
    if (listDate) {
      rows = rows.filter((b) => bookingCoversDate(b, listDate));
    }
    return rows;
  }, [bookings, viewFilter, listSearch, listDate]);

  const listTotalPages = Math.max(1, Math.ceil(filteredBookings.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);

  const visibleBookings = useMemo(() => {
    const start = (safeListPage - 1) * LIST_PAGE_SIZE;
    return filteredBookings.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredBookings, safeListPage]);

  useEffect(() => {
    setListPage(1);
  }, [viewFilter, listSearch, listDate]);

  const selected = useMemo(
    () => bookings.find((b) => b.id === selectedId) || null,
    [bookings, selectedId]
  );

  const selectedPayments = useMemo(() => {
    if (!selectedId) return [];
    return payments
      .filter((p) => p.booking_id === selectedId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [payments, selectedId]);

  const pendingApprovals = useMemo(
    () => payments.filter((p) => p.status === 'pending'),
    [payments]
  );

  const totals = useMemo(() => {
    return filteredBookings.reduce(
      (acc, b) => {
        acc.depositUnpaid += Number(b.deposit_unpaid || 0);
        acc.rentalUnpaid += Number(b.rental_unpaid || 0);
        acc.refundable += Number(b.deposit_refundable || 0);
        acc.waiting += Number(b.pending_total || 0);
        return acc;
      },
      { depositUnpaid: 0, rentalUnpaid: 0, refundable: 0, waiting: 0 }
    );
  }, [filteredBookings]);

  const openRecord = (booking, intent = 'auto') => {
    let resolved = intent;
    if (intent === 'auto') {
      if (Number(booking.deposit_unpaid) > 0.009) resolved = 'deposit';
      else if (booking.status === 'returned' && Number(booking.rental_unpaid) > 0.009) {
        resolved = 'rental';
      } else if (booking.status === 'returned' && Number(booking.deposit_refundable) > 0.009) {
        resolved = 'refund';
      } else if (Number(booking.rental_unpaid) > 0.009 && booking.status !== 'returned') {
        setSelectedId(booking.id);
        setNotice('Collect rental and refund deposit only after return check-in.');
        return;
      } else {
        setSelectedId(booking.id);
        setNotice('Nothing to collect or refund for this booking.');
        return;
      }
    }
    if (resolved === 'refund' && booking.status !== 'returned') {
      setSelectedId(booking.id);
      setNotice('Deposit refund is only allowed after return check-in.');
      return;
    }
    if (resolved === 'rental' && booking.status !== 'returned') {
      setSelectedId(booking.id);
      setNotice('Collect rental only after return check-in.');
      return;
    }
    const defaults = intentDefaults(booking, resolved);
    if (!defaults || defaults.amount <= 0.009) {
      setSelectedId(booking.id);
      setNotice(
        resolved === 'refund'
          ? 'No deposit available to refund.'
          : 'Already recorded or fully paid. Wait for approval if pending.'
      );
      return;
    }
    setNotice('');
    setFormError('');
    setForm({
      booking_id: booking.id,
      amount: String(defaults.amount),
      type: defaults.type,
      method: 'telebirr',
      reference_number: '',
    });
    setReceipt(null);
    setSelectedId(booking.id);
    setShowForm(true);
  };

  const create = async (e) => {
    e.preventDefault();
    if (savingLock.current || saving) return;
    savingLock.current = true;
    setSaving(true);
    setNotice('');
    setFormError('');
    const wasRefund = form.type === 'deposit_refund';
    const wasDeposit = form.type === 'collateral_deposit';
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (receipt) fd.append('receipt', receipt);
      await api.post('/payments', fd);
      setShowForm(false);
      setReceipt(null);
      setFormError('');
      setViewFilter('waiting_approval');
      setNotice(
        wasRefund
          ? 'Refund recorded — waiting for approval. Confirm it below when ready.'
          : wasDeposit
            ? 'Deposit recorded — waiting for approval.'
            : 'Payment recorded — waiting for approval.'
      );
      await load();
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.message ||
        err.message ||
        'Could not record payment. Try again.';
      setFormError(msg);
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  const submitLabel = () => {
    if (saving) {
      if (form.type === 'deposit_refund') return 'Refunding…';
      if (form.type === 'collateral_deposit') return 'Recording…';
      return 'Saving…';
    }
    if (form.type === 'deposit_refund') return `Refund ${formatMoney(form.amount || 0)}`;
    if (form.type === 'collateral_deposit') return `Collect deposit ${formatMoney(form.amount || 0)}`;
    return `Collect ${formatMoney(form.amount || 0)}`;
  };

  const openReview = (payment) => {
    setReview(payment);
    setReviewForm({
      reference_number: payment.reference_number || '',
      booking_id: payment.booking_id || '',
      amount: String(payment.amount || ''),
      type: payment.type || 'installment',
      method: payment.method || 'telebirr',
    });
    setOfficialReceipt(null);
    setReviewError('');
    setNotice('');
  };

  const setStatus = async (id, status) => {
    if (!canApprove || approvingId) return;
    const existing = payments.find((p) => p.id === id);
    if (
      status === 'approved' &&
      existing?.type === 'deposit_refund' &&
      existing?.booking_status !== 'returned'
    ) {
      setNotice(
        'Cannot approve this deposit refund yet — return the equipment first (check-in on Returns).'
      );
      return;
    }
    if (status === 'approved') {
      openReview(existing);
      return;
    }
    setApprovingId(id);
    setNotice('');
    try {
      await api.patch(`/payments/${id}/status`, { status });
      setLeaseHintBookingId('');
      setNotice('Payment rejected.');
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not update payment.');
    } finally {
      setApprovingId('');
    }
  };

  const submitReview = async (e) => {
    e?.preventDefault?.();
    if (!review || !canApprove || approvingId) return;
    if (!String(reviewForm.reference_number || '').trim()) {
      setReviewError('Enter the verified transaction ID before approving.');
      return;
    }
    if (!reviewForm.booking_id) {
      setReviewError('Select the booking this payment belongs to.');
      return;
    }
    if (
      reviewForm.type === 'deposit_refund' &&
      bookings.find((b) => b.id === reviewForm.booking_id)?.status !== 'returned'
    ) {
      setReviewError('Deposit refund can only be approved after return check-in.');
      return;
    }

    setApprovingId(review.id);
    setReviewError('');
    setNotice('');
    try {
      const fd = new FormData();
      fd.append('status', 'approved');
      fd.append('reference_number', reviewForm.reference_number.trim());
      fd.append('booking_id', reviewForm.booking_id);
      fd.append('type', reviewForm.type);
      fd.append('method', reviewForm.method);
      fd.append('amount', reviewForm.amount);
      if (officialReceipt) fd.append('official_receipt', officialReceipt);

      const { data } = await api.patch(`/payments/${review.id}/status`, fd);
      const payment = data?.data;
      setReview(null);
      setOfficialReceipt(null);
      setReviewError('');

      if (payment?.type === 'collateral_deposit') {
        setLeaseHintBookingId(payment.booking_id);
        setNotice(
          data.message ||
            'Deposit approved — official receipt sent to customer on Telegram. Use Print lease below.'
        );
      } else {
        setLeaseHintBookingId('');
        setNotice(
          data.message ||
            'Payment approved — official receipt will be sent to the customer on Telegram.'
        );
      }
      await load();
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.message ||
        err.message ||
        'Could not approve payment.';
      setReviewError(msg);
    } finally {
      setApprovingId('');
    }
  };

  const printLease = async (bookingId) => {
    try {
      const { data } = await api.post(`/bookings/${bookingId}/work-order`);
      window.open(assetUrl(data.data.url), '_blank');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Could not open lease print.');
    }
  };

  const payTone = (status) => {
    if (status === 'paid') return 'ok';
    if (status === 'partial') return 'warn';
    return 'danger';
  };

  return (
    <div>
      <PageHeader
        title="Payments & Receipts"
        subtitle="Next step only: deposit → rental after return → refund leftover deposit"
        actions={
          <Button
            disabled={saving}
            onClick={() => {
              if (selected) {
                openRecord(selected, 'auto');
                return;
              }
              setNotice('Select a booking first, then record payment.');
            }}
          >
            Record payment
          </Button>
        }
      />

      {notice && (
        <div className="mb-4 text-sm rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <p>{notice}</p>
          {leaseHintBookingId && (
            <Button variant="secondary" onClick={() => printLease(leaseHintBookingId)}>
              Print lease
            </Button>
          )}
        </div>
      )}

      {canApprove && pendingApprovals.length > 0 && (
        <div className="card-panel p-4 mb-4 border-l-4 border-amber-500">
          <p className="font-medium mb-2">
            Waiting for your approval ({pendingApprovals.length})
          </p>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Review customer proof, confirm the transaction ID, assign booking if needed, then
            approve. Official receipt is sent to the customer on Telegram.
          </p>
          <ul className="space-y-2">
            {pendingApprovals.slice(0, 8).map((p) => {
              const refundBlocked =
                p.type === 'deposit_refund' && p.booking_status !== 'returned';
              return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-[var(--color-line)] pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">{p.customer_name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {labelPaymentType(p.type)} · {labelPaymentMethod(p.method)} ·{' '}
                    {formatMoney(p.amount)}
                    {p.reference_number ? ` · TXN ${p.reference_number}` : ''}
                    {!p.booking_id ? ' · booking not assigned' : ''}
                  </p>
                  {refundBlocked && (
                    <p className="text-xs text-amber-800 mt-0.5">
                      Approve after return check-in
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  {p.receipt_url && (
                    <a
                      className="text-xs text-[var(--color-brand)] underline self-center mr-2"
                      href={assetUrl(p.receipt_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View proof
                    </a>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => openReview(p)}
                    disabled={Boolean(approvingId) || refundBlocked}
                    title={
                      refundBlocked
                        ? 'Return equipment first, then approve refund'
                        : undefined
                    }
                  >
                    <Check size={14} /> Review &amp; approve
                  </Button>
                  <Button variant="ghost" onClick={() => setStatus(p.id, 'rejected')} disabled={Boolean(approvingId)}>
                    <X size={14} /> Reject
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-muted)]">Show</span>
        {VIEW_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant={viewFilter === f.value ? 'primary' : 'secondary'}
            onClick={() => setViewFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="Search customer"
          placeholder="Customer name"
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
        />
        <Input
          label="Booking date"
          type="date"
          value={listDate}
          onChange={(e) => setListDate(e.target.value)}
        />
        {(listSearch || listDate) && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setListSearch('');
                setListDate('');
              }}
            >
              Clear search
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <StatCard
          label="Deposit unpaid"
          value={formatMoney(totals.depositUnpaid)}
          hint="Must pay before dispatch"
        />
        <StatCard
          label="Rental unpaid"
          value={formatMoney(totals.rentalUnpaid)}
          hint="Collect after return check-in"
        />
        <StatCard
          label="Deposit to refund"
          value={formatMoney(totals.refundable)}
          hint="After successful return"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 card-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-line)]">
              <tr>
                <th className="p-3">Customer</th>
                <th className="p-3">Booking</th>
                <th className="p-3">Deposit</th>
                <th className="p-3">Rental unpaid</th>
                <th className="p-3">Status</th>
                <th className="p-3 min-w-[11rem]">Next step</th>
              </tr>
            </thead>
            <tbody>
              {visibleBookings.map((b) => {
                const depositUnpaid = Number(b.deposit_unpaid || 0);
                const rentalUnpaid = Number(b.rental_unpaid || 0);
                const refundable = Number(b.deposit_refundable || 0);
                const next = nextPaymentAction(b);
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-[var(--color-line)] last:border-0 cursor-pointer hover:bg-[var(--color-surface)] ${
                      selectedId === b.id ? 'bg-[var(--color-surface)]' : ''
                    }`}
                    onClick={() => setSelectedId(b.id)}
                  >
                    <td className="p-3 font-medium">{b.customer_name}</td>
                    <td className="p-3 text-xs">
                      <div>{labelBookingStatus(b.status)}</div>
                      <div className="text-[var(--color-muted)]">
                        {dayjs(b.start_date).format('MMM D')} → {dayjs(b.end_date).format('MMM D')}
                      </div>
                    </td>
                    <td className="p-3 text-xs">
                      {depositUnpaid > 0.009 ? (
                        <span className="font-semibold text-[var(--color-danger)]">
                          Unpaid {formatMoney(depositUnpaid)}
                        </span>
                      ) : refundable > 0.009 ? (
                        <span className="text-amber-800 font-medium">
                          Refund {formatMoney(refundable)}
                        </span>
                      ) : (
                        <span className="text-[var(--color-ok)]">Paid</span>
                      )}
                    </td>
                    <td className="p-3 font-semibold">
                      {rentalUnpaid > 0.009 ? (
                        <span className="text-[var(--color-danger)]">{formatMoney(rentalUnpaid)}</span>
                      ) : (
                        <span className="text-[var(--color-ok)]">{formatMoney(0)}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge tone={payTone(b.pay_status)}>{labelPayStatus(b.pay_status)}</Badge>
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {next.intent ? (
                        <div className="space-y-0.5">
                          <Button
                            type="button"
                            variant={next.primary ? 'primary' : 'secondary'}
                            disabled={saving}
                            className="whitespace-nowrap"
                            onClick={() => openRecord(b, next.intent)}
                          >
                            {next.label}
                          </Button>
                          {next.hint && (
                            <p className="text-[11px] text-[var(--color-muted)] leading-tight">
                              {next.hint}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p
                            className={`text-xs font-medium ${
                              next.kind === 'done'
                                ? 'text-[var(--color-ok)]'
                                : next.kind === 'waiting'
                                  ? 'text-amber-800'
                                  : 'text-[var(--color-muted)]'
                            }`}
                          >
                            {next.label}
                          </p>
                          {next.hint && (
                            <p className="text-[11px] text-[var(--color-muted)] leading-tight">
                              {next.hint}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredBookings.length && (
            <EmptyState
              message={
                listSearch || listDate
                  ? 'No bookings match this search'
                  : viewFilter === 'needs_payment'
                    ? 'No unpaid deposit or rental'
                    : viewFilter === 'waiting_approval'
                      ? 'No payments waiting for approval'
                      : viewFilter === 'refund_ready'
                        ? 'No deposits ready to refund'
                        : 'No bookings yet'
              }
            />
          )}
          {filteredBookings.length > LIST_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-3">
              <p className="text-xs text-[var(--color-muted)]">
                Page {safeListPage} of {listTotalPages} · {filteredBookings.length} bookings ·{' '}
                {LIST_PAGE_SIZE} per page
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={safeListPage <= 1}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} /> Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={safeListPage >= listTotalPages}
                  onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                >
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 card-panel p-4 space-y-3">
          {!selected ? (
            <EmptyState message="Select a customer booking to see payment details" />
          ) : (
            <>
              <div>
                <h2 className="font-display text-xl">{selected.customer_name}</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  {labelBookingStatus(selected.status)} ·{' '}
                  {dayjs(selected.start_date).format('MMM D')} →{' '}
                  {dayjs(selected.end_date).format('MMM D')}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 space-y-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">At rent</p>
                <div className="flex justify-between gap-2">
                  <span>Security deposit</span>
                  <span>{formatMoney(selected.deposit_expected)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Deposit unpaid</span>
                  <span
                    className={
                      Number(selected.deposit_unpaid) > 0.009
                        ? 'font-semibold text-[var(--color-danger)]'
                        : 'text-[var(--color-ok)]'
                    }
                  >
                    {formatMoney(selected.deposit_unpaid)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Deposit held</span>
                  <span>{formatMoney(selected.deposit_held)}</span>
                </div>

                <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] border-t border-[var(--color-line)] pt-2">
                  At / after return
                </p>
                <div className="flex justify-between gap-2">
                  <span>Rental total</span>
                  <span>{formatMoney(selected.rental_total)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Rental unpaid</span>
                  <span
                    className={
                      Number(selected.rental_unpaid) > 0.009
                        ? 'font-semibold text-[var(--color-danger)]'
                        : 'text-[var(--color-ok)]'
                    }
                  >
                    {formatMoney(selected.rental_unpaid)}
                  </span>
                </div>
                {Number(selected.deposit_refundable) > 0.009 && (
                  <div className="flex justify-between gap-2 text-amber-900">
                    <span>Deposit to refund</span>
                    <span className="font-semibold">
                      {formatMoney(selected.deposit_refundable)}
                    </span>
                  </div>
                )}
                {Number(selected.pending_total) > 0 && (
                  <div className="flex justify-between gap-2 text-amber-800">
                    <span>Waiting approval</span>
                    <span>{formatMoney(selected.pending_total)}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {(() => {
                  const next = nextPaymentAction(selected);
                  if (next.intent) {
                    return (
                      <>
                        <Button
                          className="w-full"
                          disabled={saving}
                          onClick={() => openRecord(selected, next.intent)}
                        >
                          {next.label}
                        </Button>
                        {next.hint && (
                          <p className="text-xs text-center text-[var(--color-muted)]">{next.hint}</p>
                        )}
                      </>
                    );
                  }
                  return (
                    <p
                      className={`text-sm text-center font-medium ${
                        next.kind === 'done' ? 'text-[var(--color-ok)]' : 'text-amber-800'
                      }`}
                    >
                      {next.label}
                      {next.hint ? ` · ${next.hint}` : ''}
                    </p>
                  );
                })()}
              </div>

              <div>
                <p className="font-medium text-sm mb-2">Payment history</p>
                {!selectedPayments.length ? (
                  <p className="text-sm text-[var(--color-muted)]">No payments recorded yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {selectedPayments.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-lg border border-[var(--color-line)] p-2 space-y-1"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{formatMoney(p.amount)}</span>
                          <Badge tone={STATUS_TONE[p.status]}>
                            {labelPaymentStatus(p.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--color-muted)]">
                          {labelPaymentType(p.type)} · {labelPaymentMethod(p.method)} ·{' '}
                          {dayjs(p.created_at).format('MMM D, HH:mm')}
                        </p>
                        {p.receipt_url && (
                          <a
                            className="text-xs text-[var(--color-brand)] underline"
                            href={assetUrl(p.receipt_url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View proof
                          </a>
                        )}
                        {p.pdf_receipt_url && p.status === 'approved' && (
                          <a
                            className="text-xs text-[var(--color-brand)] underline ml-2"
                            href={assetUrl(p.pdf_receipt_url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Print receipt
                          </a>
                        )}
                        {p.type === 'collateral_deposit' &&
                          p.status === 'approved' &&
                          selectedId && (
                            <button
                              type="button"
                              className="block text-xs text-[var(--color-brand)] underline mt-1"
                              onClick={() => printLease(selectedId)}
                            >
                              Print lease (with deposit)
                            </button>
                          )}
                        {canApprove && p.status === 'pending' && (
                          <div className="flex gap-1 pt-1">
                            <Button
                              variant="secondary"
                              disabled={
                                Boolean(approvingId) ||
                                (p.type === 'deposit_refund' &&
                                  (p.booking_status || selected?.status) !== 'returned')
                              }
                              title={
                                p.type === 'deposit_refund' &&
                                (p.booking_status || selected?.status) !== 'returned'
                                  ? 'Return equipment first, then approve refund'
                                  : undefined
                              }
                              onClick={() => openReview(p)}
                            >
                              <Check size={14} />
                              {approvingId === p.id ? 'Saving…' : 'Review & approve'}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={Boolean(approvingId)}
                              onClick={() => setStatus(p.id, 'rejected')}
                            >
                              <X size={14} /> Reject
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/40">
          <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-4">
            <form
              onSubmit={create}
              className="card-panel mb-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[min(92dvh,40rem)] w-full max-w-md flex-col overflow-hidden shadow-xl sm:mb-0"
            >
              <div className="shrink-0 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
                <h3 className="font-display text-xl">
                  {form.type === 'deposit_refund'
                    ? 'Refund deposit'
                    : form.type === 'collateral_deposit'
                      ? 'Collect deposit'
                      : 'Collect rental'}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {form.type === 'deposit_refund'
                    ? 'Record the refund, then approve it under Waiting approval'
                    : 'Record now → approve under Waiting approval'}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                <Select
                  label="Customer booking"
                  value={form.booking_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const b = bookings.find((x) => x.id === id);
                    if (!b) {
                      setForm({ ...form, booking_id: id });
                      return;
                    }
                    const intent =
                      Number(b.deposit_unpaid) > 0
                        ? 'deposit'
                        : Number(b.rental_unpaid) > 0
                          ? 'rental'
                          : 'refund';
                    const defaults = intentDefaults(b, intent);
                    setForm({
                      ...form,
                      booking_id: id,
                      amount: defaults?.amount > 0 ? String(defaults.amount) : '',
                      type: defaults?.type || form.type,
                    });
                  }}
                  required
                >
                  <option value="">Select…</option>
                  {bookings
                    .filter((b) => b.status !== 'cancelled')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.customer_name} · deposit {formatMoney(b.deposit_unpaid)} · rental{' '}
                        {formatMoney(b.rental_unpaid)}
                      </option>
                    ))}
                </Select>
                <Input
                  label={form.type === 'deposit_refund' ? 'Amount to refund' : 'Amount received'}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                  disabled={saving}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    label="Payment type"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    disabled={saving}
                  >
                    <optgroup label="At rent">
                      <option value="collateral_deposit">
                        {labelPaymentType('collateral_deposit')}
                      </option>
                    </optgroup>
                    {bookings.find((b) => b.id === form.booking_id)?.status === 'returned' ? (
                      <>
                        <optgroup label="Rental (after return)">
                          <option value="down_payment">{labelPaymentType('down_payment')}</option>
                          <option value="installment">{labelPaymentType('installment')}</option>
                          <option value="final_settlement">
                            {labelPaymentType('final_settlement')}
                          </option>
                        </optgroup>
                        <optgroup label="After return">
                          <option value="deposit_refund">
                            {labelPaymentType('deposit_refund')}
                          </option>
                        </optgroup>
                      </>
                    ) : (
                      <optgroup label="After return check-in only">
                        <option value="final_settlement" disabled>
                          Rental / refund — after return
                        </option>
                      </optgroup>
                    )}
                  </Select>
                  <Select
                    label={form.type === 'deposit_refund' ? 'Refund method' : 'How did they pay?'}
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value })}
                    disabled={saving}
                  >
                    {['cash', 'bank_transfer', 'telebirr'].map((m) => (
                      <option key={m} value={m}>
                        {labelPaymentMethod(m)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  label="Reference # (receipt / Telebirr)"
                  value={form.reference_number}
                  onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                  disabled={saving}
                />
                <Input
                  label="Photo or PDF of proof"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReceipt(e.target.files?.[0] || null)}
                  disabled={saving}
                />
                {formError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setShowForm(false);
                    setFormError('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {submitLabel()}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {review && (
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/40">
          <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-4">
            <form
              onSubmit={submitReview}
              className="card-panel mb-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[min(92dvh,56rem)] w-full max-w-lg flex-col overflow-hidden border border-[var(--color-line)] shadow-xl sm:mb-0"
            >
              <div className="shrink-0 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
                <h3 className="font-display text-xl">Verify &amp; approve payment</h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {review.customer_name} · confirm transaction ID then approve
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                {review.receipt_url && (
                  <div className="space-y-2 rounded-lg border border-[var(--color-line)] p-3">
                    <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      Customer uploaded proof
                    </p>
                    {/\.(pdf)(\?|$)/i.test(String(review.receipt_url || '')) ? (
                      <a
                        className="text-sm text-[var(--color-brand)] underline"
                        href={assetUrl(review.receipt_url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open PDF proof
                      </a>
                    ) : (
                      <a href={assetUrl(review.receipt_url)} target="_blank" rel="noreferrer">
                        <img
                          src={assetUrl(review.receipt_url)}
                          alt="Customer payment proof"
                          className="max-h-40 rounded-md border border-[var(--color-line)] object-contain bg-[var(--color-surface)] sm:max-h-56"
                        />
                      </a>
                    )}
                  </div>
                )}

                <Select
                  label="Booking"
                  value={reviewForm.booking_id}
                  onChange={(e) => setReviewForm({ ...reviewForm, booking_id: e.target.value })}
                  required
                  disabled={Boolean(approvingId)}
                >
                  <option value="">Select booking…</option>
                  {bookings
                    .filter((b) => b.status !== 'cancelled')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.customer_name} · {labelBookingStatus(b.status)} · deposit{' '}
                        {formatMoney(b.deposit_unpaid)} · rental {formatMoney(b.rental_unpaid)}
                      </option>
                    ))}
                </Select>

                <Input
                  label="Verified transaction ID"
                  value={reviewForm.reference_number}
                  onChange={(e) =>
                    setReviewForm({ ...reviewForm, reference_number: e.target.value })
                  }
                  required
                  disabled={Boolean(approvingId)}
                  placeholder="Bank / Telebirr reference"
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    label="Amount (ETB)"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={reviewForm.amount}
                    onChange={(e) => setReviewForm({ ...reviewForm, amount: e.target.value })}
                    required
                    disabled={Boolean(approvingId)}
                  />
                  <Select
                    label="Method"
                    value={reviewForm.method}
                    onChange={(e) => setReviewForm({ ...reviewForm, method: e.target.value })}
                    disabled={Boolean(approvingId)}
                  >
                    {['cash', 'bank_transfer', 'telebirr'].map((m) => (
                      <option key={m} value={m}>
                        {labelPaymentMethod(m)}
                      </option>
                    ))}
                  </Select>
                </div>

                <Select
                  label="Payment type"
                  value={reviewForm.type}
                  onChange={(e) => setReviewForm({ ...reviewForm, type: e.target.value })}
                  disabled={Boolean(approvingId)}
                >
                  <option value="collateral_deposit">{labelPaymentType('collateral_deposit')}</option>
                  <option value="down_payment">{labelPaymentType('down_payment')}</option>
                  <option value="installment">{labelPaymentType('installment')}</option>
                  <option value="final_settlement">{labelPaymentType('final_settlement')}</option>
                  <option value="deposit_refund">{labelPaymentType('deposit_refund')}</option>
                </Select>

                <Input
                  label="Official receipt file (optional — otherwise RentFlow generates PDF)"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setOfficialReceipt(e.target.files?.[0] || null)}
                  disabled={Boolean(approvingId)}
                />

                <p className="text-xs text-[var(--color-muted)]">
                  On approve, status becomes Approved and the official receipt is sent to the
                  customer on Telegram automatically.
                </p>

                {reviewError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {reviewError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(approvingId)}
                  onClick={() => {
                    setReview(null);
                    setOfficialReceipt(null);
                    setReviewError('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={Boolean(approvingId)}>
                  {approvingId === review.id ? 'Approving…' : 'Approve & send receipt'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
