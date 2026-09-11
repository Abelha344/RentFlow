import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import {
  Badge,
  Button,
  ConfirmDangerDialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
  formatMoney,
} from '../components/ui';

const emptyForm = {
  name: '',
  category: 'Tents',
  total_quantity: 1,
  rental_rate_per_day: 100,
  buffer_time_hours: 24,
  min_stock_threshold: 2,
  damage_fee_semi: 0,
  damage_fee_full: 0,
  late_fee_per_day: 0,
};

const LIST_PAGE_SIZE = 15;

/** Match name/category by whole word or word start — avoids "table" matching "Portable". */
function textMatchesQuery(text, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const t = String(text || '').toLowerCase();
  if (t === q || t.startsWith(`${q} `) || t.includes(` ${q} `) || t.endsWith(` ${q}`)) {
    return true;
  }
  return t.split(/[\s/_-]+/).some((word) => word === q || word.startsWith(q));
}

export default function InventoryPage() {
  const { user } = useAuth();
  const canManage = can.createInventory(user?.role);
  const canAdjust = can.adjustStock(user?.role);
  const canDelete = can.deleteInventory(user?.role);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adjust, setAdjust] = useState(null);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    const { data } = await api.get('/inventory');
    setItems(data.data);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) => textMatchesQuery(item.name, q) || textMatchesQuery(item.category, q)
    );
  }, [items, search]);

  const listTotalPages = Math.max(1, Math.ceil(filteredItems.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);

  const pagedItems = useMemo(() => {
    const start = (safeListPage - 1) * LIST_PAGE_SIZE;
    return filteredItems.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredItems, safeListPage]);

  useEffect(() => {
    setListPage(1);
  }, [search]);

  const openCreate = () => {
    setEditingId(null);
    setFormError('');
    setForm({ ...emptyForm });
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setFormError('');
    setForm({
      name: item.name || '',
      category: item.category || 'Other',
      total_quantity: item.total_quantity ?? 1,
      rental_rate_per_day: item.rental_rate_per_day ?? 0,
      buffer_time_hours: item.buffer_time_hours ?? 24,
      min_stock_threshold: item.min_stock_threshold ?? 0,
      damage_fee_semi: item.damage_fee_semi ?? 0,
      damage_fee_full: item.damage_fee_full ?? 0,
      late_fee_per_day: item.late_fee_per_day ?? 0,
    });
  };

  const saveItem = async (e) => {
    e.preventDefault();
    if (!canManage || !form || saving) return;
    setFormError('');
    setSaving(true);
    try {
      const payload = {
        name: String(form.name || '').trim(),
        category: form.category || 'Other',
        total_quantity: Number(form.total_quantity) || 0,
        rental_rate_per_day: Number(form.rental_rate_per_day) || 0,
        buffer_time_hours: Number(form.buffer_time_hours) || 24,
        min_stock_threshold: Number(form.min_stock_threshold) || 0,
        damage_fee_semi: Number(form.damage_fee_semi) || 0,
        damage_fee_full: Number(form.damage_fee_full) || 0,
        late_fee_per_day: Number(form.late_fee_per_day) || 0,
      };
      if (!payload.name) {
        setFormError('Name is required');
        return;
      }
      if (editingId) {
        await api.patch(`/inventory/${editingId}`, payload);
      } else {
        await api.post('/inventory', payload);
      }
      setForm(null);
      setEditingId(null);
      await load();
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.message ||
        err.message ||
        'Could not save item';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const openAdjust = (item) => {
    setAdjust({
      id: item.id,
      name: item.name,
      qty_good: item.qty_good,
      qty_semi_damaged: item.qty_semi_damaged,
      qty_damaged: item.qty_damaged,
      reason: '',
    });
  };

  const saveAdjust = async (e) => {
    e.preventDefault();
    if (!canAdjust || !adjust || adjustSaving) return;
    setAdjustSaving(true);
    try {
      await api.post(`/inventory/${adjust.id}/adjust-stock`, {
        qty_good: Number(adjust.qty_good),
        qty_semi_damaged: Number(adjust.qty_semi_damaged),
        qty_damaged: Number(adjust.qty_damaged),
        reason: adjust.reason || 'Stock count',
      });
      setAdjust(null);
      await load();
    } finally {
      setAdjustSaving(false);
    }
  };

  const removeItem = async () => {
    if (!canDelete || !deleteTarget || deletingId) return;
    setDeletingId(deleteTarget.id);
    try {
      await api.delete(`/inventory/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  const searchField = (
    <div className="relative w-full sm:w-auto">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
      />
      <input
        className="w-full rounded-lg border border-[var(--color-line)] bg-white py-2 pl-9 pr-3 text-sm sm:min-w-[14rem]"
        placeholder="Search by name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search inventory by name"
      />
    </div>
  );

  const itemActions = (item, { stacked = false } = {}) => (
    <div
      className={
        stacked
          ? 'grid grid-cols-1 gap-2 sm:grid-cols-2'
          : 'flex flex-wrap gap-1 sm:justify-end'
      }
    >
      {canManage && (
        <Button
          variant="secondary"
          className={stacked ? 'w-full' : ''}
          onClick={() => openEdit(item)}
        >
          <Pencil size={14} /> Edit fees
        </Button>
      )}
      {canAdjust && (
        <Button
          variant="secondary"
          className={stacked ? 'w-full' : ''}
          onClick={() => openAdjust(item)}
        >
          Update stock
        </Button>
      )}
      {canDelete && (
        <Button
          variant="danger"
          className={stacked ? 'w-full sm:col-span-2' : ''}
          onClick={() => setDeleteTarget(item)}
          disabled={Boolean(deletingId)}
        >
          <Trash2 size={14} />
          Remove
        </Button>
      )}
    </div>
  );

  return (
    <div className={canManage ? 'pb-24 lg:pb-0' : ''}>
      <PageHeader
        title={canManage ? 'Inventory Management' : 'Inventory lookup'}
        subtitle="Items, stock condition, rates, and damage fees."
        actions={
          <>
            {searchField}
            {canManage && (
              <Button onClick={openCreate} className="hidden w-full sm:w-auto lg:inline-flex">
                <Plus size={16} /> Add item
              </Button>
            )}
          </>
        }
      />

      {/* Mobile: same workflow as desktop — searchable catalog + full actions */}
      <div className="space-y-3 lg:hidden">
        {!filteredItems.length ? (
          <div className="card-panel">
            <EmptyState
              message={search.trim() ? 'No items match this search' : 'No inventory items'}
            />
          </div>
        ) : (
          pagedItems.map((item) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white shadow-sm"
            >
              <div className="border-b border-[var(--color-line)] bg-gradient-to-br from-[#0f1c1a]/[0.04] to-transparent px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-display text-xl leading-tight text-[var(--color-ink)]">
                      {item.name}
                    </h2>
                    {item.category ? (
                      <p className="mt-0.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">
                        {item.category}
                      </p>
                    ) : null}
                  </div>
                  {item.is_low_stock ? <Badge tone="warn">Low stock</Badge> : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px bg-[var(--color-line)]">
                <div className="bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                    Available
                  </p>
                  <p className="mt-0.5 font-display text-2xl leading-none">{item.available_now}</p>
                </div>
                <div className="bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                    Out for rent
                  </p>
                  <p className="mt-0.5 font-display text-2xl leading-none">
                    {item.reserved_now ?? 0}
                  </p>
                </div>
              </div>

              <div className="space-y-3 px-4 py-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                    Condition
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="font-medium text-[var(--color-ok)]">Good {item.qty_good}</span>
                    <span className="text-[var(--color-muted)]"> · </span>
                    <span className="font-medium text-amber-700">Semi {item.qty_semi_damaged}</span>
                    <span className="text-[var(--color-muted)]"> · </span>
                    <span className="font-medium text-[var(--color-danger)]">
                      Damaged {item.qty_damaged}
                    </span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                      Rate / day
                    </p>
                    <p className="mt-0.5 font-medium">{formatMoney(item.rental_rate_per_day)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                      Late fee / day
                    </p>
                    <p className="mt-0.5 font-medium">{formatMoney(item.late_fee_per_day)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                      Damage fee
                    </p>
                    <p className="mt-0.5 text-sm">
                      Semi {formatMoney(item.damage_fee_semi)}
                      <span className="text-[var(--color-muted)]"> · </span>
                      Full {formatMoney(item.damage_fee_full)}
                    </p>
                  </div>
                </div>

                {(canManage || canAdjust || canDelete) && (
                  <div className="border-t border-[var(--color-line)] pt-3">
                    {itemActions(item, { stacked: true })}
                  </div>
                )}
              </div>
            </article>
          ))
        )}

        {filteredItems.length > LIST_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--color-line)] bg-white px-3 py-3">
            <p className="text-xs text-[var(--color-muted)]">
              Page {safeListPage} of {listTotalPages} · {filteredItems.length} items
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

      {/* Desktop table — unchanged */}
      <div className="card-panel hidden overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-line)] text-left text-[var(--color-muted)]">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Available</th>
                <th className="p-3">Out for rent</th>
                <th className="p-3">Condition</th>
                <th className="p-3">Rate / day</th>
                <th className="p-3">Late fee / day</th>
                <th className="p-3">Damage fee</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((item) => (
                <tr key={item.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="p-3">
                    <p className="font-medium">{item.name}</p>
                    {item.category ? (
                      <p className="text-xs text-[var(--color-muted)]">{item.category}</p>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <span className="font-medium">{item.available_now}</span>
                    {item.is_low_stock && (
                      <div className="mt-1">
                        <Badge tone="warn">Low stock</Badge>
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-medium">{item.reserved_now ?? 0}</td>
                  <td className="p-3 whitespace-nowrap text-xs">
                    <span className="text-[var(--color-ok)]">Good {item.qty_good}</span>
                    {' · '}
                    <span className="text-amber-700">Semi {item.qty_semi_damaged}</span>
                    {' · '}
                    <span className="text-[var(--color-danger)]">Damaged {item.qty_damaged}</span>
                  </td>
                  <td className="p-3">{formatMoney(item.rental_rate_per_day)}</td>
                  <td className="p-3">{formatMoney(item.late_fee_per_day)}</td>
                  <td className="p-3 text-xs">
                    <div>Semi {formatMoney(item.damage_fee_semi)}</div>
                    <div>Full {formatMoney(item.damage_fee_full)}</div>
                  </td>
                  <td className="p-3">{itemActions(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredItems.length && (
          <EmptyState message={search.trim() ? 'No items match this search' : 'No inventory items'} />
        )}
        {filteredItems.length > LIST_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-3">
            <p className="text-xs text-[var(--color-muted)]">
              Page {safeListPage} of {listTotalPages} · {filteredItems.length} items ·{' '}
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

      {canManage && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-line)] bg-white/95 px-4 py-3 backdrop-blur lg:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button onClick={openCreate} className="w-full">
            <Plus size={16} /> Add item
          </Button>
        </div>
      )}

      {canManage && form && (
        <Modal
          title={editingId ? `Edit — ${form.name}` : 'New item'}
          onClose={() => !saving && setForm(null)}
        >
          <form onSubmit={saveItem} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Name"
                  className="sm:col-span-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  disabled={saving}
                />
                <Select
                  label="Category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  disabled={saving}
                >
                  {['Tents', 'Seating', 'Tables', 'Lighting', 'AV', 'Decor', 'Other'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                {!editingId && (
                  <Input
                    label="Total quantity"
                    type="number"
                    min="0"
                    value={form.total_quantity}
                    onChange={(e) => setForm({ ...form, total_quantity: e.target.value })}
                    disabled={saving}
                  />
                )}
                <Input
                  label="Rate per day (ETB)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rental_rate_per_day}
                  onChange={(e) => setForm({ ...form, rental_rate_per_day: e.target.value })}
                  disabled={saving}
                />
                <Input
                  label="Late fee / day (ETB)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.late_fee_per_day}
                  onChange={(e) => setForm({ ...form, late_fee_per_day: e.target.value })}
                  disabled={saving}
                />
                <Input
                  label="Semi-damage fee (ETB)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.damage_fee_semi}
                  onChange={(e) => setForm({ ...form, damage_fee_semi: e.target.value })}
                  disabled={saving}
                />
                <Input
                  label="Full damage fee (ETB)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.damage_fee_full}
                  onChange={(e) => setForm({ ...form, damage_fee_full: e.target.value })}
                  disabled={saving}
                />
                <p className="sm:col-span-2 text-xs text-[var(--color-muted)]">
                  Damage fees: charged on return × number of damaged units. Set 0 = no penalty.
                </p>
                {formError && (
                  <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <Button variant="secondary" type="button" disabled={saving} onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save fees' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {canAdjust && adjust && (
        <Modal
          title={`Update stock — ${adjust.name}`}
          onClose={() => !adjustSaving && setAdjust(null)}
        >
          <form onSubmit={saveAdjust} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              <p className="text-sm text-[var(--color-muted)]">
                Fix warehouse count only. Customer penalties → Edit fees.
              </p>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Input
                  label="Good"
                  type="number"
                  min="0"
                  value={adjust.qty_good}
                  disabled={adjustSaving}
                  onChange={(e) => setAdjust({ ...adjust, qty_good: e.target.value })}
                />
                <Input
                  label="Semi"
                  type="number"
                  min="0"
                  value={adjust.qty_semi_damaged}
                  disabled={adjustSaving}
                  onChange={(e) => setAdjust({ ...adjust, qty_semi_damaged: e.target.value })}
                />
                <Input
                  label="Damaged"
                  type="number"
                  min="0"
                  value={adjust.qty_damaged}
                  disabled={adjustSaving}
                  onChange={(e) => setAdjust({ ...adjust, qty_damaged: e.target.value })}
                />
              </div>
              <Input
                label="Reason"
                placeholder="e.g. Stock count"
                value={adjust.reason}
                disabled={adjustSaving}
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
                required
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <Button
                variant="secondary"
                type="button"
                disabled={adjustSaving}
                onClick={() => setAdjust(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={adjustSaving}>
                {adjustSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <ConfirmDangerDialog
          title="Remove this stock item?"
          subtitle="It will disappear from the live catalog. You can register real stock again anytime."
          summary={
            <div>
              <p className="font-medium break-words">{deleteTarget.name}</p>
              {deleteTarget.category ? (
                <p className="mt-0.5 text-sm text-[var(--color-muted)]">{deleteTarget.category}</p>
              ) : null}
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Available now: <span className="font-medium text-[var(--color-ink)]">{deleteTarget.available_now}</span>
                {' · '}
                Rate {formatMoney(deleteTarget.rental_rate_per_day)} / day
              </p>
            </div>
          }
          bullets={[
            'Hidden from bookings and inventory lists',
            'Past rentals and payments stay on record',
            'Only admins can remove stock items',
          ]}
          cancelLabel="Keep item"
          confirmLabel="Yes, remove stock"
          loading={deletingId === deleteTarget.id}
          onCancel={() => !deletingId && setDeleteTarget(null)}
          onConfirm={removeItem}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/40">
      <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="card-panel mb-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[min(92dvh,56rem)] w-full max-w-lg flex-col overflow-hidden shadow-xl sm:mb-0"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5 sm:py-4">
            <h3 className="font-display text-xl leading-tight">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  );
}
