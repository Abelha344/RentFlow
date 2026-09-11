/**
 * Cookie options for JWT `access_token`.
 * Cross-site (Vercel frontend + Render API) requires SameSite=None; Secure.
 */
function authCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const crossSite =
    String(process.env.COOKIE_SAMESITE || '').toLowerCase() === 'none' ||
    (isProd && Boolean(process.env.CLIENT_URL) && !/localhost|127\.0\.0\.1/i.test(process.env.CLIENT_URL));

  return {
    httpOnly: true,
    secure: isProd || crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  };
}

module.exports = { authCookieOptions };
