import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Pencil, Trash2, Shield, Landmark, Clock, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { Badge, Button, EmptyState, Input, PageHeader, Select, formatMoney } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../lib/roles';

const TIER_META = [
  {
    key: 'low',
    settingKey: 'collateral_tier_low',
    label: 'Low',
    hint: 'Light kits · short rentals',
    accent: 'border-l-[var(--color-ok)]',
  },
  {
    key: 'medium',
    settingKey: 'collateral_tier_medium',
    label: 'Medium',
    hint: 'Standard events · mixed gear',
    accent: 'border-l-[var(--color-brand)]',
  },
  {
    key: 'higher',
    settingKey: 'collateral_tier_higher',
    label: 'Higher',
    hint: 'High-value · tents · long hire',
    accent: 'border-l-[var(--color-accent)]',
  },
];

const AUDIT_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

const AUDIT_PAGE_SIZE = 20;
const STAFF_PAGE_SIZE = 5;

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState({});
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [editing, setEditing] = useState(null);
  const [tierDraft, setTierDraft] = useState({ low: '', medium: '', higher: '' });
  const [savingTiers, setSavingTiers] = useState(false);
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'cashier',
  });
  const [terminateTarget, setTerminateTarget] = useState(null);
  const [terminating, setTerminating] = useState(false);
  const [staffPage, setStaffPage] = useState(1);
  const [auditPeriod, setAuditPeriod] = useState('week');
  const [auditPage, setAuditPage] = useState(1);
  const [auditMeta, setAuditMeta] = useState({
    total: 0,
    total_pages: 1,
    retention_days: 90,
  });
  const [customFrom, setCustomFrom] = useState(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
  const [customTo, setCustomTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLogs = async (page = auditPage, period = auditPeriod) => {
    setLogsLoading(true);
    try {
      const params = {
        page,
        limit: AUDIT_PAGE_SIZE,
        period,
      };
      if (period === 'custom') {
        params.from = customFrom;
        params.to = customTo;
      }
      const a = await api.get('/settings/audit-logs', { params });
      setLogs(a.data.data || []);
      setAuditMeta(a.data.meta || { total: 0, total_pages: 1, retention_days: 90 });
      setAuditPage(a.data.meta?.page || page);
    } finally {
      setLogsLoading(false);
    }
  };

  const load = async () => {
    setError('');
    const s = await api.get('/settings');
    const map = s.data.data || {};
    setSettings(map);
    setTierDraft({
      low: String(map.collateral_tier_low ?? ''),
      medium: String(map.collateral_tier_medium ?? ''),
      higher: String(map.collateral_tier_higher ?? ''),
    });
    if (isAdmin) {
      const u = await api.get('/auth/users');
      setUsers(u.data.data || []);
    } else {
      setUsers([]);
    }
  };

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to load settings');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (!user) return;
    loadLogs(auditPage, auditPeriod).catch((err) => {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to load audit logs');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditPage, auditPeriod, customFrom, customTo, user?.id]);

  const changeAuditPeriod = (value) => {
    setAuditPeriod(value);
    setAuditPage(1);
  };

  const saveSetting = async (key, value) => {
    if (!isAdmin) return;
    setSavedMsg('');
    await api.put(`/settings/${key}`, { value });
    setSavedMsg('Saved');
    await load();
  };

  const saveTiers = async () => {
    if (!isAdmin || savingTiers) return;
    setSavingTiers(true);
    setError('');
    setSavedMsg('');
    try {
      await Promise.all([
        api.put('/settings/collateral_tier_low', { value: Number(tierDraft.low) }),
        api.put('/settings/collateral_tier_medium', { value: Number(tierDraft.medium) }),
        api.put('/settings/collateral_tier_higher', { value: Number(tierDraft.higher) }),
      ]);
      setSavedMsg('Deposit tiers updated');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save deposit tiers');
    } finally {
      setSavingTiers(false);
    }
  };

  const staffTotalPages = Math.max(1, Math.ceil(users.length / STAFF_PAGE_SIZE));
  const pagedStaff = useMemo(() => {
    const page = Math.min(staffPage, staffTotalPages);
    const start = (page - 1) * STAFF_PAGE_SIZE;
    return users.slice(start, start + STAFF_PAGE_SIZE);
  }, [users, staffPage, staffTotalPages]);

  useEffect(() => {
    if (staffPage > staffTotalPages) setStaffPage(staffTotalPages);
  }, [staffPage, staffTotalPages]);

  const createUser = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    setError('');
    try {
      await api.post('/auth/users', userForm);
      setUserForm({ full_name: '', email: '', password: '', role: 'cashier' });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create user');
    }
  };

  const saveRoleEdit = async (e) => {
    e.preventDefault();
    if (!isAdmin || !editing) return;
    setError('');
    try {
      await api.patch(`/auth/users/${editing.id}`, {
        role: editing.role,
        full_name: editing.full_name,
        is_active: editing.is_active,
        ...(editing.password ? { password: editing.password } : {}),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update user');
    }
  };

  const requestTerminate = (u) => {
    if (!isAdmin) return;
    if (u.id === user.id) {
      setError('You cannot terminate your own account');
      return;
    }
    setError('');
    setTerminateTarget(u);
  };

  const confirmTerminate = async () => {
    if (!terminateTarget || terminating) return;
    setTerminating(true);
    setError('');
    try {
      const { data } = await api.delete(`/auth/users/${terminateTarget.id}`);
      setTerminateTarget(null);
      setSavedMsg(data.message || `${terminateTarget.full_name} was terminated and removed.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not terminate user');
    } finally {
      setTerminating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="System Settings & Audit Logs"
        subtitle="Store policies, staff accounts, and action history."
      />

      {error && (
        <p className="mb-4 text-sm rounded-lg border border-red-200 bg-red-50 text-red-900 px-3 py-2">
          {error}
        </p>
      )}
      {savedMsg && (
        <p className="mb-4 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2">
          {savedMsg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        {/* Store policies */}
        <div className="card-panel overflow-hidden">
          <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 px-4 py-3">
            <h2 className="font-display text-xl">Store policies</h2>
            {!isAdmin && (
              <p className="text-xs text-[var(--color-muted)] mt-1">View only — admin can edit</p>
            )}
          </div>

          <div className="p-4 space-y-5">
            <section>
              <div className="mb-3">
                <p className="font-medium">Security deposit tiers</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Agents choose Low, Medium, or Higher when booking — match to equipment value and
                  rental total.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {TIER_META.map((tier) => (
                  <div
                    key={tier.key}
                    className={`rounded-xl border border-[var(--color-line)] bg-white p-3 border-l-4 ${tier.accent} shadow-[0_1px_0_rgba(15,28,26,0.04)]`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      {tier.label}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)] mt-0.5 leading-snug">
                      {tier.hint}
                    </p>
                    {isAdmin ? (
                      <label className="mt-3 block">
                        <span className="sr-only">{tier.label} amount</span>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={tierDraft[tier.key]}
                            onChange={(e) =>
                              setTierDraft({ ...tierDraft, [tier.key]: e.target.value })
                            }
                            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 pr-10 font-display text-lg outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[var(--color-muted)]">
                            ETB
                          </span>
                        </div>
                      </label>
                    ) : (
                      <p className="mt-3 font-display text-2xl tracking-tight">
                        {formatMoney(settings[tier.settingKey])}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div className="mt-3 flex justify-end">
                  <Button type="button" disabled={savingTiers} onClick={saveTiers}>
                    {savingTiers ? 'Saving…' : 'Save deposit tiers'}
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Other policies
              </p>
              <PolicyRow
                icon={<AlertTriangle size={16} className="text-[var(--color-warn)]" />}
                label="Low-rating collateral multiplier"
                hint="Applied when customer rating is below 3"
                value={settings.low_rating_collateral_multiplier}
                onSave={(v) => saveSetting('low_rating_collateral_multiplier', Number(v))}
                disabled={!isAdmin}
              />
              <PolicyRow
                icon={<Clock size={16} className="text-[var(--color-brand)]" />}
                label="Default buffer hours"
                hint="Extra hold time after rental end"
                value={settings.default_buffer_hours}
                onSave={(v) => saveSetting('default_buffer_hours', Number(v))}
                disabled={!isAdmin}
              />
              <PolicyRow
                icon={<Landmark size={16} className="text-[var(--color-accent)]" />}
                label="Default late fee / day (ETB)"
                hint="Charged per overdue day"
                value={settings.default_late_fee_per_day}
                onSave={(v) => saveSetting('default_late_fee_per_day', Number(v))}
                disabled={!isAdmin}
              />
            </section>
          </div>
        </div>

        {/* Users */}
        {isAdmin ? (
          <div className="card-panel overflow-hidden">
            <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 px-4 py-3">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Shield size={18} className="text-[var(--color-brand)]" /> Users
              </h2>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                Create staff accounts and manage roles.
              </p>
            </div>

            <div className="p-4">
              <form
                onSubmit={createUser}
                className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/50 p-3 grid gap-2 sm:grid-cols-2 mb-4"
              >
                <Input
                  label="Full name"
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  required
                  minLength={8}
                />
                <Select
                  label="Role"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="cashier">Agent (cashier)</option>
                </Select>
                <div className="sm:col-span-2">
                  <Button type="submit" className="w-full sm:w-auto">
                    Add user
                  </Button>
                </div>
              </form>

              <p className="text-sm font-medium mb-2">Staff ({users.length})</p>
              <ul className="space-y-2">
                {pagedStaff.map((u) => {
                  const initial = (u.full_name || '?').trim().charAt(0).toUpperCase();
                  return (
                    <li
                      key={u.id}
                      className="flex flex-col gap-3 rounded-xl border border-[var(--color-line)] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold bg-[var(--color-brand)]/12 text-[var(--color-brand)]">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {u.full_name}
                            {u.id === user.id && (
                              <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[var(--color-muted)] truncate">{u.email}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Badge tone="brand">{roleLabel(u.role)}</Badge>
                            <Badge tone="ok">Active</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2 sm:flex-col sm:items-stretch lg:flex-row">
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={() =>
                            setEditing({
                              id: u.id,
                              full_name: u.full_name,
                              role: u.role,
                              is_active: true,
                              password: '',
                            })
                          }
                        >
                          <Pencil size={14} /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="flex-1 text-[var(--color-danger)] hover:bg-red-50"
                          disabled={u.id === user.id}
                          onClick={() => requestTerminate(u)}
                        >
                          <Trash2 size={14} /> Terminate
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {!users.length && <EmptyState message="No active staff accounts" />}
              {users.length > STAFF_PAGE_SIZE && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3">
                  <p className="text-xs text-[var(--color-muted)]">
                    Page {Math.min(staffPage, staffTotalPages)} of {staffTotalPages} ·{' '}
                    {STAFF_PAGE_SIZE} per page
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={staffPage <= 1}
                      onClick={() => setStaffPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={14} /> Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={staffPage >= staffTotalPages}
                      onClick={() =>
                        setStaffPage((p) => Math.min(staffTotalPages, p + 1))
                      }
                    >
                      Next <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card-panel p-5">
            <h2 className="font-display text-xl mb-2 flex items-center gap-2">
              <Shield size={18} /> Users
            </h2>
            <p className="text-sm text-[var(--color-muted)]">
              User management is restricted to <strong>admin</strong>. Managers can view policies
              and audit logs only.
            </p>
          </div>
        )}
      </div>

      <div className="card-panel overflow-hidden">
        <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 px-4 py-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Audit logs</h2>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Active logs kept {auditMeta.retention_days || 90} days · older entries archived
              automatically
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {AUDIT_PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                variant={auditPeriod === p.value ? 'primary' : 'secondary'}
                onClick={() => changeAuditPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {auditPeriod === 'custom' && (
          <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] px-4 py-3 bg-white">
            <Input
              label="From"
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setAuditPage(1);
              }}
            />
            <Input
              label="To"
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setAuditPage(1);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadLogs(1, 'custom')}
              disabled={logsLoading}
            >
              Apply range
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-line)]">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Target</th>
                <th className="p-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="p-3 whitespace-nowrap">
                    {dayjs(log.created_at).format('MMM D HH:mm')}
                  </td>
                  <td className="p-3">{log.user_name || '—'}</td>
                  <td className="p-3 font-mono text-xs">{log.action}</td>
                  <td className="p-3">{log.target_table || '—'}</td>
                  <td className="p-3 text-xs">{log.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs.length && !logsLoading && (
            <EmptyState message="No audit entries for this date range" />
          )}
          {logsLoading && (
            <p className="p-4 text-sm text-[var(--color-muted)]">Loading logs…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3 bg-[var(--color-surface)]/50">
          <p className="text-xs text-[var(--color-muted)]">
            {auditMeta.total
              ? `Showing page ${auditMeta.page || auditPage} of ${auditMeta.total_pages} · ${auditMeta.total} entries`
              : 'No entries'}
            {' · '}
            {AUDIT_PAGE_SIZE} per page
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={logsLoading || auditPage <= 1}
              onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} /> Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                logsLoading || auditPage >= (auditMeta.total_pages || 1)
              }
              onClick={() =>
                setAuditPage((p) => Math.min(auditMeta.total_pages || 1, p + 1))
              }
            >
              Next <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </div>

      {isAdmin && editing && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40">
          <form onSubmit={saveRoleEdit} className="w-full max-w-md card-panel p-5 space-y-3">
            <h3 className="font-display text-xl">Edit user</h3>
            <Input
              label="Full name"
              value={editing.full_name}
              onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
              required
            />
            <Select
              label="Role"
              value={editing.role}
              onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              disabled={editing.id === user.id}
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="cashier">Agent (cashier)</option>
            </Select>
            {editing.id === user.id && (
              <p className="text-xs text-[var(--color-muted)]">You cannot change your own role.</p>
            )}
            <Input
              label="Reset password"
              optional
              type="password"
              value={editing.password}
              onChange={(e) => setEditing({ ...editing, password: e.target.value })}
              minLength={8}
              placeholder="Leave blank to keep current"
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </div>
      )}

      {terminateTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white shadow-2xl">
            <div className="bg-gradient-to-br from-red-700 to-red-900 px-5 py-5 text-white">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15">
                  <AlertTriangle size={22} />
                </span>
                <div>
                  <p className="font-display text-xl leading-tight">Terminate staff access?</p>
                  <p className="text-sm text-white/80 mt-1">
                    This permanently removes the account from RentFlow.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                <p className="font-medium">{terminateTarget.full_name}</p>
                <p className="text-sm text-[var(--color-muted)]">{terminateTarget.email}</p>
                <div className="mt-2">
                  <Badge tone="brand">{roleLabel(terminateTarget.role)}</Badge>
                </div>
              </div>
              <ul className="text-sm text-[var(--color-muted)] space-y-1.5 list-disc pl-5">
                <li>They will not be able to sign in anymore</li>
                <li>They disappear from the staff list completely</li>
                <li>Past payments and audit history stay on record</li>
              </ul>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={terminating}
                  onClick={() => setTerminateTarget(null)}
                >
                  Keep account
                </Button>
                <Button
                  type="button"
                  className="!bg-red-700 hover:!bg-red-800 !border-red-700"
                  disabled={terminating}
                  onClick={confirmTerminate}
                >
                  <Trash2 size={14} />
                  {terminating ? 'Terminating…' : 'Yes, terminate & remove'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyRow({ icon, label, hint, value, onSave, disabled }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-white p-3 sm:flex-row sm:items-center">
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-surface)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{label}</p>
          {hint && <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:w-44">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20 disabled:opacity-70"
        />
        {!disabled && (
          <Button variant="secondary" onClick={() => onSave(v)}>
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
