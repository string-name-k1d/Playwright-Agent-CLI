/**
 * Heuristics for detecting when a browser session has been redirected to an
 * authentication / SSO / login page instead of the requested site page.
 *
 * This guards the explore → plan → generate pipeline: an unauthenticated
 * profile that lands on the IdP login page would otherwise produce a snapshot
 * of the login page, and plan/generate would emit tests for elements that only
 * exist there.
 */

/**
 * True when `url` looks like a login, SSO, or identity-provider page.
 */
export function looksLikeLoginPage(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('shib.ust.hk') || u.includes('shibboleth')) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'login.microsoftonline.com' ||
      host.endsWith('.microsoftonline.com') ||
      /(login|sso|idp|auth|cas|okta|duo)\./i.test(host)
    ) {
      return true;
    }
    return /\/user\/login|\/login|\/cas\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * True when the browser ended up on a login/SSO page that is not the page the
 * caller asked for — i.e. an unauthenticated redirect. Exploring a login URL
 * explicitly is allowed and returns false.
 */
export function isRedirectedToLogin(requestedUrl: string, landedUrl: string): boolean {
  if (!landedUrl || !requestedUrl) return false;
  if (!looksLikeLoginPage(landedUrl)) return false;
  if (looksLikeLoginPage(requestedUrl)) return false;
  try {
    const a = new URL(requestedUrl);
    const b = new URL(landedUrl);
    return a.hostname !== b.hostname || a.pathname !== b.pathname;
  } catch {
    return true;
  }
}
