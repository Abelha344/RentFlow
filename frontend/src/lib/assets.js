/** API origin for production (Vercel → Render). Empty in local Vite (proxy). */
export function apiOrigin() {
  const raw = import.meta.env.VITE_API_URL || '';
  return String(raw).replace(/\/$/, '');
}

/**
 * Turn relative `/uploads/...` paths into absolute URLs when the API is on another host.
 */
export function assetUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  const value = String(pathOrUrl);
  if (/^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('data:')) {
    return value;
  }
  const origin = apiOrigin();
  if (!origin) return value;
  return value.startsWith('/') ? `${origin}${value}` : `${origin}/${value}`;
}
