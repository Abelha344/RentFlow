import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Restrict nested routes to the listed roles.
 * Cashiers/agents are blocked from admin/manager-only pages.
 */
export default function RoleRoute({ roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-[var(--color-muted)]">
        Checking access…
      </div>
    );
  }

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
