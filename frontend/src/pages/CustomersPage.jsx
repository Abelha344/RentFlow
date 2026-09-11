import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { assetUrl } from '../lib/assets';
import {
  Badge,
  Button,
  ConfirmDangerDialog,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
  formatMoney,
} from '../components/ui';
import { labelBookingStatus, labelPayStatus } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';

const emptyForm = {
  full_name: '',
  phone: '',
  email: '',
  address: '',
  id_number: '',
  rating: 3,
  notes: '',
};

const LIST_PAGE_SIZE = 10;

export default function CustomersPage() {
  const { user } = useAuth();
  const canDelete = can.deleteCustomer(user?.role);
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [idCard, setIdCard] = useState(null);
  const [existingKyc, setExistingKyc] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isEditing = Boolean(editingId);

  const load = async () => {
    const { data } = await api.get('/customers');
    setCustomers(data.data);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const name = String(c.full_name || '').toLowerCase();
      const phone = String(c.phone || '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [customers, listSearch]);

  const listTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);

  const pagedCustomers = useMemo(() => {
    const start = (safeListPage - 1) * LIST_PAGE_SIZE;
    return filteredCustomers.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredCustomers, safeListPage]);

  useEffect(() => {
    setListPage(1);
  }, [listSearch]);

  const openCustomer = async (id) => {
    const { data } = await api.get(`/customers/${id}`);
    setSelected(data.data);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIdCard(null);
    setExistingKyc(null);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (customer) => {
    setEditingId(customer.id);
    setForm({
      full_name: customer.full_name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      id_number: customer.id_number || '',
      rating: customer.rating ?? 3,
      notes: customer.notes || '',
    });
    setIdCard(null);
    setExistingKyc(customer.id_card_url || null);
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setIdCard(null);
    setExistingKyc(null);
    setFormError('');
  };

  const confirmDeleteCustomer = async () => {
    if (!canDelete || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/customers/${deleteTarget.id}`);
      setDeleteTarget(null);
      setSelected(null);
      await load();
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Could not delete customer');
    } finally {
      setDeleting(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.full_name.trim()) {
      setFormError('Full name is required');
      return;
    }
    if (!form.phone.trim()) {
      setFormError('Phone is required');
      return;
    }
    if (!form.address.trim()) {
      setFormError('Address is required');
      return;
    }
    if (!isEditing && !idCard) {
      setFormError('KYC scan is required');
      return;
    }
    if (isEditing && !existingKyc && !idCard) {
      setFormError('KYC scan is required');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (idCard) fd.append('id_card', idCard);

      if (isEditing) {
        await api.patch(`/customers/${editingId}`, fd);
        await openCustomer(editingId);
      } else {
        const { data } = await api.post('/customers', fd);
        if (data.data?.id) await openCustomer(data.data.id);
      }

      closeForm();
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(
        err.response?.data?.message || err.message || 'Could not save customer'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Customer Management"
        subtitle="Profiles, KYC documents, and rating-based collateral warnings."
        actions={
          <Button onClick={openCreate} className="w-full sm:w-auto">
            <Plus size={16} /> New customer
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 card-panel overflow-hidden">
          <div className="border-b border-[var(--color-line)] px-3 py-3">
            <Input
              label="Search customer"
              placeholder="Name or phone"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
          </div>

          {/* Mobile: stacked cards (full info, no column cut-off) */}
          <ul className="divide-y divide-[var(--color-line)] lg:hidden">
            {pagedCustomers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openCustomer(c.id)}
                  className={`w-full px-3 py-3 text-left transition hover:bg-[var(--color-surface)] ${
                    selected?.id === c.id ? 'bg-[var(--color-surface)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 break-words font-medium leading-snug">
                      {c.full_name}
                    </p>
                    {c.id_card_url ? <Badge tone="ok">KYC</Badge> : <Badge>No KYC</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{c.phone || '—'}</p>
                  <p className="mt-1 break-words text-xs text-[var(--color-muted)]">
                    {c.address || 'No address'}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
                    <Star
                      size={14}
                      className={
                        c.rating < 3 ? 'text-[var(--color-warn)]' : 'text-[var(--color-brand)]'
                      }
                    />
                    {c.rating}/5
                    {c.rating < 3 ? ' · Higher collateral' : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: unchanged table */}
          <table className="hidden w-full text-sm lg:table">
            <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-line)]">
              <tr>
                <th className="p-3">Customer</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Address</th>
                <th className="p-3">Rating</th>
                <th className="p-3">KYC</th>
              </tr>
            </thead>
            <tbody>
              {pagedCustomers.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--color-line)] last:border-0 cursor-pointer hover:bg-[var(--color-surface)]"
                  onClick={() => openCustomer(c.id)}
                >
                  <td className="p-3 font-medium">{c.full_name}</td>
                  <td className="p-3">{c.phone || '—'}</td>
                  <td className="p-3 text-xs max-w-[10rem] truncate" title={c.address || ''}>
                    {c.address || '—'}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1">
                      <Star
                        size={14}
                        className={
                          c.rating < 3 ? 'text-[var(--color-warn)]' : 'text-[var(--color-brand)]'
                        }
                      />
                      {c.rating}/5
                    </span>
                    {c.rating < 3 && (
                      <div className="mt-1">
                        <Badge tone="warn">Higher collateral</Badge>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {c.id_card_url ? <Badge tone="ok">Uploaded</Badge> : <Badge>Missing</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!filteredCustomers.length && (
            <EmptyState
              message={listSearch ? 'No customers match this search' : 'No customers yet'}
            />
          )}
          {filteredCustomers.length > LIST_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-3">
              <p className="text-xs text-[var(--color-muted)]">
                Page {safeListPage} of {listTotalPages} · {filteredCustomers.length} customers ·{' '}
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

        {/* Desktop detail panel */}
        <div className="hidden lg:col-span-2 lg:block">
          <div className="card-panel p-4">
            {!selected ? (
              <EmptyState message="Select a customer to view KYC & history" />
            ) : (
              <CustomerDetail
                selected={selected}
                onEdit={openEdit}
                canDelete={canDelete}
                onDelete={() => {
                  setDeleteError('');
                  setDeleteTarget(selected);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile detail sheet — full info, scrollable */}
      {selected && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close customer details"
            onClick={() => setSelected(null)}
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
              <h2 className="min-w-0 flex-1 break-words font-display text-xl leading-tight">
                {selected.full_name}
              </h2>
              <button
                type="button"
                className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <CustomerDetail
                selected={selected}
                onEdit={openEdit}
                canDelete={canDelete}
                onDelete={() => {
                  setDeleteError('');
                  setDeleteTarget(selected);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile sticky register */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-line)] bg-white/95 px-4 py-3 backdrop-blur lg:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button onClick={openCreate} className="w-full">
          <Plus size={16} /> New customer
        </Button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/40">
          <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-4">
            <form
              onSubmit={save}
              className="card-panel mb-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[min(92dvh,56rem)] w-full max-w-lg flex-col overflow-hidden shadow-xl sm:mb-0"
            >
              <div className="shrink-0 border-b border-[var(--color-line)] px-4 py-3 sm:px-5 sm:py-4">
                <h3 className="font-display text-xl">
                  {isEditing ? 'Edit customer' : 'New customer'}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Fields marked <span className="text-red-600">*</span> are required
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                <Input
                  label="Full name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    label="Phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                  <Input
                    label="Email"
                    type="email"
                    optional
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <Textarea
                  label="Address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  required
                  rows={2}
                  placeholder="City, subcity, street / landmark"
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    label="ID number"
                    optional
                    value={form.id_number}
                    onChange={(e) => setForm({ ...form, id_number: e.target.value })}
                  />
                  <Input
                    label="Rating (1-5)"
                    type="number"
                    min="1"
                    max="5"
                    optional
                    value={form.rating}
                    onChange={(e) => setForm({ ...form, rating: e.target.value })}
                  />
                </div>
                <Input
                  label="KYC scan (ID / passport / license)"
                  type="file"
                  accept="image/*,.avif,application/pdf"
                  required={!isEditing || !existingKyc}
                  optional={isEditing && Boolean(existingKyc)}
                  onChange={(e) => setIdCard(e.target.files?.[0] || null)}
                />
                {isEditing && existingKyc && (
                  <p className="text-xs text-[var(--color-muted)]">
                    Current KYC on file — leave empty to keep it, or choose a new file to replace.{' '}
                    <a
                      className="text-[var(--color-brand)] underline"
                      href={assetUrl(existingKyc)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View current
                    </a>
                  </p>
                )}
                <Textarea
                  label="Notes"
                  optional
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
                {formError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                <Button variant="secondary" type="button" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDangerDialog
          title="Delete this customer?"
          subtitle="They will be removed from the active customer list."
          summary={
            <div>
              <p className="break-words font-medium">{deleteTarget.full_name}</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {deleteTarget.phone || 'No phone'}
                {deleteTarget.address ? ` · ${deleteTarget.address}` : ''}
              </p>
            </div>
          }
          bullets={[
            'Hidden from search and new bookings',
            'Past bookings and payments stay on record',
            'Only admins can delete customers — agents may edit only',
          ]}
          cancelLabel="Keep customer"
          confirmLabel="Yes, delete customer"
          loading={deleting}
          error={deleteError}
          onCancel={() => !deleting && setDeleteTarget(null)}
          onConfirm={confirmDeleteCustomer}
        />
      )}
    </div>
  );
}

function CustomerDetail({ selected, onEdit, canDelete = false, onDelete }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="hidden min-w-0 flex-1 break-words font-display text-xl lg:block">
          {selected.full_name}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" type="button" onClick={() => onEdit(selected)}>
            <Pencil size={14} /> Edit
          </Button>
          {canDelete && (
            <Button variant="danger" type="button" onClick={onDelete}>
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
      </div>
      {selected.requires_higher_collateral && (
        <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
          <AlertTriangle size={18} className="shrink-0" />
          <p>Rating below 3 — collect a higher collateral deposit before confirming bookings.</p>
        </div>
      )}
      <dl className="space-y-2.5">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Phone</dt>
          <dd className="break-words font-medium">{selected.phone || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Address</dt>
          <dd className="break-words">{selected.address || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Email</dt>
          <dd className="break-all">{selected.email || '—'}</dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">ID #</dt>
            <dd className="break-words">{selected.id_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Rating</dt>
            <dd>{selected.rating}/5</dd>
          </div>
        </div>
        {selected.notes ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Notes</dt>
            <dd className="break-words whitespace-pre-wrap">{selected.notes}</dd>
          </div>
        ) : null}
      </dl>
      {Number(selected.total_outstanding) > 0.009 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
          <p className="text-xs uppercase tracking-wide opacity-80">Unpaid (open bookings)</p>
          <p className="text-lg font-semibold">{formatMoney(selected.total_outstanding)}</p>
        </div>
      )}
      <div className="space-y-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <p className="font-medium">
          Telegram{' '}
          {selected.telegram_linked ? (
            <Badge tone="ok">Linked</Badge>
          ) : (
            <Badge tone="warn">Not linked yet</Badge>
          )}
        </p>
        <p className="text-sm leading-relaxed text-[var(--color-muted)]">
          Anyone can open the RentFlow Telegram bot and tap <span className="font-medium">Start</span>.
          They can send a payment screenshot + transaction ID immediately. No invite code needed. After
          you approve in Payments, they receive the official receipt on Telegram.
        </p>
      </div>
      {selected.id_card_url && (
        <a
          className="inline-block text-[var(--color-brand)] underline"
          href={assetUrl(selected.id_card_url)}
          target="_blank"
          rel="noreferrer"
        >
          View KYC document
        </a>
      )}
      <div>
        <p className="mb-2 font-medium">Recent bookings</p>
        <ul className="space-y-2">
          {(selected.bookings || []).map((b) => (
            <li
              key={b.id}
              className="space-y-1 rounded-lg border border-[var(--color-line)] p-2 text-sm"
            >
              <div className="flex justify-between gap-2">
                <span className="capitalize">{labelBookingStatus(b.status)}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {new Date(b.start_date).toLocaleDateString()}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <span>Due {formatMoney(b.amount_due ?? b.total_amount)}</span>
                <span className="text-[var(--color-ok)]">Paid {formatMoney(b.paid_total)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={
                    Number(b.balance_due) > 0.009
                      ? 'font-semibold text-[var(--color-danger)]'
                      : 'text-[var(--color-muted)]'
                  }
                >
                  Unpaid {formatMoney(b.balance_due)}
                </span>
                <Badge
                  tone={
                    b.pay_status === 'paid' ? 'ok' : b.pay_status === 'partial' ? 'warn' : 'danger'
                  }
                >
                  {labelPayStatus(b.pay_status)}
                </Badge>
              </div>
            </li>
          ))}
          {!(selected.bookings || []).length && (
            <li className="text-xs text-[var(--color-muted)]">No bookings yet</li>
          )}
        </ul>
      </div>
    </div>
  );
}
