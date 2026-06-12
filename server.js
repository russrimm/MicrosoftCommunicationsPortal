// Local dev server — serves index.html and proxies the release plans API to bypass CORS
// Usage: node server.js   (then open http://localhost:3000)

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');
const crypto = require('crypto');
require('dotenv').config();

const PORT     = 3000;
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

// ── Response helpers ────────────────────────────────────────────────────────
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
function _fetchMessageCenterMessages_shape(token, done) {
  const options = {
    hostname: 'graph.microsoft.com',
    path: '/v1.0/admin/serviceAnnouncements/messages',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        done(null, { status: res.statusCode, body: JSON.parse(body) });
      } catch (e) {
        done(new Error(`Parse error: ${e.message}`));
      }
    });
  });

  req.on('error', done);
  req.end();
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

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');

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
        const error = body && body.error ? (body.error.message || body.error.code || 'Graph API error') : null;
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
        const error = body && body.error ? (body.error.message || body.error.code || 'Graph API error') : null;
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
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ items: [], error: err.message }));
        return;
      }
      const { status, items, error } = result;
      console.log(`[m365updates] ${status} \u2192 ${items.length} items`);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=300',
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
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ items: [], error: err.message }));
        return;
      }
      const { status, items, error } = result;
      console.log(`[azureupdates] ${status} \u2192 ${items.length} items`);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=300',
      });
      res.end(JSON.stringify({ items, count: items.length, error: error || null }));
    });
    return;
  }

  // ── Proxy endpoint ──────────────────────────────────────────────────────────
  if (parsed.pathname === '/proxy') {
    const productId = parsed.searchParams.get('productId') || '';
    const langCode  = parsed.searchParams.get('langCode')  || 'en-US';
    const proxyPath = `${API_PATH}?langCode=${encodeURIComponent(langCode)}&productId=${encodeURIComponent(productId)}`;
    requestReleasePlans(proxyPath, MAX_REDIRECTS, (err, upstream) => {
      if (err) {
        console.error('[proxy] error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ results: [], error: err.message }));
        return;
      }

      const { status, body } = upstream;
        // Upstream sometimes returns HTML (login redirect, error page) instead of JSON.
        // Normalize to JSON so the client always gets `{results: [...]}`.
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not JSON */ }
        const count = parsed && Array.isArray(parsed.results) ? parsed.results.length : 0;
      console.log(`[proxy] ${status} ${productId} \u2192 ${count} results (${body.length} bytes)`);
        if (parsed) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'max-age=300',
          });
          res.end(body);
        } else {
          // Upstream returned non-JSON; pass through a structured error
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
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

  // ── Serve static HTML pages ─────────────────────────────────────────────────
  const pageMap = {
    '/':              'index.html',
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

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Microsoft Communications Portal`);
  console.log(`  → http://localhost:${PORT}\n`);
});