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

module.exports = {
  parseBoundedInteger,
  rateLimitBucketKey,
};
