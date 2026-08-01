// Unit tests for the auth module. Uses Node's built-in node:test runner —
// no dependencies required.
//
//   node scripts/test-auth.js
//
// Also invocable via `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  collectPaginated,
  createTtlCache,
  mergeVaryHeaders,
  mergeServiceHealth,
  parseBoundedInteger,
  rateLimitBucketKey,
} = require('../runtime-utils.js');
const {
  AUTH_MODE_EASYAUTH,
  AUTH_MODE_REVERSE_PROXY,
  AUTH_MODE_NONE_LOOPBACK,
  redactUpstreamError,
  resolveAuthMode,
  validatePrincipal,
  makeRequireAuth,
} = require('../auth.js');

function collectPages(fetchPage, firstPath, maxPages, getNextLink) {
  return new Promise((resolve, reject) => {
    collectPaginated(fetchPage, firstPath, maxPages, getNextLink, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function loadClientUtil() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'util.js'), 'utf8');
  const document = {
    activeElement: null,
    readyState: 'complete',
    documentElement: {
      getAttribute: () => 'light',
      setAttribute: () => {},
    },
    addEventListener: () => {},
    getElementById: () => null,
  };
  const storage = new Map();
  const window = {
    location: { href: 'https://portal.example/test', pathname: '/test', search: '' },
    history: { replaceState: () => {} },
  };
  const context = {
    Date,
    DOMParser: class {},
    Intl,
    URL,
    URLSearchParams,
    document,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    window,
  };
  vm.runInNewContext(source, context);
  return window.CPUtil;
}

// ── resolveAuthMode ──────────────────────────────────────────────────────────

test('resolveAuthMode infers easyauth on App Service', () => {
  const r = resolveAuthMode({
    WEBSITE_INSTANCE_ID: 'abc123',
    WEBSITE_AUTH_ENABLED: 'True',
  });
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

test('resolveAuthMode warns when WEBSITE_AUTH_ENABLED is unset on App Service', () => {
  const r = resolveAuthMode({
    AUTH_MODE: 'easyauth',
    WEBSITE_INSTANCE_ID: 'abc',
  });
  assert.ok(r.warnings.some(w => /<unset>/.test(w)));
});

test('resolveAuthMode is case-insensitive for AUTH_MODE', () => {
  const r = resolveAuthMode({
    AUTH_MODE: '  EasyAuth  ',
    WEBSITE_INSTANCE_ID: '1',
    WEBSITE_AUTH_ENABLED: 'True',
  });
  assert.equal(r.mode, AUTH_MODE_EASYAUTH);
});

// ── upstream error redaction ─────────────────────────────────────────────────

test('redactUpstreamError removes GUIDs and email addresses', () => {
  const redacted = redactUpstreamError({
    message: 'Client 11111111-2222-3333-4444-555555555555 owned by admin@example.com was denied.',
  });
  assert.equal(
    redacted,
    'Client <redacted-guid> owned by <redacted-email> was denied.'
  );
});

test('redactUpstreamError serializes message-less error objects safely', () => {
  const redacted = redactUpstreamError({
    code: 'Denied',
    target: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  assert.match(redacted, /"code":"Denied"/);
  assert.doesNotMatch(redacted, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
});

// ── runtime validation helpers ────────────────────────────────────────────────

test('parseBoundedInteger applies defaults and bounds', () => {
  assert.equal(parseBoundedInteger(undefined, 5, 1, 10), 5);
  assert.equal(parseBoundedInteger('not-a-number', 5, 1, 10), 5);
  assert.equal(parseBoundedInteger('9', 5, 1, 10), 9);
  assert.equal(parseBoundedInteger('999', 5, 1, 10), 10);
  assert.equal(parseBoundedInteger('-2', 5, 1, 10), 1);
});

test('rate limit keys isolate fixed endpoint policies without using request paths', () => {
  assert.equal(rateLimitBucketKey('127.0.0.1', 5, 60_000), '127.0.0.1:5:60000');
  assert.notEqual(
    rateLimitBucketKey('127.0.0.1', 5, 60_000),
    rateLimitBucketKey('127.0.0.1', 60, 60_000)
  );
});

test('mergeVaryHeaders preserves encoding and origin cache variants', () => {
  assert.equal(
    mergeVaryHeaders('Accept-Encoding', 'Origin', 'Accept-Encoding, User-Agent'),
    'Accept-Encoding, Origin, User-Agent'
  );
});

test('collectPaginated follows next links and reports complete results', async () => {
  const pages = {
    first: { status: 200, body: { value: [1], next: 'second' } },
    second: { status: 200, body: { value: [2], next: 'third' } },
    third: { status: 200, body: { value: [3] } },
  };
  const result = await collectPages(
    (url, done) => done(null, pages[url]),
    'first',
    5,
    body => body.next
  );
  assert.deepEqual(result.body.value, [1, 2, 3]);
  assert.equal(result.body.pages, 3);
  assert.equal(result.body.truncated, false);
});

test('collectPaginated marks safety-limit truncation explicitly', async () => {
  const result = await collectPages(
    (url, done) => done(null, {
      status: 200,
      body: { value: [url], next: `${url}-next` },
    }),
    'first',
    2,
    body => body.next
  );
  assert.deepEqual(result.body.value, ['first', 'first-next']);
  assert.equal(result.body.pages, 2);
  assert.equal(result.body.truncated, true);
  assert.equal(result.body.nextLink, 'first-next-next');
});

test('collectPaginated preserves partial rows when a later page fails', async () => {
  const result = await collectPages(
    (url, done) => done(null, url === 'first'
      ? { status: 200, body: { value: [1], next: 'second' } }
      : { status: 503, body: { error: { code: 'Unavailable' } } }),
    'first',
    5,
    body => body.next
  );
  assert.equal(result.status, 503);
  assert.deepEqual(result.body.value, [1]);
  assert.deepEqual(result.body.error, { code: 'Unavailable' });
  assert.equal(result.body.partialFailure, true);
  assert.equal(result.body.pages, 2);
});

test('collectPaginated preserves partial rows on a later network failure', async () => {
  const result = await collectPages(
    (url, done) => url === 'first'
      ? done(null, { status: 200, body: { value: [1], next: 'second' } })
      : done(new Error('connection reset')),
    'first',
    5,
    body => body.next
  );
  assert.equal(result.status, 502);
  assert.deepEqual(result.body.value, [1]);
  assert.equal(result.body.error.code, 'UPSTREAM_PAGE_ERROR');
  assert.equal(result.body.partialFailure, true);
  assert.equal(result.body.pages, 2);
});

test('mergeServiceHealth does not mutate cached services and deduplicates issues', () => {
  const cached = [{ service: 'Exchange Online', issues: [{ id: 'EX1' }] }];
  const issues = [
    { id: 'EX1', service: 'Exchange Online' },
    { id: 'EX2', service: 'Exchange Online' },
    { id: 'SP1', service: 'SharePoint Online' },
  ];
  const merged = mergeServiceHealth(cached, issues);
  assert.deepEqual(cached, [{ service: 'Exchange Online', issues: [{ id: 'EX1' }] }]);
  assert.deepEqual(merged[0].issues.map(issue => issue.id), ['EX1', 'EX2']);
  assert.equal(merged[1].service, 'SharePoint Online');
  assert.deepEqual(merged[1].issues.map(issue => issue.id), ['SP1']);
});

test('client date helpers preserve local calendar days across DST boundaries', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const util = loadClientUtil();
    const spring = util.dateInputBounds('2026-03-08', '2026-03-08');
    const fall = util.dateInputBounds('2026-11-01', '2026-11-01');
    assert.equal(spring.toExclusive - spring.from, 23 * 60 * 60 * 1000);
    assert.equal(fall.toExclusive - fall.from, 25 * 60 * 60 * 1000);
    assert.equal(util.formatDateInput(new Date(2026, 2, 8, 23, 30)), '2026-03-08');
    assert.equal(util.releaseMonthCutoff(new Date(2026, 6, 31, 23, 30)), '2025-07');
    assert.equal(util.releaseMonthCutoff(new Date(2026, 0, 1, 0, 30)), '2025-01');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('client date helpers reject malformed dates and safeUrl rejects script schemes', () => {
  const util = loadClientUtil();
  const bounds = util.dateInputBounds('2026-02-30', 'not-a-date');
  assert.equal(bounds.from, -Infinity);
  assert.equal(bounds.toExclusive, Infinity);
  assert.equal(util.safeUrl('javascript:alert(1)'), '#');
  assert.equal(util.safeUrl('https://status.azure.com'), 'https://status.azure.com');
  assert.equal(util.csvCell('=HYPERLINK("https://evil.example")'), '"\'=HYPERLINK(""https://evil.example"")"');
  assert.equal(util.csvCell('Normal "value"'), '"Normal ""value"""');
});

function cacheFetch(store, key, ttlMs, fetcher, options) {
  return new Promise((resolve, reject) => {
    store.fetch(key, ttlMs, fetcher, (err, value, meta) => {
      if (err) reject(err);
      else resolve({ value, meta });
    }, options);
  });
}

test('TTL cache reports misses and hits and honors forced refresh', async () => {
  let now = 1_000;
  let calls = 0;
  const store = createTtlCache({ maxEntries: 5, now: () => now });
  const fetcher = (done) => done(null, { version: ++calls });

  const first = await cacheFetch(store, 'feed', 500, fetcher);
  assert.equal(first.value.version, 1);
  assert.equal(first.meta.status, 'miss');
  assert.equal(first.meta.storedAt, 1_000);

  now = 1_100;
  const hit = await cacheFetch(store, 'feed', 500, fetcher);
  assert.equal(hit.value.version, 1);
  assert.equal(hit.meta.status, 'hit');
  assert.equal(calls, 1);

  now = 1_200;
  const refreshed = await cacheFetch(store, 'feed', 500, fetcher, { force: true });
  assert.equal(refreshed.value.version, 2);
  assert.equal(refreshed.meta.status, 'miss');
  assert.equal(calls, 2);
});

test('TTL cache serves bounded stale data when refresh fails', async () => {
  let now = 1_000;
  const store = createTtlCache({ maxEntries: 5, now: () => now });
  await cacheFetch(store, 'feed', 100, done => done(null, { version: 1 }));

  now = 1_150;
  const stale = await cacheFetch(
    store,
    'feed',
    100,
    done => done(new Error('upstream unavailable')),
    { staleIfErrorMs: 500 }
  );
  assert.equal(stale.value.version, 1);
  assert.equal(stale.meta.status, 'stale');

  now = 1_700;
  await assert.rejects(
    cacheFetch(
      store,
      'feed',
      100,
      done => done(new Error('upstream unavailable')),
      { staleIfErrorMs: 500 }
    ),
    /upstream unavailable/
  );
});

test('TTL cache coalesces concurrent upstream requests', async () => {
  const store = createTtlCache({ maxEntries: 5 });
  let release;
  let calls = 0;
  const fetcher = (done) => {
    calls++;
    release = () => done(null, { ok: true });
  };
  const first = cacheFetch(store, 'feed', 500, fetcher);
  const second = cacheFetch(store, 'feed', 500, fetcher);
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.meta.status, 'miss');
  assert.equal(b.meta.status, 'coalesced');
});

test('TTL cache clears in-flight state when a fetcher throws synchronously', async () => {
  const store = createTtlCache({ maxEntries: 5 });
  await assert.rejects(
    cacheFetch(store, 'feed', 500, () => { throw new Error('synchronous failure'); }),
    /synchronous failure/
  );
  assert.equal(store.inflight.size, 0);

  const recovered = await cacheFetch(store, 'feed', 500, done => done(null, { ok: true }));
  assert.equal(recovered.value.ok, true);
  assert.equal(recovered.meta.status, 'miss');
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
  assert.equal(guard(fakeReq(), fakeRes(), '/api/featuregeo'), true);
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

test('requireAuth (easyauth) rejects spoofed principals when App Service auth is disabled', () => {
  const p = encode(makePrincipal());
  const res = fakeRes();
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH,
    apiAuthToken: '',
    sendJson: fakeSendJson,
    isAppService: true,
    easyAuthEnabled: false,
  });
  const req = fakeReq({
    'x-ms-client-principal': p,
    'x-ms-client-principal-id': 'aaa-oid',
  });
  assert.equal(guard(req, res, '/api/messagecenter'), false);
  assert.equal(res._status, 401);
  assert.equal(res._payload.code, 'AUTH_NOT_ENFORCED');
});

test('requireAuth (easyauth) accepts valid App Service principals when auth is enabled', () => {
  const p = encode(makePrincipal());
  const guard = makeRequireAuth({
    mode: AUTH_MODE_EASYAUTH,
    apiAuthToken: '',
    sendJson: fakeSendJson,
    isAppService: true,
    easyAuthEnabled: true,
  });
  const req = fakeReq({
    'x-ms-client-principal': p,
    'x-ms-client-principal-id': 'aaa-oid',
  });
  assert.equal(guard(req, fakeRes(), '/api/messagecenter'), true);
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

test('tenant Message Center routes stay within the authenticated API namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(source, /parsed\.pathname\s*===\s*['"]\/servicemessages['"]/);
});

test('calendar-day filtering uses exclusive next-day bounds', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'servicehealth.html'), 'utf8');
  assert.doesNotMatch(html, /23:59:59(?:\.999)?|86399999|setHours\(\s*23\s*,\s*59/);
  assert.match(html, /start < dEnd/);
  assert.match(html, /start < dayEnd/);
});

test('every page has one primary heading and dynamic errors are announced', () => {
  const pages = fs.readdirSync(path.join(__dirname, '..'))
    .filter(name => name.endsWith('.html'));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.equal((html.match(/<h1(?:\s|>)/gi) || []).length, 1, `${page} must have one h1`);
    const levels = [...html.matchAll(/<h([1-6])(?:\s|>)/gi)].map(match => Number(match[1]));
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `${page} skips heading levels`);
    }
  }

  const serviceHealth = fs.readFileSync(path.join(__dirname, '..', 'servicehealth.html'), 'utf8');
  assert.match(serviceHealth, /id="sh-updated"[^>]*role="status"[^>]*aria-live="polite"/);

  const azureHealth = fs.readFileSync(path.join(__dirname, '..', 'azureservicehealth.html'), 'utf8');
  assert.doesNotMatch(azureHealth, /class="arh-error"(?! role="(?:alert|status)")/);

  const picker = fs.readFileSync(path.join(__dirname, '..', 'static', 'subscription-picker.js'), 'utf8');
  assert.match(picker, /class="sp-error" role="alert"/);
  assert.match(picker, /e\.key !== 'Enter' && e\.key !== ' '/);
});

async function getUnusedPort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(err => err ? reject(err) : resolve()));
  return port;
}

async function withServer(overrides, run) {
  const port = await getUnusedPort();
  const serverPath = path.join(__dirname, '..', 'server.js');
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    ...overrides,
  };
  const child = spawn(process.execPath, [serverPath], {
    cwd: os.tmpdir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before startup (code ${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) break;
    } catch (_) {
      // Startup can take a few polling intervals.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  try {
    await run(baseUrl);
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([
      once(child, 'exit'),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  }
}

test('server rejects the legacy tenant-data alias and isolates rate-limit tiers', async () => {
  await withServer({ AUTH_MODE: 'none-loopback-only' }, async (baseUrl) => {
    const legacy = await fetch(`${baseUrl}/servicemessages`);
    assert.equal(legacy.status, 404);

    for (let i = 0; i < 6; i++) {
      const health = await fetch(`${baseUrl}/healthz`);
      assert.equal(health.status, 200);
    }
    const summarize = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: '1', title: 'Test' }] }),
    });
    assert.equal(summarize.status, 503);

    const oversized = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: '1', description: 'x'.repeat(300_000) }] }),
    });
    assert.equal(oversized.status, 413);
  });
});

test('static assets revalidate with ETags instead of serving stale deployments', async () => {
  await withServer({ AUTH_MODE: 'none-loopback-only' }, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/static/util.js`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'public, no-cache');
    const etag = first.headers.get('etag');
    assert.ok(etag);

    const second = await fetch(`${baseUrl}/static/util.js`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.status, 304);
  });
});

test('subscription picker remains usable when an admin token protects admin-only mutations', async () => {
  await withServer({
    AUTH_MODE: 'none-loopback-only',
    ADMIN_TOKEN: 'admin-only-secret',
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/subscriptions/selected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected: [] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.selected, []);
  });
});

test('server rejects spoofed Easy Auth principals when App Service auth is disabled', async () => {
  await withServer({
    AUTH_MODE: 'easyauth',
    WEBSITE_INSTANCE_ID: 'test-instance',
  }, async (baseUrl) => {
    const principal = encode(makePrincipal());
    const response = await fetch(`${baseUrl}/api/messagecenter`, {
      headers: {
        'X-MS-CLIENT-PRINCIPAL': principal,
        'X-MS-CLIENT-PRINCIPAL-ID': 'aaa-oid',
      },
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.code, 'AUTH_NOT_ENFORCED');
  });
});
