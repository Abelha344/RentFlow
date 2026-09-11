import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Users,
  CalendarDays,
  ClipboardCheck,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../lib/socket';
import { roleLabel, SECTION_ROLES } from '../lib/roles';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'dashboard' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, section: 'inventory' },
  { to: '/customers', label: 'Customers', icon: Users, section: 'customers' },
  { to: '/bookings', label: 'Schedule & Bookings', icon: CalendarDays, section: 'bookings' },
  { to: '/returns', label: 'Return Equipment', icon: ClipboardCheck, section: 'returns' },
  { to: '/payments', label: 'Payments & Receipts', icon: Wallet, section: 'payments' },
  { to: '/reports', label: 'Reports & Analytics', icon: BarChart3, section: 'reports' },
  { to: '/settings', label: 'Settings & Audit', icon: Settings, section: 'settings' },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);

  const visibleNav = NAV.filter((item) =>
    (SECTION_ROLES[item.section] || []).includes(user?.role)
  );

  useEffect(() => {
    const s = getSocket();
    const push = (msg) =>
      setAlerts((prev) => [{ id: Date.now(), msg, at: new Date() }, ...prev].slice(0, 8));

    const onLow = (p) => push(`Low stock: ${p.name || p.item?.name || 'item'}`);
    const onPay = () => push('New payment proof uploaded');
    const onOverdue = (p) => push(`Overdue update: ${p.newlyOverdue?.length || 0} bookings`);
    const onReceipt = () => push('PDF receipt ready');

    s.on('stock:low', onLow);
    s.on('payment:uploaded', onPay);
    s.on('bookings:overdue', onOverdue);
    s.on('receipt:ready', onReceipt);

    return () => {
      s.off('stock:low', onLow);
      s.off('payment:uploaded', onPay);
      s.off('bookings:overdue', onOverdue);
      s.off('receipt:ready', onReceipt);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-full flex">
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 transform bg-[#0f1c1a] text-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pt-6 pb-4 border-b border-white/10">
          <p className="font-display text-2xl tracking-tight">RentFlow</p>
          <p className="text-xs text-white/55 mt-1">Event equipment rental</p>
        </div>
        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100%-8rem)]">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive ? 'bg-[#0d6e5f] text-white' : 'text-white/75 hover:bg-white/8 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 inset-x-0 p-4 border-t border-white/10">
          <p className="text-sm font-medium truncate">{user?.full_name}</p>
          <p className="text-xs text-white/50">{roleLabel(user?.role)}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex items-center gap-2 text-sm text-white/70 hover:text-white"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden no-print"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-white/85 backdrop-blur px-4 py-3">
          <button type="button" className="lg:hidden p-2 rounded-lg hover:bg-black/5" onClick={() => setOpen(true)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex-1" />
          <div className="relative group">
            <button type="button" className="relative p-2 rounded-lg hover:bg-black/5">
              <Bell size={18} />
              {alerts.length > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              )}
            </button>
            <div className="invisible group-hover:visible absolute right-0 mt-1 w-72 card-panel shadow-lg p-2 text-sm">
              {alerts.length === 0 ? (
                <p className="p-2 text-[var(--color-muted)]">No live alerts</p>
              ) : (
                alerts.map((a) => (
                  <p key={a.id} className="p-2 border-b border-[var(--color-line)] last:border-0">
                    {a.msg}
                  </p>
                ))
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
