import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import {
  Badge,
  Button,
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
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adjust, setAdjust] = useState(null);
  const [adjustSaving, setAdjustSaving] = useState(false);

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
    setForm({ ...emptyForm });
  };

  const openEdit = (item) => {
    setEditingId(item.id);
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
    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/inventory/${editingId}`, form);
      } else {
        await api.post('/inventory', form);
      }
      setForm(null);
      setEditingId(null);
      await load();
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

  return (
    <div>
      <PageHeader
        title={canManage ? 'Inventory Management' : 'Inventory lookup'}
        subtitle="Items, stock condition, rates, and damage fees."
        actions={
          <>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <input
                className="rounded-lg border border-[var(--color-line)] bg-white pl-9 pr-3 py-2 text-sm min-w-[14rem]"
                placeholder="Search by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label="Search inventory by name"
              />
            </div>
            {canManage && (
              <Button onClick={openCreate}>
                <Plus size={16} /> Add item
              </Button>
            )}
          </>
        }
      />

      <div className="card-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-line)]">
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
                <td className="p-3 text-xs whitespace-nowrap">
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
                <td className="p-3">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canManage && (
                      <Button variant="secondary" onClick={() => openEdit(item)}>
                        <Pencil size={14} /> Edit fees
                      </Button>
                    )}
                    {canAdjust && (
                      <Button variant="secondary" onClick={() => openAdjust(item)}>
                        Update stock
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
              <div className="grid gap-3 sm:grid-cols-3">
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
          className="card-panel flex w-full max-w-lg max-h-[min(92dvh,56rem)] flex-col overflow-hidden shadow-xl mb-[max(0.5rem,env(safe-area-inset-bottom))] sm:mb-0"
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
