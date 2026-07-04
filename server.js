// Local dev server — serves index.html and proxies the release plans API to bypass CORS
// Usage: node server.js   (then open http://localhost:3000)

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');
const crypto = require('crypto');
require('dotenv').config();

const PORT     = Number(process.env.PORT) || 3000;
const API_HOST = 'releaseplans.microsoft.com';
// The /en-US/ locale-prefixed path now 301-redirects to the locale-less path;
// locale is supplied via the langCode query parameter instead.
const API_PATH = '/releaseplanner-json/';
const MAX_REDIRECTS = 5;

// Reuse TLS sockets across upstream calls (releaseplans, graph, www.microsoft.com).
// One shared agent dramatically cuts latency when the picker fans out ~30 parallel calls.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });

// Default outbound request timeout (ms). Avoids hung sockets on slow upstreams.
const UPSTREAM_TIMEOUT_MS = 15000;

// ── Upstream response cache ─────────────────────────────────────────────────
// Simple in-memory TTL cache plus an in-flight map that coalesces concurrent
// requests for the same key into a single upstream call.
const upstreamCache   = new Map();   // key -> { expires, value }
const upstreamInflight = new Map();  // key -> Array<callback>

function cachedFetch(key, ttlMs, fetcher, done) {
  const now = Date.now();
  const hit = upstreamCache.get(key);
  if (hit && hit.expires > now) {
    return done(null, hit.value);
  }
  const waiters = upstreamInflight.get(key);
  if (waiters) {
    waiters.push(done);
    return;
  }
  upstreamInflight.set(key, [done]);
  fetcher((err, value) => {
    const callbacks = upstreamInflight.get(key) || [];
    upstreamInflight.delete(key);
    if (!err && ttlMs > 0) {
      upstreamCache.set(key, { expires: Date.now() + ttlMs, value });
    }
    for (const cb of callbacks) {
      try { cb(err, value); } catch (e) { console.error('[cache] callback error:', e.message); }
    }
  });
}

// ── Per-IP token bucket rate limiter ────────────────────────────────────────
// Simple fixed-window counter keyed by remote address. State: Map<ip, {count, resetAt}>.
const rateLimitBuckets = new Map();
const RATE_LIMIT_PURGE_INTERVAL = 512; // opportunistic purge every N checks
let rateLimitPurgeCounter = 0;

function checkRateLimit(req, res, limit, windowMs) {
  const now = Date.now();
  if (++rateLimitPurgeCounter >= RATE_LIMIT_PURGE_INTERVAL) {
    rateLimitPurgeCounter = 0;
    for (const [k, v] of rateLimitBuckets) {
      if (v.resetAt <= now) rateLimitBuckets.delete(k);
    }
  }
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    sendJson(req, res, 429, { error: 'Rate limit exceeded', retryAfterSeconds }, {
      'Retry-After': String(retryAfterSeconds),
    });
    return false;
  }
  return true;
}

// ── Response helpers ────────────────────────────────────────────────────────
// Build CORS headers by echoing an allow-listed Origin. CORS_ORIGINS is a
// comma-separated list of exact origins; if unset, no CORS header is emitted
// (same-origin only). Wildcards are not supported.
function corsHeaders(req) {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return {};
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
}

// Send a JSON response, honoring Accept-Encoding for gzip/deflate.
function sendJson(req, res, status, payload, extraHeaders) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Accept-Encoding',
  }, extraHeaders || {});
  const accept = (req.headers['accept-encoding'] || '').toLowerCase();
  const buf = Buffer.from(json, 'utf8');
  if (accept.includes('gzip') && buf.length > 1024) {
    const gz = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(status, headers);
    res.end(gz);
    return;
  }
  if (accept.includes('deflate') && buf.length > 1024) {
    const df = zlib.deflateSync(buf);
    headers['Content-Encoding'] = 'deflate';
    headers['Content-Length'] = df.length;
    res.writeHead(status, headers);
    res.end(df);
    return;
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

// Send an HTML buffer with gzip + ETag/304 support.
function sendHtml(req, res, buf, etag) {
  const ifNoneMatch = req.headers['if-none-match'];
  if (etag && ifNoneMatch === etag) {
    res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // Inline scripts/styles are used throughout these pages; restrict everything else.
    'Content-Security-Policy':
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'none'; " +
      "form-action 'none'",
  };
  if (etag) headers['ETag'] = etag;
  const accept = (req.headers['accept-encoding'] || '').toLowerCase();
  if (accept.includes('gzip') && buf.length > 1024) {
    const gz = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(200, headers);
    res.end(gz);
    return;
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(200, headers);
  res.end(buf);
}

// In-memory cache of static HTML files: { etag, buf, mtimeMs }.
const htmlFileCache = new Map();
function getHtmlFile(filePath, done) {
  fs.stat(filePath, (err, st) => {
    if (err) return done(err);
    const cached = htmlFileCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs) return done(null, cached);
    fs.readFile(filePath, (err2, buf) => {
      if (err2) return done(err2);
      const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
      const entry = { etag, buf, mtimeMs: st.mtimeMs };
      htmlFileCache.set(filePath, entry);
      done(null, entry);
    });
  });
}

// Microsoft 365 Roadmap RSS feed
const M365_UPDATES_HOST = 'www.microsoft.com';
const M365_UPDATES_PATH = '/releasecommunications/api/v2/m365/rss';

// Azure Updates RSS feed
const AZURE_UPDATES_HOST = 'www.microsoft.com';
const AZURE_UPDATES_PATH = '/releasecommunications/api/v2/azure/rss';

// ── AI provider configuration (auto-detect) ─────────────────────────────────
// Supports any OpenAI-compatible chat-completions endpoint. Detected in order:
// Azure OpenAI → OpenAI → GitHub Models. First one fully configured wins.
function detectAiProvider() {
  if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
    const u = new URL(endpoint);
    return {
      name: 'azure-openai',
      model: deployment,
      hostname: u.hostname,
      path: `${u.pathname.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
      headers: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
    const u = new URL(base);
    return {
      name: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      hostname: u.hostname,
      path: `${u.pathname.replace(/\/+$/, '')}/v1/chat/completions`,
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    };
  }
  if (process.env.GITHUB_TOKEN) {
    return {
      name: 'github-models',
      model: process.env.GITHUB_MODEL || 'openai/gpt-4o-mini',
      hostname: 'models.github.ai',
      path: '/inference/chat/completions',
      headers: { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}` },
    };
  }
  return null;
}
const AI_PROVIDER = detectAiProvider();

// Call the configured LLM with an OpenAI-compatible chat-completions payload.
// opts: { system, user, json (bool), maxTokens, temperature }
function callLlm(opts, done) {
  if (!AI_PROVIDER) {
    return done(new Error('No AI provider configured. Set AZURE_OPENAI_*, OPENAI_API_KEY, or GITHUB_TOKEN in .env.'));
  }
  const body = {
    model: AI_PROVIDER.model,
    messages: [
      { role: 'system', content: opts.system || 'You are a helpful assistant.' },
      { role: 'user', content: opts.user || '' },
    ],
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
    max_tokens: opts.maxTokens || 800,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const reqOpts = {
    hostname: AI_PROVIDER.hostname,
    path: AI_PROVIDER.path,
    method: 'POST',
    agent: keepAliveAgent,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'Accept': 'application/json',
    }, AI_PROVIDER.headers),
  };
  const req = https.request(reqOpts, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return done(new Error(`LLM HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
      }
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { return done(new Error(`LLM response not JSON: ${e.message}`)); }
      const content = parsed && parsed.choices && parsed.choices[0]
        && parsed.choices[0].message && parsed.choices[0].message.content;
      if (!content) return done(new Error('LLM response missing content'));
      if (opts.json) {
        try { return done(null, JSON.parse(content)); }
        catch (e) { return done(new Error(`LLM JSON parse failed: ${e.message}`)); }
      }
      done(null, content);
    });
  });
  req.on('error', done);
  req.setTimeout(opts.timeoutMs || 30000, () => req.destroy(new Error('LLM request timeout')));
  req.write(payload);
  req.end();
}

// Read a JSON request body (cap at 1MB) and parse it.
function readJsonBody(req, done) {
  let received = 0;
  const chunks = [];
  const MAX = 1024 * 1024;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX) {
      req.destroy();
      return done(new Error('Request body too large'));
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!chunks.length) return done(null, {});
    try { done(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { done(new Error(`Invalid JSON body: ${e.message}`)); }
  });
  req.on('error', done);
}

// Strip HTML to plain text for AI input (keeps token usage down).
function stripHtmlServer(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a feed item from any source into a compact shape for the LLM.
function normalizeForAi(item, source) {
  const title = item.title || item.subject || item.service || '';
  const descRaw = item.description || (item.body && item.body.content) || item.impactDescription || '';
  const desc = stripHtmlServer(descRaw).slice(0, 1200);
  const id = item.id || item.guid || item.link || title;
  return {
    id: String(id),
    source,
    title: String(title).slice(0, 300),
    description: desc,
    link: item.link || item.webUrl || '',
    categories: Array.isArray(item.categories) ? item.categories.slice(0, 8) : [],
    publishedAt: item.pubDate || item.lastModifiedDateTime || item.startDateTime || '',
  };
}

// Hash a JSON-serializable input deterministically for cache keys.
function aiCacheKey(prefix, payload) {
  const h = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  return `${prefix}:${AI_PROVIDER ? AI_PROVIDER.name + ':' + AI_PROVIDER.model : 'none'}:${h}`;
}

const SYSTEM_SUMMARIZE =
  'You analyze Microsoft cloud product change announcements (Azure, M365, Power Platform, Message Center, Service Health). ' +
  'For each item, produce: (1) a 1-2 sentence plain-language summary aimed at IT admins, (2) an impact rating of high/medium/low, ' +
  '(3) a one-line impactReason, (4) audience tags (e.g. "End users", "IT admins", "Developers", "Security"), ' +
  '(5) actionRequired (true if admins must take action before a deadline, else false). ' +
  'Be precise. No marketing language. If the description is empty, say so honestly. ' +
  'Return STRICT JSON: {"summaries":[{"id":"...","summary":"...","impact":"high|medium|low","impactReason":"...","audience":["..."],"actionRequired":true|false}]}';

const SYSTEM_DIGEST =
  'You triage a batch of Microsoft cloud announcements and pick the most impactful for IT admins. ' +
  'Consider: breaking changes, retirements/deprecations, security/compliance, GA launches, required admin action, ' +
  'and broad audience reach. Ignore minor cosmetic tweaks. ' +
  'Return STRICT JSON: {"headline":"one sentence overall theme","topItems":[{"id":"...","title":"...","summary":"...","impact":"high|medium|low","impactReason":"...","actionRequired":true|false}],"themes":["short theme 1","short theme 2"]}';

// Microsoft 365 Message Center configuration
const M365_CLIENT_ID     = process.env.M365_CLIENT_ID;
const M365_CLIENT_SECRET = process.env.M365_CLIENT_SECRET;
const M365_TENANT_ID     = process.env.M365_TENANT_ID;
let m365AccessToken      = null;
let m365TokenExpiresAt   = 0;
let m365TokenInflight    = null;  // Array of pending callbacks while a refresh is in flight

// Get OAuth token for Microsoft Graph API
function getM365AccessToken(done) {
  // Return cached token if still valid
  if (m365AccessToken && Date.now() < m365TokenExpiresAt) {
    done(null, m365AccessToken);
    return;
  }
  // Coalesce concurrent refreshes — N parallel API hits should issue ONE token request.
  if (m365TokenInflight) {
    m365TokenInflight.push(done);
    return;
  }
  m365TokenInflight = [done];
  const finish = (err, token) => {
    const waiters = m365TokenInflight || [];
    m365TokenInflight = null;
    for (const cb of waiters) {
      try { cb(err, token); } catch (e) { console.error('[token] callback error:', e.message); }
    }
  };

  if (!M365_CLIENT_ID || !M365_CLIENT_SECRET || !M365_TENANT_ID) {
    finish(new Error('M365 credentials not configured in .env file'));
    return;
  }

  const postData = new URLSearchParams({
    client_id: M365_CLIENT_ID,
    client_secret: M365_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  }).toString();

  const options = {
    hostname: 'login.microsoftonline.com',
    path: `/${M365_TENANT_ID}/oauth2/v2.0/token`,
    method: 'POST',
    agent: keepAliveAgent,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.access_token) {
          m365AccessToken = data.access_token;
          m365TokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s before expiry
          finish(null, m365AccessToken);
        } else {
          finish(new Error(`Failed to get token: ${data.error_description || body}`));
        }
      } catch (e) {
        finish(new Error(`Token parse error: ${e.message}`));
      }
    });
  });

  req.on('error', finish);
  req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('token request timeout')));
  req.write(postData);
  req.end();
}

// Generic Microsoft Graph GET helper. Accepts either a relative path
// ("/v1.0/...") or an absolute https URL (used for @odata.nextLink).
function graphGet(token, pathOrUrl, done) {
  let hostname = 'graph.microsoft.com';
  let path = pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const u = new URL(pathOrUrl);
    hostname = u.hostname;
    path = u.pathname + u.search;
  }
  const options = {
    hostname,
    path,
    method: 'GET',
    agent: keepAliveAgent,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try { done(null, { status: res.statusCode, body: JSON.parse(body) }); }
      catch (e) { done(new Error(`Parse error: ${e.message}`)); }
    });
  });
  req.on('error', done);
  req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('graph request timeout')));
  req.end();
}

// Fetch all pages by following @odata.nextLink. Stops at maxPages as a safety.
function graphGetAllPages(token, firstPath, maxPages, done) {
  const collected = [];
  let lastStatus = 200;
  let pages = 0;

  function step(pathOrUrl) {
    graphGet(token, pathOrUrl, (err, result) => {
      if (err) return done(err);
      pages++;
      const { status, body } = result;
      lastStatus = status;
      // If the call errored, return what we have plus the error body so the
      // route can surface a useful message.
      if (status >= 400 || !body) {
        return done(null, { status, body: { value: collected, error: body && body.error } });
      }
      if (Array.isArray(body.value)) collected.push(...body.value);
      const next = body['@odata.nextLink'];
      if (next && pages < maxPages) {
        return step(next);
      }
      done(null, { status: lastStatus, body: { value: collected } });
    });
  }

  step(firstPath);
}

// Fetch Message Center messages from Microsoft Graph (all pages, last 30 days)
function fetchMessageCenterMessages(token, done) {
  const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  const filterValue = `startDateTime gt ${thirtyDaysAgo.toISOString()}`;
  const query = new URLSearchParams({
    '$filter': filterValue,
    '$top': '999',
  });
  // Cache for 60s — matches the Cache-Control we send to the browser.
  cachedFetch('mc:messages', 60_000,
    (cb) => graphGetAllPages(token, `/v1.0/admin/serviceAnnouncement/messages?${query.toString()}`, 20, cb),
    done);
}

// Fetch Service Health from Microsoft Graph
function fetchServiceHealth(token, done) {
  cachedFetch('mc:health', 60_000,
    (cb) => graphGet(token, '/v1.0/admin/serviceAnnouncement/healthOverviews?$expand=issues', cb),
    done);
}

// (legacy kept for shape compatibility)
function _fetchMessageCenterMessages_shape() { /* removed: superseded by graphGetAllPages */ }

// Translate a Microsoft Graph error object + HTTP status into a diagnostic
// message. Graph often returns 403 with { code: "UnknownError", message: "" }
// when the app registration lacks the required application permission or has
// not received admin consent — surface that possibility to the caller.
function describeGraphError(status, err, requiredPermission) {
  const code = (err && err.code) || '';
  const msg  = (err && err.message) || '';
  if (status === 403 || status === 401) {
    const perm = requiredPermission || 'the required Microsoft Graph application permission';
    const detail = msg && msg.toLowerCase() !== code.toLowerCase() ? ` Graph said: "${msg}".` : '';
    return `Microsoft Graph returned ${status} ${code || 'Forbidden'}. Check that the Entra app registration has the "${perm}" Microsoft Graph application permission AND that a tenant admin has granted admin consent for it. Fastest fix: re-run scripts/create-entra-app.ps1 as a Global Admin, or add the permission and click "Grant admin consent" in Azure portal → Entra ID → App registrations → your app → API permissions.${detail}`;
  }
  return msg || code || `Graph API error (HTTP ${status})`;
}

// Generic HTTPS GET that follows redirects. Used for the Azure Updates RSS feed.
function httpsGetFollow(hostname, pathname, redirectsLeft, done) {
  const options = {
    hostname,
    path: pathname,
    method: 'GET',
    agent: keepAliveAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Encoding': 'gzip, deflate',
    },
  };

  const req = https.request(options, (apiRes) => {
    const status = apiRes.statusCode || 0;
    const location = apiRes.headers.location;
    const isRedirect = [301, 302, 307, 308].includes(status);

    if (isRedirect && location && redirectsLeft > 0) {
      const nextUrl = new URL(location, `https://${hostname}`);
      apiRes.resume();
      httpsGetFollow(nextUrl.hostname, `${nextUrl.pathname}${nextUrl.search}`, redirectsLeft - 1, done);
      return;
    }

    const enc = (apiRes.headers['content-encoding'] || '').toLowerCase();
    let stream = apiRes;
    if (enc === 'gzip') stream = apiRes.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = apiRes.pipe(zlib.createInflate());
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { body += chunk; });
    stream.on('end', () => { done(null, { status, body }); });
    stream.on('error', done);
  });

  req.on('error', done);
  req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('rss request timeout')));
  req.end();
}

// Decode XML/HTML entities used in the RSS feed.
function decodeXmlEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

// Minimal RSS parser tailored to the M365 release-communications feed.
function parseRssItems(xml) {
  const items = [];
  if (!xml) return items;
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const getOne = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const x = r.exec(block);
      return x ? decodeXmlEntities(x[1]).trim() : '';
    };
    const getMany = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
      const out = [];
      let mm;
      while ((mm = r.exec(block)) !== null) out.push(decodeXmlEntities(mm[1]).trim());
      return out;
    };
    items.push({
      id: getOne('guid'),
      link: getOne('link'),
      title: getOne('title'),
      description: getOne('description'),
      categories: getMany('category'),
      pubDate: getOne('pubDate'),
      updated: getOne('a10:updated'),
    });
  }
  return items;
}

function fetchRssFeed(host, pathname, done) {
  cachedFetch(`rss:${host}${pathname}`, 5 * 60_000, (cb) => {
    httpsGetFollow(host, pathname, MAX_REDIRECTS, (err, result) => {
      if (err) return cb(err);
      const { status, body } = result;
      if (status >= 400) return cb(null, { status, items: [], error: `Upstream returned status ${status}` });
      const items = parseRssItems(body);
      cb(null, { status, items });
    });
  }, done);
}

function fetchM365Updates(done) {
  fetchRssFeed(M365_UPDATES_HOST, M365_UPDATES_PATH, done);
}

function fetchAzureUpdates(done) {
  fetchRssFeed(AZURE_UPDATES_HOST, AZURE_UPDATES_PATH, done);
}

function requestReleasePlans(pathname, redirectsLeft, done) {
  const options = {
    hostname: API_HOST,
    path: pathname,
    method: 'GET',
    agent: keepAliveAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Encoding': 'gzip, deflate',
    },
  };

  const req = https.request(options, (apiRes) => {
    const status = apiRes.statusCode || 0;
    const location = apiRes.headers.location;
    const isRedirect = [301, 302, 307, 308].includes(status);

    if (isRedirect && location && redirectsLeft > 0) {
      const nextUrl = new URL(location, `https://${API_HOST}`);
      apiRes.resume();
      requestReleasePlans(`${nextUrl.pathname}${nextUrl.search}`, redirectsLeft - 1, done);
      return;
    }

    const enc = (apiRes.headers['content-encoding'] || '').toLowerCase();
    let stream = apiRes;
    if (enc === 'gzip') stream = apiRes.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = apiRes.pipe(zlib.createInflate());
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { body += chunk; });
    stream.on('end', () => {
      done(null, { status, body });
    });
    stream.on('error', done);
  });

  req.on('error', (err) => {
    done(err);
  });
  req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('proxy request timeout')));

  req.end();
}

// ── Empty-product cache ─────────────────────────────────────────────────────
// The Power Platform Release Planner picker fans out one /proxy call per
// product. Many product IDs consistently return 0 results — they're valid
// products with no published release plan. Remembering them avoids the
// pointless upstream round-trip and the log spam.
const EMPTY_PRODUCTS_FILE = path.join(__dirname, 'empty-products.json');
const EMPTY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-check at most weekly
const emptyProducts = new Map(); // productId -> { ts: number, hits: number }
let emptyProductsWriteTimer = null;

function loadEmptyProducts() {
  try {
    const raw = fs.readFileSync(EMPTY_PRODUCTS_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [id, entry] of Object.entries(obj || {})) {
      if (entry && typeof entry.ts === 'number' && now - entry.ts < EMPTY_TTL_MS) {
        emptyProducts.set(id, { ts: entry.ts, hits: entry.hits || 1 });
      }
    }
    if (emptyProducts.size) {
      console.log(`[proxy] loaded ${emptyProducts.size} known-empty product IDs (auto-skip enabled)`);
    }
  } catch (_e) { /* file missing or unreadable; start empty */ }
}

function saveEmptyProductsDebounced() {
  if (emptyProductsWriteTimer) return;
  emptyProductsWriteTimer = setTimeout(() => {
    emptyProductsWriteTimer = null;
    const obj = {};
    for (const [id, entry] of emptyProducts) obj[id] = entry;
    fs.writeFile(EMPTY_PRODUCTS_FILE, JSON.stringify(obj, null, 2), (err) => {
      if (err) console.error('[proxy] failed to persist empty-products cache:', err.message);
    });
  }, 1000);
}

function isKnownEmpty(productId) {
  const e = emptyProducts.get(productId);
  if (!e) return false;
  if (Date.now() - e.ts > EMPTY_TTL_MS) { emptyProducts.delete(productId); return false; }
  return true;
}

function recordEmpty(productId) {
  if (!productId) return;
  const prev = emptyProducts.get(productId);
  emptyProducts.set(productId, { ts: Date.now(), hits: (prev ? prev.hits : 0) + 1 });
  saveEmptyProductsDebounced();
}

function clearEmpty(productId) {
  if (emptyProducts.delete(productId)) saveEmptyProductsDebounced();
}

loadEmptyProducts();

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');

  // ── AI status endpoint (UI uses this to show/hide AI features) ───────────
  if (parsed.pathname === '/api/ai-status') {
    sendJson(req, res, 200, {
      enabled: !!AI_PROVIDER,
      provider: AI_PROVIDER ? AI_PROVIDER.name : null,
      model: AI_PROVIDER ? AI_PROVIDER.model : null,
    }, { 'Cache-Control': 'max-age=30' });
    return;
  }

  // ── AI: summarize a batch of feed items ──────────────────────────────────
  // POST /api/summarize  body: { items: [{id,title,description,link,source,...}, ...] }
  // Returns: { summaries: [{id,summary,impact,impactReason,audience,actionRequired}] }
  if (parsed.pathname === '/api/summarize' && req.method === 'POST') {
    if (!checkRateLimit(req, res, 5, 60_000)) return;
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(req, res, 400, { error: err.message });
      const source = String(body.source || 'unknown').slice(0, 32);
      const itemsIn = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
      if (!itemsIn.length) return sendJson(req, res, 400, { error: 'items[] required (max 20)' });
      if (!AI_PROVIDER) {
        return sendJson(req, res, 503, { error: 'AI provider not configured. See .env.example.' });
      }
      const compact = itemsIn.map((it) => normalizeForAi(it, source));
      const key = aiCacheKey('summarize', compact);
      cachedFetch(key, 10 * 60_000, (cb) => {
        const userMsg = 'Summarize each of these announcements. Preserve the "id" field exactly.\n\n' +
          JSON.stringify({ items: compact });
        callLlm({ system: SYSTEM_SUMMARIZE, user: userMsg, json: true, maxTokens: 1800 }, (e, data) => {
          if (e) return cb(e);
          // Normalize: ensure every requested id has a summary entry.
          const byId = new Map((data && Array.isArray(data.summaries) ? data.summaries : [])
            .map(s => [String(s.id), s]));
          const summaries = compact.map(c => byId.get(c.id) || {
            id: c.id, summary: '(no summary returned)', impact: 'low', impactReason: '', audience: [], actionRequired: false,
          });
          cb(null, { summaries });
        });
      }, (e2, result) => {
        if (e2) {
          console.error('[summarize] error:', e2.message);
          return sendJson(req, res, 502, { error: e2.message, summaries: [] });
        }
        sendJson(req, res, 200, result, { 'Cache-Control': 'max-age=300' });
      });
    });
    return;
  }

  // ── AI: cross-feed impact digest (Top N most impactful from a source) ────
  // GET /api/impact-digest?source=azure|m365|messagecenter|servicehealth&limit=5&windowDays=14
  if (parsed.pathname === '/api/impact-digest') {
    if (!checkRateLimit(req, res, 10, 60_000)) return;
    if (!AI_PROVIDER) {
      return sendJson(req, res, 503, { error: 'AI provider not configured. See .env.example.' });
    }
    const source = (parsed.searchParams.get('source') || '').toLowerCase();
    const limit = Math.max(1, Math.min(10, parseInt(parsed.searchParams.get('limit') || '5', 10)));
    const windowDays = Math.max(1, Math.min(90, parseInt(parsed.searchParams.get('windowDays') || '14', 10)));
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    const finish = (items) => {
      if (!items.length) {
        return sendJson(req, res, 200, { source, headline: 'No items in window.', topItems: [], themes: [] });
      }
      // Filter to recent items, then cap input to keep tokens bounded.
      const recent = items.filter((it) => {
        const ts = it.pubDate || it.lastModifiedDateTime || it.startDateTime || '';
        if (!ts) return true;
        const t = new Date(ts).getTime();
        return isNaN(t) ? true : t >= cutoff;
      });
      const candidates = (recent.length ? recent : items).slice(0, 40)
        .map((it) => normalizeForAi(it, source));
      const key = aiCacheKey('digest', { source, limit, windowDays, candidates });
      cachedFetch(key, 15 * 60_000, (cb) => {
        const userMsg = `Pick the top ${limit} most impactful items for IT admins from the last ${windowDays} days. ` +
          'Preserve each "id" exactly.\n\n' + JSON.stringify({ items: candidates });
        callLlm({ system: SYSTEM_DIGEST, user: userMsg, json: true, maxTokens: 1500 }, cb);
      }, (e, data) => {
        if (e) {
          console.error('[digest] error:', e.message);
          return sendJson(req, res, 502, { error: e.message, topItems: [] });
        }
        const top = (data && Array.isArray(data.topItems) ? data.topItems : []).slice(0, limit);
        sendJson(req, res, 200, {
          source,
          headline: (data && data.headline) || '',
          themes: (data && Array.isArray(data.themes)) ? data.themes.slice(0, 6) : [],
          topItems: top,
          windowDays,
          generatedAt: new Date().toISOString(),
        }, { 'Cache-Control': 'max-age=600' });
      });
    };

    // Resolve items based on source.
    if (source === 'azure') {
      fetchAzureUpdates((e, r) => finish(e ? [] : (r.items || [])));
    } else if (source === 'm365') {
      fetchM365Updates((e, r) => finish(e ? [] : (r.items || [])));
    } else if (source === 'messagecenter') {
      getM365AccessToken((e, token) => {
        if (e) return sendJson(req, res, 502, { error: e.message, topItems: [] });
        fetchMessageCenterMessages(token, (e2, r) => finish(e2 ? [] : ((r && r.body && r.body.value) || [])));
      });
    } else if (source === 'servicehealth') {
      getM365AccessToken((e, token) => {
        if (e) return sendJson(req, res, 502, { error: e.message, topItems: [] });
        fetchServiceHealth(token, (e2, r) => {
          if (e2) return finish([]);
          // Service health: flatten issues out of healthOverviews so the AI sees individual events.
          const services = (r && r.body && r.body.value) || [];
          const issues = [];
          for (const s of services) {
            for (const iss of (s.issues || [])) {
              issues.push(Object.assign({ service: s.service }, iss));
            }
          }
          finish(issues);
        });
      });
    } else {
      sendJson(req, res, 400, { error: 'source must be one of: azure, m365, messagecenter, servicehealth' });
    }
    return;
  }

  // ── Message Center API endpoint ──────────────────────────────────────────
  if (parsed.pathname === '/api/messagecenter' || parsed.pathname === '/api/servicemessages' || parsed.pathname === '/servicemessages') {
    getM365AccessToken((err, token) => {
      if (err) {
        console.error('[messagecenter] token error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [], error: err.message }));
        return;
      }

      fetchMessageCenterMessages(token, (err, result) => {
        if (err) {
          console.error('[messagecenter] fetch error:', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages: [], error: err.message }));
          return;
        }

        const { status, body } = result;
        const error = body && body.error
          ? describeGraphError(status, body.error, 'ServiceMessage.Read.All')
          : null;
        if (error) console.error('[messagecenter] graph error:', status, error);
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=60',
        });
        res.end(JSON.stringify({
          messages: body.value || [],
          count: (body.value || []).length,
          error,
        }));
      });
    });
    return;
  }

  // ── Service Health API endpoint ───────────────────────────────────────────
  if (parsed.pathname === '/api/servicehealth') {
    getM365AccessToken((err, token) => {
      if (err) {
        console.error('[servicehealth] token error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ services: [], error: err.message }));
        return;
      }

      fetchServiceHealth(token, (err, result) => {
        if (err) {
          console.error('[servicehealth] fetch error:', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ services: [], error: err.message }));
          return;
        }

        const { status, body } = result;
        const error = body && body.error
          ? describeGraphError(status, body.error, 'ServiceHealth.Read.All')
          : null;
        if (error) console.error('[servicehealth] graph error:', status, error);
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=60',
        });
        res.end(JSON.stringify({
          services: body.value || [],
          count: (body.value || []).length,
          error,
        }));
      });
    });
    return;
  }

  // ── M365 Updates (M365 roadmap) RSS endpoint ───────────────────────
  if (parsed.pathname === '/api/m365updates') {
    fetchM365Updates((err, result) => {
      if (err) {
        console.error('[m365updates] fetch error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ items: [], error: err.message }));
        return;
      }
      const { status, items, error } = result;
      console.log(`[m365updates] ${status} \u2192 ${items.length} items`);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=300',
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ items, count: items.length, error: error || null }));
    });
    return;
  }

  // ── Azure Updates RSS endpoint ─────────────────────────────────────
  if (parsed.pathname === '/api/azureupdates') {
    fetchAzureUpdates((err, result) => {
      if (err) {
        console.error('[azureupdates] fetch error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ items: [], error: err.message }));
        return;
      }
      const { status, items, error } = result;
      console.log(`[azureupdates] ${status} \u2192 ${items.length} items`);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=300',
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ items, count: items.length, error: error || null }));
    });
    return;
  }

  // ── Proxy endpoint ──────────────────────────────────────────────────────────
  if (parsed.pathname === '/proxy') {
    const productId = parsed.searchParams.get('productId') || '';
    const langCode  = parsed.searchParams.get('langCode')  || 'en-US';
    const force     = parsed.searchParams.get('refresh') === '1';

    // Short-circuit IDs that recently returned 0 results — skip the upstream call entirely.
    if (productId && !force && isKnownEmpty(productId)) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=300',
        'X-Empty-Cache': 'hit',
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ results: [], cached: 'empty' }));
      return;
    }

    const proxyPath = `${API_PATH}?langCode=${encodeURIComponent(langCode)}&productId=${encodeURIComponent(productId)}`;
    requestReleasePlans(proxyPath, MAX_REDIRECTS, (err, upstream) => {
      if (err) {
        console.error('[proxy] error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ results: [], error: err.message }));
        return;
      }

      const { status, body } = upstream;
        // Upstream sometimes returns HTML (login redirect, error page) instead of JSON.
        // Other product IDs return malformed JSON containing Liquid templating errors —
        // e.g. literal "Liquid error: ..." text inside what should be arrays. We still
        // want to treat those as "no release plan published" rather than fail.
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not JSON */ }
        // Recover the "empty results" case from malformed bodies: if strict parse
        // failed but the body unambiguously contains `"results": []`, treat as empty.
        const looksLikeEmpty = !parsed && /["']results["']\s*:\s*\[\s*\]/.test(body);
        const count = parsed && Array.isArray(parsed.results) ? parsed.results.length : 0;
        const isEmpty = (parsed && count === 0) || looksLikeEmpty;
      // Only log non-success or noteworthy cases; normal 200 responses stay quiet.
      if (status !== 200 || looksLikeEmpty || !parsed) {
        console.log(`[proxy] ${status} ${productId} \u2192 ${count} results (${body.length} bytes)${looksLikeEmpty ? ' [recovered-empty]' : ''}${!parsed ? ' [unparseable]' : ''}`);
      }
        // Update empty-product cache based on this response.
        if (productId) {
          if (isEmpty) recordEmpty(productId);
          else if (parsed && count > 0) clearEmpty(productId);
        }
        if (parsed) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'max-age=300',
            ...corsHeaders(req),
          });
          res.end(body);
        } else if (looksLikeEmpty) {
          // Malformed upstream but clearly empty — return clean JSON.
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'max-age=300',
            'X-Empty-Cache': 'recovered',
            ...corsHeaders(req),
          });
          res.end(JSON.stringify({ results: [], recovered: true }));
        } else {
          // Upstream returned non-JSON; pass through a structured error
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders(req),
          });
          res.end(JSON.stringify({
            results: [],
            error: `Upstream returned non-JSON (status ${status}, ${body.length} bytes)`,
            preview: body.slice(0, 200),
          }));
        }
    });
    return;
  }

  // ── Empty-products admin endpoint (inspect / clear) ──────────────────────
  // GET    /api/empty-products             → list current entries
  // DELETE /api/empty-products             → clear entire cache
  // DELETE /api/empty-products?id=<guid>   → clear a single ID
  // Admin endpoint — loopback + optional bearer token only
  if (parsed.pathname === '/api/empty-products') {
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      sendJson(req, res, 403, { error: 'Forbidden' });
      return;
    }
    if (req.method === 'DELETE') {
      if (process.env.ADMIN_TOKEN) {
        const auth = req.headers['authorization'] || '';
        if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
          sendJson(req, res, 403, { error: 'Forbidden' });
          return;
        }
      }
      const id = parsed.searchParams.get('id');
      if (id) { clearEmpty(id); sendJson(req, res, 200, { ok: true, cleared: 1, id }); }
      else {
        const n = emptyProducts.size;
        emptyProducts.clear();
        saveEmptyProductsDebounced();
        sendJson(req, res, 200, { ok: true, cleared: n });
      }
      return;
    }
    const entries = [];
    for (const [id, entry] of emptyProducts) entries.push({ id, ts: entry.ts, hits: entry.hits });
    entries.sort((a, b) => b.ts - a.ts);
    sendJson(req, res, 200, { count: entries.length, ttlDays: EMPTY_TTL_MS / 86400000, entries });
    return;
  }

  // ── Redirect root to the Power Platform Release Planner ────────────────────
  if (parsed.pathname === '/') {
    res.writeHead(302, { Location: '/powerplatform', 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }

  // ── Serve static HTML pages ─────────────────────────────────────────────────
  const pageMap = {
    '/powerplatform': 'index.html',
    '/messagecenter': 'messagecenter.html',
    '/servicehealth': 'servicehealth.html',
    '/m365updates':   'm365updates.html',
    '/azureupdates':  'azureupdates.html',
  };
  const htmlFile = pageMap[parsed.pathname];
  if (htmlFile) {
    const filePath = path.join(__dirname, htmlFile);
    getHtmlFile(filePath, (err, entry) => {
      if (err) { res.writeHead(500); res.end(`Could not read ${htmlFile}`); return; }
      sendHtml(req, res, entry.buf, entry.etag);
    });
    return;
  }

  // ── Static assets (JS/CSS) under /static/ ────────────────────────────────
  if (parsed.pathname.startsWith('/static/')) {
    // Reject path traversal and disallowed characters.
    const rel = parsed.pathname.slice('/static/'.length);
    if (!rel || rel.includes('..') || rel.includes('\\') || !/^[\w./-]+$/.test(rel)) {
      res.writeHead(400); res.end('Bad path'); return;
    }
    const filePath = path.join(__dirname, 'static', rel);
    const root = path.join(__dirname, 'static') + path.sep;
    if (!filePath.startsWith(root)) { res.writeHead(400); res.end('Bad path'); return; }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
                      '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
      const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
      const headers = {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'ETag': etag,
        'X-Content-Type-Options': 'nosniff',
        'Vary': 'Accept-Encoding',
      };
      const accept = (req.headers['accept-encoding'] || '').toLowerCase();
      if (accept.includes('gzip') && buf.length > 1024) {
        const gz = zlib.gzipSync(buf);
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers); res.end(gz); return;
      }
      headers['Content-Length'] = buf.length;
      res.writeHead(200, headers); res.end(buf);
    });
    return;
  }

  // ── Static assets under /public/ (product/service icons, etc.) ───────────
  if (parsed.pathname.startsWith('/public/')) {
    let rel;
    try { rel = decodeURIComponent(parsed.pathname.slice('/public/'.length)); }
    catch { res.writeHead(400); res.end('Bad path'); return; }
    if (!rel || rel.includes('..') || rel.includes('\\') || !/^[\w .+()-]+\.(svg|png|jpe?g|gif|webp|ico)$/i.test(rel)) {
      res.writeHead(400); res.end('Bad path'); return;
    }
    const filePath = path.join(__dirname, 'public', rel);
    const root = path.join(__dirname, 'public') + path.sep;
    if (!filePath.startsWith(root)) { res.writeHead(400); res.end('Bad path'); return; }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
                      '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
                      '.ico': 'image/x-icon' };
      const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
      const headers = {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'ETag': etag,
        'X-Content-Type-Options': 'nosniff',
        'Vary': 'Accept-Encoding',
      };
      const accept = (req.headers['accept-encoding'] || '').toLowerCase();
      if (ext === '.svg' && accept.includes('gzip') && buf.length > 1024) {
        const gz = zlib.gzipSync(buf);
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers); res.end(gz); return;
      }
      headers['Content-Length'] = buf.length;
      res.writeHead(200, headers); res.end(buf);
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const HOST = process.env.HOST || '127.0.0.1';
const IS_LOOPBACK = HOST === '127.0.0.1' || HOST === '::1';
if (!IS_LOOPBACK) {
  const risks = [
    'holds a Microsoft Graph client_secret in memory/env',
    'calls billed LLM APIs (Azure OpenAI / OpenAI / GitHub Models)',
    'exposes an unauthenticated /api/empty-products endpoint',
  ];
  if (process.env.ALLOW_REMOTE_BIND !== 'true') {
    console.error('\n\x1b[31mFATAL: refusing to bind to non-loopback host "' + HOST + '".\x1b[0m');
    console.error('This server:');
    for (const r of risks) console.error('  - ' + r);
    console.error('Set ALLOW_REMOTE_BIND=true to override (only behind an authenticated reverse proxy on a trusted network).\n');
    process.exit(1);
  }
  const bar = '='.repeat(72);
  console.warn('\n\x1b[41m\x1b[97m' + bar + '\x1b[0m');
  console.warn('\x1b[41m\x1b[97m  WARNING: BINDING TO NON-LOOPBACK HOST "' + HOST + '"' + ' '.repeat(Math.max(0, 72 - 42 - HOST.length)) + '\x1b[0m');
  console.warn('\x1b[41m\x1b[97m' + bar + '\x1b[0m');
  console.warn('\x1b[31mThis process:\x1b[0m');
  for (const r of risks) console.warn('\x1b[31m  ! ' + r + '\x1b[0m');
  console.warn('\x1b[31mOnly do this behind an authenticated reverse proxy on a trusted network.\x1b[0m\n');
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Microsoft Communications Portal`);
  console.log(`  → http://${IS_LOOPBACK ? 'localhost' : HOST}:${PORT}`);
  if (AI_PROVIDER) {
    console.log(`  → AI: ${AI_PROVIDER.name} (${AI_PROVIDER.model})\n`);
  } else {
    console.log(`  → AI: disabled (set AZURE_OPENAI_*, OPENAI_API_KEY, or GITHUB_TOKEN in .env to enable)\n`);
  }
});