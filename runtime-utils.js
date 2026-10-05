'use strict';

function parseBoundedInteger(value, fallback, min, max) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^-?\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function rateLimitBucketKey(ip, limit, windowMs) {
  return `${ip}:${limit}:${windowMs}`;
}

function mergeVaryHeaders() {
  const values = [];
  for (const header of arguments) {
    if (!header) continue;
    values.push(...String(header).split(','));
  }
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).join(', ');
}

function isSafeLangCode(value) {
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2})?$/.test(String(value || ''));
}

function subscriptionIdFromResourceUri(uri) {
  const match = /^\/?subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
    .exec(String(uri || ''));
  return match ? match[1] : '';
}

function subscriptionAccessDecision(snapshot, subscriptionId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(subscriptionId || ''))) {
    return { status: 400, code: 'INVALID_SUBSCRIPTION', error: 'Invalid subscriptionId — must be a GUID' };
  }
  if (!snapshot || !snapshot.ids) {
    return { status: 502, code: 'SUBSCRIPTION_CHECK_FAILED', error: 'Unable to verify subscription access.' };
  }
  if (!snapshot.complete) {
    return {
      status: 503,
      code: 'SUBSCRIPTION_LIST_INCOMPLETE',
      error: 'Subscription discovery is incomplete. Retry after the Azure subscription list refreshes.',
    };
  }
  const id = subscriptionId.toLowerCase();
  const ids = snapshot.ids;
  const allowed = typeof ids.has === 'function'
    ? ids.has(id)
    : Array.isArray(ids) && ids.some(item => String(item).toLowerCase() === id);
  if (!allowed) {
    return { status: 403, code: 'SUBSCRIPTION_FORBIDDEN', error: 'That subscription is not accessible to this service.' };
  }
  return null;
}

function readBoundedString(stream, maxBytes, done) {
  const limit = maxBytes > 0 ? maxBytes : 8 * 1024 * 1024;
  const chunks = [];
  let received = 0;
  let settled = false;
  const finish = (err, value) => {
    if (settled) return;
    settled = true;
    done(err, value);
  };
  stream.on('data', (chunk) => {
    if (settled) return;
    const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    received += size;
    if (received > limit) {
      const err = new Error('Upstream response exceeded size limit');
      err.code = 'UPSTREAM_TOO_LARGE';
      finish(err);
      if (typeof stream.destroy === 'function') stream.destroy();
      return;
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  stream.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
  stream.on('error', (err) => finish(err));
}

function shouldUseSecureCookie(options) {
  const config = options || {};
  if (config.networkFacing || config.socketEncrypted) return true;
  if (!config.trustProxy) return false;
  const protocols = String(config.forwardedProto || '').split(',');
  return protocols[protocols.length - 1].trim().toLowerCase() === 'https';
}

function shouldRetryTransientResponse(err, status, retryAfterMs, delayBudgetMs) {
  if (err) return true;
  if (!Number.isInteger(status)) return false;
  if (status !== 429 && status < 500) return false;
  return !Number.isFinite(retryAfterMs) || retryAfterMs <= delayBudgetMs;
}

function retryCallback(operation, options, done) {
  const config = options || {};
  const maxAttempts = Math.max(1, config.maxAttempts || 3);
  const baseDelayMs = Math.max(0, config.baseDelayMs || 100);
  const maxDelayMs = Math.max(baseDelayMs, config.maxDelayMs || 2_000);
  const schedule = config.schedule || setTimeout;
  const shouldRetry = config.shouldRetry || ((err) => !!err);
  let attempt = 0;

  function run() {
    attempt++;
    operation((err, value) => {
      if (attempt >= maxAttempts || !shouldRetry(err, value)) {
        done(err, value);
        return;
      }
      const suggestedDelay = typeof config.getDelayMs === 'function'
        ? config.getDelayMs(err, value, attempt)
        : null;
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const delayMs = Number.isFinite(suggestedDelay)
        ? Math.max(0, Math.min(maxDelayMs, suggestedDelay))
        : exponentialDelay;
      schedule(run, delayMs);
    });
  }

  run();
}

function collectPaginated(fetchPage, firstPath, maxPages, getNextLink, done) {
  const collected = [];
  let pages = 0;

  function step(pathOrUrl) {
    fetchPage(pathOrUrl, (err, result) => {
      if (err) {
        if (!collected.length) return done(err);
        return done(null, {
          status: 502,
          body: {
            value: collected,
            error: { code: 'UPSTREAM_PAGE_ERROR', message: err.message },
            pages: pages + 1,
            partialFailure: true,
          },
        });
      }
      pages++;
      const status = result && result.status;
      const body = result && result.body;
      if (status >= 400 || !body) {
        return done(null, {
          status,
          body: {
            value: collected,
            error: body && body.error,
            pages,
            partialFailure: collected.length > 0,
          },
        });
      }
      if (Array.isArray(body.value)) collected.push(...body.value);
      const nextLink = getNextLink(body);
      if (nextLink && pages < maxPages) return step(nextLink);
      done(null, {
        status,
        body: {
          value: collected,
          pages,
          truncated: !!nextLink,
          nextLink: nextLink || null,
        },
      });
    });
  }

  step(firstPath);
}

function mergeServiceHealth(services, issues) {
  const merged = (Array.isArray(services) ? services : []).map(service => ({
    ...service,
    issues: Array.isArray(service.issues) ? [...service.issues] : [],
  }));
  const serviceMap = new Map(merged.map(service => [service.service || service.id, service]));
  const issueIds = new Map(merged.map(service => [
    service,
    new Set(service.issues.map(issue => issue && issue.id).filter(Boolean)),
  ]));

  for (const issue of Array.isArray(issues) ? issues : []) {
    const serviceName = issue.service || 'Unknown Service';
    let service = serviceMap.get(serviceName);
    if (!service) {
      service = { service: serviceName, id: serviceName, status: 'serviceOperational', issues: [] };
      serviceMap.set(serviceName, service);
      issueIds.set(service, new Set());
      merged.push(service);
    }
    const ids = issueIds.get(service);
    if (!issue.id || !ids.has(issue.id)) {
      service.issues.push(issue);
      if (issue.id) ids.add(issue.id);
    }
  }
  return merged;
}

function createTtlCache(options) {
  const config = options || {};
  const maxEntries = config.maxEntries || 500;
  const now = config.now || Date.now;
  const cache = new Map();
  const inflight = new Map();

  function fetch(key, ttlMs, fetcher, done, fetchOptions) {
    const opts = fetchOptions || {};
    const timestamp = now();
    const hit = cache.get(key);
    if (!opts.force && hit && hit.expires > timestamp) {
      return done(null, hit.value, {
        status: 'hit',
        storedAt: hit.storedAt,
        expiresAt: hit.expires,
      });
    }

    const waiters = inflight.get(key);
    if (waiters) {
      waiters.push((err, value, meta) => {
        const joinedMeta = meta && meta.status !== 'stale'
          ? { ...meta, status: 'coalesced' }
          : meta;
        done(err, value, joinedMeta);
      });
      return;
    }

    inflight.set(key, [done]);
    const finish = (err, value) => {
      const callbacks = inflight.get(key) || [];
      inflight.delete(key);

      let resolvedError = err;
      let resolvedValue = value;
      let meta = null;
      const completedAt = now();
      if (err && hit && opts.staleIfErrorMs > 0 &&
          completedAt <= hit.expires + opts.staleIfErrorMs) {
        resolvedError = null;
        resolvedValue = hit.value;
        meta = {
          status: 'stale',
          storedAt: hit.storedAt,
          expiresAt: hit.expires,
        };
      } else if (!err && ttlMs > 0 &&
          (typeof opts.shouldCache !== 'function' || opts.shouldCache(value))) {
        if (cache.size >= maxEntries) {
          for (const [cacheKey, entry] of cache) {
            if (entry.expires <= completedAt) cache.delete(cacheKey);
          }
          while (cache.size >= maxEntries) {
            cache.delete(cache.keys().next().value);
          }
        }
        const entry = {
          expires: completedAt + ttlMs,
          storedAt: completedAt,
          value,
        };
        cache.set(key, entry);
        meta = {
          status: 'miss',
          storedAt: entry.storedAt,
          expiresAt: entry.expires,
        };
      } else if (!err) {
        meta = { status: 'bypass', storedAt: null, expiresAt: null };
      }

      for (const callback of callbacks) {
        try {
          callback(resolvedError, resolvedValue, meta);
        } catch (callbackError) {
          if (typeof config.onCallbackError === 'function') {
            config.onCallbackError(callbackError);
          } else {
            setTimeout(() => { throw callbackError; }, 0);
          }
        }
      }
    };
    try {
      fetcher(finish);
    } catch (err) {
      finish(err);
    }
  }

  return { cache, inflight, fetch };
}

const MSPULSE360_MESSAGE_BASE = 'https://www.mspulse360.app/message/';
// Matches any Microsoft 365 admin center Message Center deep link (admin.microsoft.com
// or admin.cloud.microsoft, with or without /AdminPortal/home, #, or ?ref= prefixes).
const ADMIN_MESSAGE_CENTER_URL_RE =
  /https?:\/\/admin\.(?:microsoft\.com|cloud\.microsoft)\/[^\s"'<>()]*?MessageCenter\/:\/messages\/(MC\d+)(?:[?&#][^\s"'<>()]*)?/gi;

function mspulse360MessageUrl(messageId) {
  return MSPULSE360_MESSAGE_BASE + encodeURIComponent(String(messageId).toUpperCase());
}

function rewriteMessageCenterLinks(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(ADMIN_MESSAGE_CENTER_URL_RE, (_, id) => mspulse360MessageUrl(id));
}

function rewriteMessageCenterMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  if (msg.body && typeof msg.body.content === 'string') {
    msg.body.content = rewriteMessageCenterLinks(msg.body.content);
  }
  if (Array.isArray(msg.details)) {
    for (const detail of msg.details) {
      if (detail && typeof detail.value === 'string') {
        detail.value = rewriteMessageCenterLinks(detail.value);
      }
    }
  }
  return msg;
}

module.exports = {
  collectPaginated,
  createTtlCache,
  isSafeLangCode,
  mergeServiceHealth,
  mergeVaryHeaders,
  mspulse360MessageUrl,
  parseBoundedInteger,
  rateLimitBucketKey,
  readBoundedString,
  retryCallback,
  rewriteMessageCenterLinks,
  rewriteMessageCenterMessage,
  shouldRetryTransientResponse,
  shouldUseSecureCookie,
  subscriptionAccessDecision,
  subscriptionIdFromResourceUri,
};
