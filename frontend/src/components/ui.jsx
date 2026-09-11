export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl tracking-tight text-[var(--color-ink)] sm:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 line-clamp-2 text-sm text-[var(--color-muted)] sm:line-clamp-none sm:text-base">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="card-panel p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-2 font-display text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

export function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  const styles = {
    primary: 'bg-[var(--color-brand)] hover:bg-[var(--color-brand-dark)] text-white',
    secondary: 'bg-white border border-[var(--color-line)] hover:bg-[var(--color-surface)] text-[var(--color-ink)]',
    danger: 'bg-[var(--color-danger)] hover:opacity-90 text-white',
    ghost: 'hover:bg-black/5 text-[var(--color-ink)]',
  };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function FieldLabel({ label, required, optional }) {
  if (!label) return null;
  return (
    <span className="mb-1.5 block text-[var(--color-muted)]">
      {label}
      {required && <span className="text-red-600" aria-hidden="true"> *</span>}
      {optional && !required && (
        <span className="font-normal text-[var(--color-muted)]/80"> (optional)</span>
      )}
    </span>
  );
}

export function Input({ label, required, optional, className = '', ...props }) {
  return (
    <label className={`block text-sm ${className}`}>
      <FieldLabel label={label} required={required} optional={optional} />
      <input
        className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
        required={required}
        {...props}
      />
    </label>
  );
}

export function Select({ label, required, optional, children, className = '', ...props }) {
  return (
    <label className={`block text-sm ${className}`}>
      <FieldLabel label={label} required={required} optional={optional} />
      <select
        className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 outline-none focus:border-[var(--color-brand)]"
        required={required}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Textarea({ label, required, optional, className = '', ...props }) {
  return (
    <label className={`block text-sm ${className}`}>
      <FieldLabel label={label} required={required} optional={optional} />
      <textarea
        className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 outline-none focus:border-[var(--color-brand)] min-h-[88px]"
        required={required}
        {...props}
      />
    </label>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    ok: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-800',
    brand: 'bg-teal-50 text-teal-800',
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ message }) {
  return <p className="text-sm text-[var(--color-muted)] py-8 text-center">{message}</p>;
}

export function formatMoney(n) {
  return `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

export const STATUS_TONE = {
  draft: 'neutral',
  confirmed: 'brand',
  out_for_rent: 'ok',
  returned: 'neutral',
  overdue: 'danger',
  cancelled: 'warn',
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
};
