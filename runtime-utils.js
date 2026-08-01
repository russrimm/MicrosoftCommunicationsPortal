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
      } else if (!err && ttlMs > 0) {
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

module.exports = {
  collectPaginated,
  createTtlCache,
  mergeServiceHealth,
  mergeVaryHeaders,
  parseBoundedInteger,
  rateLimitBucketKey,
};
