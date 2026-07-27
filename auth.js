// Microsoft Communications Portal — API authentication guard.
//
// Every sensitive API route is gated by an explicit AUTH_MODE, resolved once at
// startup and used by every request thereafter. Three supported modes:
//
//   AUTH_MODE=easyauth
//     Azure App Service Easy Auth (Entra ID). The X-MS-CLIENT-PRINCIPAL header
//     injected by the platform is base64-decoded, JSON-parsed, and cross-checked
//     against X-MS-CLIENT-PRINCIPAL-ID. Presence alone is NOT sufficient — the
//     payload must be a well-formed AAD principal with a matching oid claim.
//
//   AUTH_MODE=reverse-proxy
//     The app sits behind an authenticating reverse proxy on a trusted network.
//     Every /api/* request must additionally present a valid
//     `Authorization: Bearer <token>` matching API_AUTH_TOKEN (defense in depth
//     between the proxy and the app). API_AUTH_TOKEN must be set.
//
//   AUTH_MODE=none-loopback-only
//     No auth. Only allowed when HOST is 127.0.0.1 or ::1 — this is the
//     zero-config local-dev mode.
//
// If AUTH_MODE is unset it is inferred (App Service → easyauth; loopback →
// none-loopback-only; anything else → refuse to start and demand an explicit
// choice). This prevents accidental fail-open when someone flips HOST to
// 0.0.0.0 without thinking about auth.

const crypto = require('crypto');

const AUTH_MODE_EASYAUTH        = 'easyauth';
const AUTH_MODE_REVERSE_PROXY   = 'reverse-proxy';
const AUTH_MODE_NONE_LOOPBACK   = 'none-loopback-only';
const VALID_AUTH_MODES = new Set([
  AUTH_MODE_EASYAUTH, AUTH_MODE_REVERSE_PROXY, AUTH_MODE_NONE_LOOPBACK,
]);

const AUTH_EXEMPT_API_ROUTES = new Set([
  '/api/ai-status',      // read-only config check
  '/api/auth-check',     // read-only config check
  '/api/m365updates',    // public RSS proxy
  '/api/azureupdates',   // public RSS proxy
  '/api/fabricroadmap',  // public feed proxy
  '/api/empty-products', // static data (GET only; DELETE still requires ADMIN_TOKEN)
]);

// Constant-time string comparison to avoid leaking token contents via timing.
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ab.length !== bb.length) {
    // Keep the comparison time independent of where the mismatch is.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Resolve and validate AUTH_MODE against the current environment.
// Returns { mode, warnings } on success; throws Error on any inconsistency so
// the process can exit with a clear message.
function resolveAuthMode(env) {
  env = env || process.env;
  const raw = (env.AUTH_MODE || '').trim().toLowerCase();
  const host = env.HOST || '127.0.0.1';
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const isAppService = !!env.WEBSITE_INSTANCE_ID;
  const hasToken = !!env.API_AUTH_TOKEN;
  const warnings = [];

  let mode = raw;
  if (!mode) {
    if (isAppService) {
      mode = AUTH_MODE_EASYAUTH;
    } else if (isLoopback) {
      mode = AUTH_MODE_NONE_LOOPBACK;
    } else {
      throw new Error(
        'AUTH_MODE is not set and cannot be inferred safely. HOST="' + host +
        '" is not loopback and WEBSITE_INSTANCE_ID is not present. Set ' +
        'AUTH_MODE explicitly to one of: easyauth, reverse-proxy, none-loopback-only.'
      );
    }
  }

  if (!VALID_AUTH_MODES.has(mode)) {
    throw new Error(
      'AUTH_MODE="' + raw + '" is not a recognized value. Allowed: ' +
      Array.from(VALID_AUTH_MODES).join(', ') + '.'
    );
  }

  if (mode === AUTH_MODE_NONE_LOOPBACK && !isLoopback) {
    throw new Error(
      'AUTH_MODE=none-loopback-only requires HOST to be a loopback address ' +
      '(127.0.0.1 or ::1). Current HOST="' + host + '". Refuse to start — the ' +
      'sensitive /api/* routes would be reachable unauthenticated.'
    );
  }
  if (mode === AUTH_MODE_REVERSE_PROXY && !hasToken) {
    throw new Error(
      'AUTH_MODE=reverse-proxy requires API_AUTH_TOKEN to be set (defense in ' +
      'depth between the proxy and the app). Refuse to start.'
    );
  }
  if (mode === AUTH_MODE_EASYAUTH && !isAppService) {
    warnings.push(
      'AUTH_MODE=easyauth but WEBSITE_INSTANCE_ID is not set. Only run this ' +
      'configuration when an Azure App Service Easy Auth-compatible ' +
      'authenticating proxy is guaranteed to be in front of the app.'
    );
  }
  if (mode === AUTH_MODE_EASYAUTH && isAppService &&
      env.WEBSITE_AUTH_ENABLED && env.WEBSITE_AUTH_ENABLED !== 'True') {
    warnings.push(
      'AUTH_MODE=easyauth but WEBSITE_AUTH_ENABLED="' + env.WEBSITE_AUTH_ENABLED +
      '" (expected "True"). Easy Auth may be disabled on this App Service — ' +
      'requests with a spoofed X-MS-CLIENT-PRINCIPAL header could bypass ' +
      'authentication if the platform is not injecting/validating the header.'
    );
  }

  return { mode, warnings };
}

// Validate an Easy Auth principal header. Returns { ok: true, principal } on
// success, { ok: false, reason } on any failure (malformed base64/JSON, wrong
// auth_typ, missing oid/tid, or oid mismatch with X-MS-CLIENT-PRINCIPAL-ID).
function validatePrincipal(principalHeader, principalIdHeader) {
  if (typeof principalHeader !== 'string' || !principalHeader) {
    return { ok: false, reason: 'missing-principal-header' };
  }
  let decoded;
  try {
    decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
  } catch (_) {
    return { ok: false, reason: 'principal-not-base64' };
  }
  if (!decoded || decoded[0] !== '{') {
    return { ok: false, reason: 'principal-not-json' };
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch (_) {
    return { ok: false, reason: 'principal-json-parse-failed' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'principal-not-object' };
  }
  if (parsed.auth_typ !== 'aad') {
    return { ok: false, reason: 'principal-wrong-auth-typ' };
  }
  if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) {
    return { ok: false, reason: 'principal-empty-claims' };
  }
  const OID_URIS = new Set([
    'http://schemas.microsoft.com/identity/claims/objectidentifier',
    'oid',
  ]);
  const TID_URIS = new Set([
    'http://schemas.microsoft.com/identity/claims/tenantid',
    'tid',
  ]);
  let oid = '';
  let tid = '';
  for (const c of parsed.claims) {
    if (!c || typeof c !== 'object') continue;
    if (OID_URIS.has(c.typ) && !oid) oid = String(c.val || '');
    if (TID_URIS.has(c.typ) && !tid) tid = String(c.val || '');
  }
  if (!oid) return { ok: false, reason: 'principal-missing-oid' };
  if (!tid) return { ok: false, reason: 'principal-missing-tid' };
  if (typeof principalIdHeader === 'string' && principalIdHeader) {
    if (!timingSafeEqualStr(oid, principalIdHeader)) {
      return { ok: false, reason: 'principal-oid-mismatch' };
    }
  } else {
    // Missing principal-id header is itself suspicious — a real Easy Auth
    // request always carries it. Reject.
    return { ok: false, reason: 'principal-id-header-missing' };
  }
  return { ok: true, principal: { oid, tid, raw: parsed } };
}

// Build a requireAuth function bound to the resolved mode and the API token.
// `sendJson` is injected so this module can reuse the caller's response helper
// without duplicating the header-writing / CSP logic.
function makeRequireAuth({ mode, apiAuthToken, sendJson }) {
  if (!VALID_AUTH_MODES.has(mode)) {
    throw new Error('makeRequireAuth: unknown mode "' + mode + '"');
  }
  return function requireAuth(req, res, pathname) {
    if (!pathname.startsWith('/api/')) return true;
    if (AUTH_EXEMPT_API_ROUTES.has(pathname)) return true;

    if (mode === AUTH_MODE_EASYAUTH) {
      const principal = req.headers['x-ms-client-principal'];
      const principalId = req.headers['x-ms-client-principal-id'];
      const check = validatePrincipal(principal, principalId);
      if (check.ok) {
        req.principal = check.principal;
        return true;
      }
      sendJson(req, res, 401, {
        error: 'Authentication required. This endpoint is protected by Entra ID Easy Auth.',
        code: check.reason === 'missing-principal-header'
          ? 'AUTH_REQUIRED' : 'AUTH_INVALID_PRINCIPAL',
      });
      return false;
    }

    if (mode === AUTH_MODE_REVERSE_PROXY) {
      const auth = req.headers['authorization'] || '';
      const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (supplied && timingSafeEqualStr(supplied, apiAuthToken)) return true;
      sendJson(req, res, 401, {
        error: 'Authentication required. Supply a valid Authorization: Bearer <token> header.',
        code: 'AUTH_REQUIRED',
      });
      return false;
    }

    // AUTH_MODE_NONE_LOOPBACK — startup guaranteed HOST is loopback, so any
    // request that made it here was accepted on the loopback interface.
    return true;
  };
}

module.exports = {
  AUTH_MODE_EASYAUTH,
  AUTH_MODE_REVERSE_PROXY,
  AUTH_MODE_NONE_LOOPBACK,
  VALID_AUTH_MODES,
  AUTH_EXEMPT_API_ROUTES,
  timingSafeEqualStr,
  resolveAuthMode,
  validatePrincipal,
  makeRequireAuth,
};
