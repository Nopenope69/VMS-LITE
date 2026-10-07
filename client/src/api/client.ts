/**
 * The browser's one way to call the VMS API.
 *
 * Behaves like fetch (callers get the Response), plus:
 * - adds the session token to API requests that do not set Authorization themselves;
 * - reports every 401 to the auth layer, which logs out only if the rejected token is
 *   still the current one (a request racing a password change must not end the new
 *   session).
 */

type UnauthorizedHandler = (failedToken: string | null) => void;

let currentToken: () => string | null = () => {
  try {
    return localStorage.getItem('vms_token');
  } catch {
    return null;
  }
};
let onUnauthorized: UnauthorizedHandler = () => {};

/** Called by AuthProvider so requests use its token and 401s reach it. */
export function configureApi(opts: { getToken: () => string | null; onUnauthorized: UnauthorizedHandler }): void {
  currentToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

function isApiUrl(url: string): boolean {
  if (url.startsWith('/')) return url.startsWith('/api/');
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let token: string | null = null;
  if (isApiUrl(input)) {
    if (headers.has('Authorization')) {
      token = headers.get('Authorization')!.replace(/^Bearer\s+/i, '');
    } else {
      token = currentToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && token) onUnauthorized(token);
  return res;
}
