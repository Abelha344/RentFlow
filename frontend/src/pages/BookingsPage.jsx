import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { FileText, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { assetUrl } from '../lib/assets';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  STATUS_TONE,
  formatMoney,
} from '../components/ui';
import { labelBookingStatus } from '../lib/labels';

const STATUS_COLOR = {
  draft: '#94a3b8',
  confirmed: '#0d6e5f',
  out_for_rent: '#047857',
  returned: '#64748b',
  overdue: '#b91c1c',
  cancelled: '#b45309',
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'out_for_rent', label: 'Out for rent' },
  { value: 'returned', label: 'Returned' },
  { value: 'overdue', label: 'Overdue' },
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

export default function BookingsPage() {
  const { user } = useAuth();
  const canCancel = can.cancelBooking(user?.role);
  const canSetDeposit = can.setDeposit(user?.role);
  const [events, setEvents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [wizard, setWizard] = useState(false);
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const [statusFilter, setStatusFilter] = useState('all');
  const [listSearch, setListSearch] = useState('');
  const [listDate, setListDate] = useState('');
  const [listPage, setListPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({
    customer_id: '',
    start_date: dayjs().format('YYYY-MM-DDTHH:mm'),
    end_date: dayjs().add(1, 'day').format('YYYY-MM-DDTHH:mm'),
    notes: '',
    collateral_tier: '',
    collateral_deposit: '',
    items: [{ item_id: '', quantity: 1 }],
  });
  const [tiers, setTiers] = useState({ low: 500, medium: 1500, higher: 5000 });
  const [availability, setAvailability] = useState(null);
  const [message, setMessage] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [depositEdit, setDepositEdit] = useState(null); // { id, amount }
  const [depositSaving, setDepositSaving] = useState(false);

  const load = async () => {
    const [cal, list, cust, inv, settings] = await Promise.all([
      api.get('/bookings/calendar'),
      api.get('/bookings'),
      api.get('/customers'),
      api.get('/inventory'),
      api.get('/settings').catch(() => ({ data: { data: {} } })),
    ]);
    setEvents(cal.data.data || []);
    setBookings(list.data.data || []);
    setCustomers(cust.data.data || []);
    setInventory(inv.data.data || []);
    const s = settings.data.data || {};
    setTiers({
      low: Number(s.collateral_tier_low) || 500,
      medium: Number(s.collateral_tier_medium) || 1500,
      higher: Number(s.collateral_tier_higher) || 5000,
    });
    setLoadError('');
  };

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      setLoadError(err.response?.data?.message || 'Failed to load bookings');
    });
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === form.customer_id),
    [customers, form.customer_id]
  );

  const estimatedRental = useMemo(() => {
    const days = Math.max(
      1,
      dayjs(form.end_date).diff(dayjs(form.start_date), 'day', true) || 1
    );
    return form.items.reduce((sum, line) => {
      if (!line.item_id) return sum;
      const inv = inventory.find((i) => i.id === line.item_id);
      if (!inv) return sum;
      return sum + Number(inv.rental_rate_per_day || 0) * Number(line.quantity || 0) * days;
    }, 0);
  }, [form.items, form.start_date, form.end_date, inventory]);

  const suggestedTier = useMemo(() => {
    // Guide agent: match deposit to overall rental value
    if (estimatedRental <= tiers.low) return 'low';
    if (estimatedRental <= tiers.medium) return 'medium';
    return 'higher';
  }, [estimatedRental, tiers]);

  const filteredBookings = useMemo(() => {
    let rows = statusFilter === 'all' ? bookings : bookings.filter((b) => b.status === statusFilter);
    const q = listSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((b) => String(b.customer_name || '').toLowerCase().includes(q));
    }
    if (listDate) {
      rows = rows.filter((b) => bookingCoversDate(b, listDate));
    }
    return rows;
  }, [bookings, statusFilter, listSearch, listDate]);

  const listTotalPages = Math.max(1, Math.ceil(filteredBookings.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);

  const pagedBookings = useMemo(() => {
    const start = (safeListPage - 1) * LIST_PAGE_SIZE;
    return filteredBookings.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredBookings, safeListPage]);

  useEffect(() => {
    setListPage(1);
  }, [statusFilter, listSearch, listDate]);

  const filteredEvents = useMemo(() => {
    if (statusFilter === 'all') return events;
    return events.filter((ev) => ev.extendedProps?.status === statusFilter);
  }, [events, statusFilter]);

  const calendarDays = useMemo(() => {
    const start = month.startOf('week'); // Sunday
    const end = month.endOf('month').endOf('week');
    const days = [];
    let cursor = start;
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      days.push(cursor);
      cursor = cursor.add(1, 'day');
    }
    return days;
  }, [month]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of filteredEvents) {
      const start = dayjs(ev.start).startOf('day');
      const end = dayjs(ev.end || ev.start).startOf('day');
      let d = start;
      while (d.isBefore(end) || d.isSame(end, 'day')) {
        const key = d.format('YYYY-MM-DD');
        if (!map[key]) map[key] = [];
        map[key].push(ev);
        d = d.add(1, 'day');
      }
    }
    return map;
  }, [filteredEvents]);

  const checkAvail = async () => {
    const payload = {
      start_date: new Date(form.start_date).toISOString(),
      end_date: new Date(form.end_date).toISOString(),
      items: form.items.filter((i) => i.item_id),
    };
    const { data } = await api.post('/bookings/availability', payload);
    setAvailability(data.data);
  };

  const createBooking = async (e) => {
    e.preventDefault();
    setMessage('');
    if (!form.collateral_tier && !(canSetDeposit && form.collateral_deposit !== '')) {
      setMessage('Select a security deposit tier: Low, Medium, or Higher');
      return;
    }
    try {
      const payload = {
        customer_id: form.customer_id,
        start_date: new Date(form.start_date).toISOString(),
        end_date: new Date(form.end_date).toISOString(),
        notes: form.notes,
        items: form.items.filter((i) => i.item_id),
        collateral_tier: form.collateral_tier || undefined,
      };
      if (canSetDeposit && form.collateral_deposit !== '') {
        payload.collateral_deposit = Number(form.collateral_deposit);
      }
      await api.post('/bookings', payload);
      setWizard(false);
      setAvailability(null);
      setForm((f) => ({
        ...f,
        collateral_tier: '',
        collateral_deposit: '',
        notes: '',
        items: [{ item_id: '', quantity: 1 }],
      }));
      await load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Could not create booking');
      if (err.response?.data?.availability) {
        setAvailability({ allOk: false, items: err.response.data.availability });
      }
    }
  };

  const setStatus = async (id, status) => {
    setActionMsg('');
    try {
      await api.patch(`/bookings/${id}/status`, { status });
      await load();
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Could not update booking');
    }
  };

  const saveDeposit = async (e) => {
    e.preventDefault();
    if (!depositEdit || depositSaving) return;
    setDepositSaving(true);
    setActionMsg('');
    try {
      await api.patch(`/bookings/${depositEdit.id}/deposit`, {
        collateral_deposit: Number(depositEdit.amount),
      });
      setDepositEdit(null);
      setActionMsg('Security deposit updated');
      await load();
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Could not update deposit');
    } finally {
      setDepositSaving(false);
    }
  };

  const printLease = async (id, { requireDeposit = true } = {}) => {
    setActionMsg('');
    try {
      const { data } = await api.post(`/bookings/${id}/work-order`);
      if (requireDeposit && data.data.deposit_paid === false) {
        setActionMsg('Collect security deposit first, then print the lease for the customer.');
        return;
      }
      window.open(assetUrl(data.data.url), '_blank');
    } catch (err) {
      setActionMsg(err.response?.data?.message || 'Could not open lease print');
    }
  };

  return (
    <div>
      <PageHeader
        title="Schedule & Bookings"
        subtitle="Collect deposit → print lease → dispatch. Lease includes collateral proof."
        actions={
          <Button onClick={() => setWizard(true)}>
            <Plus size={16} /> New booking
          </Button>
        }
      />

      {loadError && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{loadError}</p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-muted)]">Status</span>
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant={statusFilter === f.value ? 'primary' : 'secondary'}
            onClick={() => setStatusFilter(f.value)}
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

      <div className="card-panel p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <Button variant="secondary" onClick={() => setMonth((m) => m.subtract(1, 'month'))}>
            <ChevronLeft size={16} />
          </Button>
          <h2 className="font-display text-xl">{month.format('MMMM YYYY')}</h2>
          <Button variant="secondary" onClick={() => setMonth((m) => m.add(1, 'month'))}>
            <ChevronRight size={16} />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-[var(--color-line)] rounded-lg overflow-hidden border border-[var(--color-line)]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="bg-[var(--color-surface)] px-2 py-2 text-xs font-medium text-[var(--color-muted)]">
              {d}
            </div>
          ))}
          {calendarDays.map((day) => {
            const key = day.format('YYYY-MM-DD');
            const inMonth = day.month() === month.month();
            const dayEvents = eventsByDay[key] || [];
            return (
              <div
                key={key}
                className={`min-h-24 bg-white p-1.5 ${inMonth ? '' : 'opacity-40'}`}
              >
                <p className={`text-xs mb-1 ${day.isSame(dayjs(), 'day') ? 'font-bold text-[var(--color-brand)]' : 'text-[var(--color-muted)]'}`}>
                  {day.date()}
                </p>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={`${ev.id}-${key}`}
                      className="truncate rounded px-1 py-0.5 text-[10px] text-white"
                      style={{ backgroundColor: STATUS_COLOR[ev.extendedProps?.status] || '#0d6e5f' }}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="text-[10px] text-[var(--color-muted)]">+{dayEvents.length - 3} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-panel overflow-x-auto">
        {actionMsg && (
          <p className="m-3 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-950 px-3 py-2">
            {actionMsg}
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-line)]">
            <tr>
              <th className="p-3">Customer</th>
              <th className="p-3">Dates</th>
              <th className="p-3">Status</th>
              <th className="p-3">Deposit</th>
              <th className="p-3">Rental unpaid</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedBookings.map((b) => {
              const depositUnpaid = Number(b.deposit_unpaid || 0);
              const rentalUnpaid = Number(b.rental_unpaid || 0);
              const canDispatch = b.status === 'confirmed' && depositUnpaid <= 0.009;
              return (
                <tr key={b.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="p-3">
                    <p className="font-medium">{b.customer_name}</p>
                    {b.customer_rating < 3 && <Badge tone="warn">Low rating</Badge>}
                  </td>
                  <td className="p-3 text-xs">
                    {dayjs(b.start_date).format('MMM D HH:mm')} →{' '}
                    {dayjs(b.end_date).format('MMM D HH:mm')}
                    <div className="text-[var(--color-muted)]">
                      Buffer to {dayjs(b.buffer_end_date).format('MMM D HH:mm')}
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[b.status] || 'neutral'}>
                      {labelBookingStatus(b.status)}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs">
                    <div>Need {formatMoney(b.deposit_expected ?? b.collateral_deposit)}</div>
                    {depositUnpaid > 0.009 ? (
                      <div className="font-semibold text-[var(--color-danger)]">
                        Unpaid {formatMoney(depositUnpaid)}
                      </div>
                    ) : (
                      <div className="text-[var(--color-ok)] font-medium">Paid</div>
                    )}
                    {canSetDeposit && b.status !== 'cancelled' && (
                      <button
                        type="button"
                        className="mt-1 text-[11px] text-[var(--color-brand)] underline"
                        onClick={() =>
                          setDepositEdit({
                            id: b.id,
                            amount: String(
                              Number(b.deposit_expected ?? b.collateral_deposit ?? 0)
                            ),
                            customer: b.customer_name,
                            paid: Number(b.deposit_paid || 0),
                          })
                        }
                      >
                        Set deposit
                      </button>
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
                    <div className="flex flex-wrap gap-1">
                      {b.status === 'confirmed' && depositUnpaid > 0.009 && (
                        <Link to={`/payments?booking=${b.id}&intent=deposit`}>
                          <Button variant="secondary">Collect deposit</Button>
                        </Link>
                      )}
                      {depositUnpaid <= 0.009 && !['cancelled'].includes(b.status) && (
                        <Button
                          variant="secondary"
                          title="Print lease with deposit proof for the customer"
                          onClick={() => printLease(b.id)}
                        >
                          <FileText size={14} /> Print lease
                        </Button>
                      )}
                      {b.status === 'confirmed' && (
                        <Button
                          variant="secondary"
                          disabled={!canDispatch}
                          title={
                            canDispatch
                              ? 'Send equipment out'
                              : 'Pay security deposit first'
                          }
                          onClick={() => setStatus(b.id, 'out_for_rent')}
                        >
                          Dispatch
                        </Button>
                      )}
                      {canCancel && !['cancelled', 'returned'].includes(b.status) && (
                        <Button variant="ghost" onClick={() => setStatus(b.id, 'cancelled')}>
                          Cancel
                        </Button>
                      )}
                    </div>
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
                : statusFilter === 'all'
                  ? 'No bookings yet'
                  : `No ${statusFilter} bookings`
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

      {wizard && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto">
          <form onSubmit={createBooking} className="w-full max-w-2xl card-panel p-5 my-6 space-y-3">
            <h3 className="font-display text-xl">Booking wizard</h3>
            <Select
              label="Customer"
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} (★{c.rating})
                </option>
              ))}
            </Select>
            {selectedCustomer?.rating < 3 && (
              <p className="text-sm rounded-lg bg-amber-50 text-amber-900 p-3">
                This customer is rated below 3 stars. Higher collateral will be applied automatically.
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                label="Start"
                type="datetime-local"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
              />
              <Input
                label="End"
                type="datetime-local"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--color-muted)]">Line items</p>
              {form.items.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px] gap-2">
                  <Select
                    value={line.item_id}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx] = { ...items[idx], item_id: e.target.value };
                      setForm({ ...form, items });
                    }}
                    required
                  >
                    <option value="">Item…</option>
                    {inventory.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} (avail {i.available_now})
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx] = { ...items[idx], quantity: Number(e.target.value) };
                      setForm({ ...form, items });
                    }}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm({ ...form, items: [...form.items, { item_id: '', quantity: 1 }] })}
              >
                Add line
              </Button>
            </div>

            <Input
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />

            <div className="rounded-lg border border-[var(--color-line)] p-3 space-y-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <p className="font-medium">Security deposit (collateral)</p>
                <p className="text-[var(--color-muted)]">
                  Est. rental {formatMoney(estimatedRental)}
                </p>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                Pick Low / Medium / Higher based on equipment type and total rental value.
                Suggested for this cart: <span className="font-medium capitalize">{suggestedTier}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'low', label: 'Low' },
                  { key: 'medium', label: 'Medium' },
                  { key: 'higher', label: 'Higher' },
                ].map((opt) => {
                  const selected = form.collateral_tier === opt.key;
                  const suggested = suggestedTier === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setForm({ ...form, collateral_tier: opt.key })}
                      className={`rounded-lg border px-2 py-3 text-center transition ${
                        selected
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 ring-1 ring-[var(--color-brand)]'
                          : 'border-[var(--color-line)] bg-white hover:border-[var(--color-brand)]/50'
                      }`}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide">{opt.label}</p>
                      <p className="font-semibold mt-1">{formatMoney(tiers[opt.key])}</p>
                      {suggested && (
                        <p className="text-[10px] text-[var(--color-muted)] mt-1">Suggested</p>
                      )}
                    </button>
                  );
                })}
              </div>
              {canSetDeposit && (
                <Input
                  label="Admin override amount (optional)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.collateral_deposit}
                  onChange={(e) => setForm({ ...form, collateral_deposit: e.target.value })}
                  placeholder="Leave blank to use selected tier"
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={checkAvail}>
                Check availability
              </Button>
              <Button type="submit">Create booking</Button>
              <Button type="button" variant="ghost" onClick={() => setWizard(false)}>
                Close
              </Button>
            </div>

            {message && <p className="text-sm text-[var(--color-danger)]">{message}</p>}
            {availability && (
              <div className="text-sm rounded-lg border border-[var(--color-line)] p-3">
                <p className="font-medium mb-2">
                  {availability.allOk ? 'Stock OK for window + buffer' : 'Insufficient stock'}
                </p>
                <ul className="space-y-1">
                  {(availability.items || []).map((a) => (
                    <li key={a.itemId} className="flex justify-between">
                      <span>{a.name}</span>
                      <span className={a.sufficient === false ? 'text-[var(--color-danger)]' : ''}>
                        need {a.requested ?? 0} / avail {a.available}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        </div>
      )}

      {depositEdit && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40">
          <form onSubmit={saveDeposit} className="w-full max-w-sm card-panel p-5 space-y-3">
            <h3 className="font-display text-xl">Set security deposit</h3>
            <p className="text-sm text-[var(--color-muted)]">
              {depositEdit.customer}
              {depositEdit.paid > 0.009
                ? ` · already paid ${formatMoney(depositEdit.paid)}`
                : ''}
            </p>
            <Input
              label="Deposit required (ETB)"
              type="number"
              min={depositEdit.paid || 0}
              step="0.01"
              value={depositEdit.amount}
              onChange={(e) => setDepositEdit({ ...depositEdit, amount: e.target.value })}
              required
            />
            <p className="text-xs text-[var(--color-muted)]">
              Admin only. Cannot set below amount already paid.
            </p>
            <div className="flex gap-2">
              <Button type="submit" disabled={depositSaving}>
                {depositSaving ? 'Saving…' : 'Save deposit'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDepositEdit(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
