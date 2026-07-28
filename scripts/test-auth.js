// Unit tests for the auth module. Uses Node's built-in node:test runner —
// no dependencies required.
//
//   node scripts/test-auth.js
//
// Also invocable via `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTH_MODE_EASYAUTH,
  AUTH_MODE_REVERSE_PROXY,
  AUTH_MODE_NONE_LOOPBACK,
  resolveAuthMode,
  validatePrincipal,
  makeRequireAuth,
} = require('../auth.js');

// ── resolveAuthMode ──────────────────────────────────────────────────────────

test('resolveAuthMode infers easyauth on App Service', () => {
  const r = resolveAuthMode({ WEBSITE_INSTANCE_ID: 'abc123' });
  assert.equal(r.mode, AUTH_MODE_EASYAUTH);
});

test('resolveAuthMode infers none-loopback-only for default HOST', () => {
  const r = resolveAuthMode({});
  assert.equal(r.mode, AUTH_MODE_NONE_LOOPBACK);
});

test('resolveAuthMode infers none-loopback-only for explicit loopback', () => {
  const r = resolveAuthMode({ HOST: '::1' });
  assert.equal(r.mode, AUTH_MODE_NONE_LOOPBACK);
});

test('resolveAuthMode throws when HOST is non-loopback and mode is unset', () => {
  assert.throws(
    () => resolveAuthMode({ HOST: '0.0.0.0' }),
    /AUTH_MODE is not set and cannot be inferred safely/
  );
});

test('resolveAuthMode throws on unknown value', () => {
  assert.throws(
    () => resolveAuthMode({ AUTH_MODE: 'wide-open' }),
    /not a recognized value/
  );
});

test('resolveAuthMode throws for none-loopback-only with non-loopback HOST', () => {
  assert.throws(
    () => resolveAuthMode({ AUTH_MODE: 'none-loopback-only', HOST: '10.0.0.5' }),
    /requires HOST to be a loopback address/
  );
});

test('resolveAuthMode throws for reverse-proxy without API_AUTH_TOKEN', () => {
  assert.throws(
    () => resolveAuthMode({ AUTH_MODE: 'reverse-proxy', HOST: '0.0.0.0' }),
    /requires API_AUTH_TOKEN to be set/
  );
});

test('resolveAuthMode accepts reverse-proxy with API_AUTH_TOKEN', () => {
  const r = resolveAuthMode({
    AUTH_MODE: 'reverse-proxy', HOST: '0.0.0.0', API_AUTH_TOKEN: 'x'.repeat(32),
  });
  assert.equal(r.mode, AUTH_MODE_REVERSE_PROXY);
});

test('resolveAuthMode warns when easyauth is used outside App Service', () => {
  const r = resolveAuthMode({ AUTH_MODE: 'easyauth', HOST: '0.0.0.0' });
  assert.equal(r.mode, AUTH_MODE_EASYAUTH);
  assert.ok(r.warnings.some(w => /WEBSITE_INSTANCE_ID is not set/.test(w)));
});

test('resolveAuthMode warns when WEBSITE_AUTH_ENABLED is not True', () => {
  const r = resolveAuthMode({
    AUTH_MODE: 'easyauth',
    WEBSITE_INSTANCE_ID: 'abc',
    WEBSITE_AUTH_ENABLED: 'False',
  });
  assert.ok(r.warnings.some(w => /WEBSITE_AUTH_ENABLED/.test(w)));
});

test('resolveAuthMode is case-insensitive for AUTH_MODE', () => {
  const r = resolveAuthMode({ AUTH_MODE: '  EasyAuth  ', WEBSITE_INSTANCE_ID: '1' });
  assert.equal(r.mode, AUTH_MODE_EASYAUTH);
});

// ── validatePrincipal ────────────────────────────────────────────────────────

function makePrincipal(overrides) {
  const defaults = {
    auth_typ: 'aad',
    name_typ: 'name',
    role_typ: 'role',
    claims: [
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'aaa-oid' },
      { typ: 'http://schemas.microsoft.com/identity/claims/tenantid', val: 'bbb-tid' },
      { typ: 'name', val: 'Test User' },
    ],
  };
  return Object.assign(defaults, overrides || {});
}

function encode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

test('validatePrincipal accepts a well-formed AAD principal', () => {
  const p = encode(makePrincipal());
  const r = validatePrincipal(p, 'aaa-oid');
  assert.equal(r.ok, true);
  assert.equal(r.principal.oid, 'aaa-oid');
  assert.equal(r.principal.tid, 'bbb-tid');
});

test('validatePrincipal rejects missing header', () => {
  const r = validatePrincipal(undefined, 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-principal-header');
});

test('validatePrincipal rejects empty string', () => {
  const r = validatePrincipal('', 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-principal-header');
});

test('validatePrincipal rejects non-JSON payload', () => {
  // base64 of plain text "hello world"
  const r = validatePrincipal(Buffer.from('hello world').toString('base64'), 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-not-json');
});

test('validatePrincipal rejects malformed JSON', () => {
  const r = validatePrincipal(Buffer.from('{not json').toString('base64'), 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-json-parse-failed');
});

test('validatePrincipal rejects wrong auth_typ', () => {
  const p = encode(makePrincipal({ auth_typ: 'facebook' }));
  const r = validatePrincipal(p, 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-wrong-auth-typ');
});

test('validatePrincipal rejects empty claims array', () => {
  const p = encode(makePrincipal({ claims: [] }));
  const r = validatePrincipal(p, 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-empty-claims');
});

test('validatePrincipal rejects principal without oid', () => {
  const p = encode(makePrincipal({
    claims: [
      { typ: 'http://schemas.microsoft.com/identity/claims/tenantid', val: 'bbb-tid' },
    ],
  }));
  const r = validatePrincipal(p, 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-missing-oid');
});

test('validatePrincipal rejects principal without tid', () => {
  const p = encode(makePrincipal({
    claims: [
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'aaa-oid' },
    ],
  }));
  const r = validatePrincipal(p, 'aaa-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-missing-tid');
});

test('validatePrincipal rejects mismatched principal-id header', () => {
  const p = encode(makePrincipal());
  const r = validatePrincipal(p, 'wrong-oid');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-oid-mismatch');
});

test('validatePrincipal rejects missing principal-id header (spoof-style)', () => {
  const p = encode(makePrincipal());
  const r = validatePrincipal(p, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'principal-id-header-missing');
});

test('validatePrincipal rejects the classic "just send any value" spoof', () => {
  // The pre-fix code accepted any non-empty header value. Confirm we reject it.
  const r = validatePrincipal('x', 'anything');
  assert.equal(r.ok, false);
});

test('validatePrincipal accepts short-form oid/tid claim types', () => {
  const p = encode({
    auth_typ: 'aad',
    claims: [
      { typ: 'oid', val: 'short-oid' },
      { typ: 'tid', val: 'short-tid' },
    ],
  });
  const r = validatePrincipal(p, 'short-oid');
  assert.equal(r.ok, true);
});

// ── requireAuth (integration) ────────────────────────────────────────────────

function fakeReq(headers) {
  return { headers: headers || {} };
}
function fakeRes() {
  const res = { _status: null, _payload: null };
  return res;
}
function fakeSendJson(req, res, status, payload) {
  res._status = status;
  res._payload = payload;
}

test('requireAuth allows non-API paths regardless of mode', () => {
  const guard = makeRequireAuth({
    mode: AUTH_MODE_REVERSE_PROXY, apiAuthToken: 'x', sendJson: fakeSendJson,
  });
  assert.equal(guard(fakeReq(), fakeRes(), '/home'), true);
  assert.equal(guard(fakeReq(), fakeRes(), '/static/app.js'), true);
});

test('requireAuth allows exempt API routes without auth', () => {
  const guard = makeRequireAuth({
    mode: AUTH_MODE_REVERSE_PROXY, apiAuthToken: 'x', sendJson: fakeSendJson,
  });
  assert.equal(guard(fakeReq(), fakeRes(), '/api/ai-status'), true);
  assert.equal(guard(fakeReq(), fakeRes(), '/api/m365updates'), true);
});

test('requireAuth (none-loopback-only) allows sensitive routes without auth', () => {
  const guard = makeRequireAuth({
    mode: AUTH_MODE_NONE_LOOPBACK, apiAuthToken: '', sendJson: fakeSendJson,
  });
  assert.equal(guard(fakeReq(), fakeRes(), '/api/messagecenter'), true);
});

test('requireAuth (reverse-proxy) rejects missing bearer', () => {
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_REVERSE_PROXY, apiAuthToken: 'secret', sendJson: fakeSendJson,
  });
  assert.equal(guard(fakeReq(), res, '/api/messagecenter'), false);
  assert.equal(res._status, 401);
  assert.equal(res._payload.code, 'AUTH_REQUIRED');
});

test('requireAuth (reverse-proxy) rejects wrong bearer', () => {
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_REVERSE_PROXY, apiAuthToken: 'secret', sendJson: fakeSendJson,
  });
  const req = fakeReq({ authorization: 'Bearer wrong' });
  assert.equal(guard(req, res, '/api/messagecenter'), false);
  assert.equal(res._status, 401);
});

test('requireAuth (reverse-proxy) accepts correct bearer', () => {
  const guard = makeRequireAuth({
    mode: AUTH_MODE_REVERSE_PROXY, apiAuthToken: 'secret', sendJson: fakeSendJson,
  });
  const req = fakeReq({ authorization: 'Bearer secret' });
  assert.equal(guard(req, fakeRes(), '/api/messagecenter'), true);
});

test('requireAuth (easyauth) rejects requests with no principal header', () => {
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH, apiAuthToken: '', sendJson: fakeSendJson,
  });
  assert.equal(guard(fakeReq(), res, '/api/messagecenter'), false);
  assert.equal(res._status, 401);
  assert.equal(res._payload.code, 'AUTH_REQUIRED');
});

test('requireAuth (easyauth) rejects header-only spoof attempts', () => {
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH, apiAuthToken: '', sendJson: fakeSendJson,
  });
  const req = fakeReq({ 'x-ms-client-principal': 'x' });
  assert.equal(guard(req, res, '/api/messagecenter'), false);
  assert.equal(res._status, 401);
  assert.equal(res._payload.code, 'AUTH_INVALID_PRINCIPAL');
});

test('requireAuth (easyauth) accepts a valid principal and attaches req.principal', () => {
  const p = encode(makePrincipal());
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH, apiAuthToken: '', sendJson: fakeSendJson,
  });
  const req = fakeReq({
    'x-ms-client-principal': p,
    'x-ms-client-principal-id': 'aaa-oid',
  });
  assert.equal(guard(req, fakeRes(), '/api/messagecenter'), true);
  assert.equal(req.principal.oid, 'aaa-oid');
  assert.equal(req.principal.tid, 'bbb-tid');
});

test('requireAuth (easyauth) rejects when principal-id header disagrees with oid claim', () => {
  const p = encode(makePrincipal());
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH, apiAuthToken: '', sendJson: fakeSendJson,
  });
  const req = fakeReq({
    'x-ms-client-principal': p,
    'x-ms-client-principal-id': 'attacker-oid',
  });
  assert.equal(guard(req, res, '/api/messagecenter'), false);
  assert.equal(res._payload.code, 'AUTH_INVALID_PRINCIPAL');
});
