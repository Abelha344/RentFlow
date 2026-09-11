import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@rentflow.local');
  const [password, setPassword] = useState('Admin123!');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page min-h-full lg:grid lg:grid-cols-2">
      <aside className="login-hero relative hidden min-h-full overflow-hidden lg:flex">
        <div className="login-hero-base absolute inset-0" />
        <div className="login-hero-flow absolute inset-0" />
        <div className="login-hero-geometry absolute inset-0" />
        <div className="login-hero-grain absolute inset-0" />

        <div className="relative z-10 flex h-full w-full flex-col justify-center px-12 xl:px-16">
          <div className="login-rise max-w-lg">
            <p className="login-serif text-[clamp(3.75rem,7vw,5.75rem)] font-semibold leading-[0.9] tracking-[-0.02em] text-white">
              RentFlow
            </p>
            <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-white/80">
              Stock, bookings, returns, and receipts — one calm workspace for every event.
            </p>
          </div>
        </div>
      </aside>

      <section className="login-panel relative flex min-h-full items-center justify-center px-5 py-12 sm:px-8">
        <div className="login-form-shell login-rise relative z-10 w-full max-w-[27rem]">
          <div className="mb-8 lg:hidden">
            <p className="login-serif text-[2.75rem] font-semibold leading-none tracking-tight text-[var(--color-ink)]">
              RentFlow
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <header className="space-y-2">
              <h1 className="login-serif text-[2.35rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
                Welcome back
              </h1>
              <p className="text-[0.9375rem] text-[#6b7c78]">
                Sign in with your staff account to continue.
              </p>
            </header>

            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block text-[13px] font-medium text-[#6b7c78]">Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="login-input"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block text-[13px] font-medium text-[#6b7c78]">Password</span>
                <span className="relative block">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="login-input login-input-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#8a9a96] transition hover:bg-[#f3f6f4] hover:text-[var(--color-ink)]"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </label>
            </div>

            {error && (
              <p className="rounded-xl border border-red-200/80 bg-red-50 px-3.5 py-2.5 text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="login-demo space-y-1.5 pt-1 text-center text-[12px] leading-relaxed text-[#8a9a96]">
              <p>Demo password · Admin123!</p>
              <p>
                <button
                  type="button"
                  className="transition hover:text-[var(--color-brand)]"
                  onClick={() => {
                    setEmail('admin@rentflow.local');
                    setPassword('Admin123!');
                  }}
                >
                  Admin
                </button>
                <span className="mx-1.5 text-[#c5d0cd]">·</span>
                <button
                  type="button"
                  className="transition hover:text-[var(--color-brand)]"
                  onClick={() => {
                    setEmail('manager@rentflow.local');
                    setPassword('Admin123!');
                  }}
                >
                  Manager
                </button>
                <span className="mx-1.5 text-[#c5d0cd]">·</span>
                <button
                  type="button"
                  className="transition hover:text-[var(--color-brand)]"
                  onClick={() => {
                    setEmail('cashier@rentflow.local');
                    setPassword('Admin123!');
                  }}
                >
                  Agent
                </button>
              </p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
