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
//   AUTH_MODE=swa
//     Azure Static Web Apps with this app registered as a linked backend. SWA
//     authenticates the user at the edge and forwards the SWA client principal
//     (`{identityProvider, userId, userDetails, userRoles}`) as a base64
//     X-MS-CLIENT-PRINCIPAL header. Linking also configures an App Service
//     identity provider ("Azure Static Web Apps (Linked)") that rejects any
//     request not proxied through the static web app, so the header cannot be
//     forged by an internet caller. Because the platform in front may present
//     EITHER principal shape, this mode accepts a valid SWA principal or a
//     valid Easy Auth principal and rejects anything else.
//     Never inferred — it must be set explicitly.
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
const AUTH_MODE_SWA             = 'swa';
const AUTH_MODE_NONE_LOOPBACK   = 'none-loopback-only';
const VALID_AUTH_MODES = new Set([
  AUTH_MODE_EASYAUTH, AUTH_MODE_REVERSE_PROXY, AUTH_MODE_SWA,
  AUTH_MODE_NONE_LOOPBACK,
]);

const AUTH_EXEMPT_API_ROUTES = new Set([
  '/api/ai-status',      // read-only config check
  '/api/auth-check',     // read-only config check
  '/api/m365updates',    // public RSS proxy
  '/api/azureupdates',   // public RSS proxy
  '/api/fabricroadmap',  // public feed proxy
  '/api/featuregeo',     // public release-plans feed
  '/api/proxy',          // public Release Planner proxy (alias of /proxy)
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

function redactUpstreamError(error) {
  let raw = '';
  if (typeof error === 'string') {
    raw = error;
  } else if (error && typeof error.message === 'string') {
    raw = error.message;
  } else if (error) {
    raw = JSON.stringify(error);
  }
  return String(raw || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<redacted-guid>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<redacted-email>');
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
      env.WEBSITE_AUTH_ENABLED !== 'True') {
    warnings.push(
      'AUTH_MODE=easyauth but WEBSITE_AUTH_ENABLED="' +
      (env.WEBSITE_AUTH_ENABLED || '<unset>') +
      '" (expected "True"). Protected API requests will be rejected because ' +
      'App Service is not enforcing Easy Auth.'
    );
  }
  if (mode === AUTH_MODE_SWA && isAppService &&
      env.WEBSITE_AUTH_ENABLED !== 'True') {
    warnings.push(
      'AUTH_MODE=swa but WEBSITE_AUTH_ENABLED="' +
      (env.WEBSITE_AUTH_ENABLED || '<unset>') +
      '" (expected "True"). Linking this App Service as a Static Web Apps ' +
      'backend adds the "Azure Static Web Apps (Linked)" identity provider — ' +
      'until that exists, the app is reachable directly and the forwarded ' +
      'client principal header is spoofable.'
    );
  }
  if (mode === AUTH_MODE_SWA && !isAppService) {
    warnings.push(
      'AUTH_MODE=swa but WEBSITE_INSTANCE_ID is not set. Only run this ' +
      'configuration when the host is a Static Web Apps linked backend that ' +
      'rejects traffic which is not proxied through the static web app.'
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

// Validate a Static Web Apps client principal header. SWA forwards a different
// shape than App Service Easy Auth: a base64 JSON object with identityProvider,
// userId, userDetails and userRoles (the claims array is omitted for backends).
// Returns { ok: true, principal } or { ok: false, reason }.
function validateSwaPrincipal(principalHeader) {
  if (typeof principalHeader !== 'string' || !principalHeader) {
    return { ok: false, reason: 'missing-principal-header' };
  }
  let decoded;
  try {
    decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
  } catch {
    return { ok: false, reason: 'principal-not-base64' };
  }
  if (!decoded || decoded[0] !== '{') {
    return { ok: false, reason: 'principal-not-json' };
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { ok: false, reason: 'principal-json-parse-failed' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'principal-not-object' };
  }
  const identityProvider = typeof parsed.identityProvider === 'string' ? parsed.identityProvider : '';
  const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
  if (!identityProvider) return { ok: false, reason: 'principal-missing-identity-provider' };
  if (!userId) return { ok: false, reason: 'principal-missing-user-id' };
  const roles = Array.isArray(parsed.userRoles)
    ? parsed.userRoles.filter(r => typeof r === 'string')
    : [];
  // "anonymous" alone means SWA let an unauthenticated request through. Require
  // a genuinely signed-in caller.
  if (!roles.includes('authenticated')) {
    return { ok: false, reason: 'principal-not-authenticated' };
  }
  return {
    ok: true,
    principal: {
      identityProvider,
      userId,
      userDetails: typeof parsed.userDetails === 'string' ? parsed.userDetails : '',
      userRoles: roles,
      raw: parsed,
    },
  };
}

// Build a requireAuth function bound to the resolved mode and the API token.
// `sendJson` is injected so this module can reuse the caller's response helper
// without duplicating the header-writing / CSP logic.
function makeRequireAuth({
  mode,
  apiAuthToken,
  sendJson,
  isAppService = false,
  easyAuthEnabled = false,
}) {
  if (!VALID_AUTH_MODES.has(mode)) {
    throw new Error('makeRequireAuth: unknown mode "' + mode + '"');
  }
  return function requireAuth(req, res, pathname) {
    if (!pathname.startsWith('/api/')) return true;
    if (AUTH_EXEMPT_API_ROUTES.has(pathname)) return true;

    if (mode === AUTH_MODE_EASYAUTH) {
      if (isAppService && !easyAuthEnabled) {
        sendJson(req, res, 401, {
          error: 'Easy Auth is not enforced by App Service; refusing to trust client principal headers.',
          code: 'AUTH_NOT_ENFORCED',
        });
        return false;
      }
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

    if (mode === AUTH_MODE_SWA) {
      const principal = req.headers['x-ms-client-principal'];
      const swaCheck = validateSwaPrincipal(principal);
      if (swaCheck.ok) {
        req.principal = swaCheck.principal;
        return true;
      }
      // The linked-backend platform may replace the SWA principal with an App
      // Service Easy Auth principal. Accept that shape too rather than fail
      // closed on a request the platform already authenticated.
      const easyAuthCheck = validatePrincipal(
        principal, req.headers['x-ms-client-principal-id']
      );
      if (easyAuthCheck.ok) {
        req.principal = easyAuthCheck.principal;
        return true;
      }
      sendJson(req, res, 401, {
        error: 'Authentication required. This endpoint is protected by Azure Static Web Apps authentication.',
        code: swaCheck.reason === 'missing-principal-header'
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
  AUTH_MODE_SWA,
  AUTH_MODE_NONE_LOOPBACK,
  VALID_AUTH_MODES,
  AUTH_EXEMPT_API_ROUTES,
  timingSafeEqualStr,
  redactUpstreamError,
  resolveAuthMode,
  validatePrincipal,
  validateSwaPrincipal,
  makeRequireAuth,
};
