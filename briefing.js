// Weekly Customer Briefing — server-side helpers.
//
// Pure functions (normalization, week keys, snapshot diffs) plus a small
// file-backed snapshot store. Kept out of server.js so the diff logic can be
// unit-tested without booting the HTTP server.

'use strict';

const fs = require('fs');
const path = require('path');

// Release Planner products the briefing tracks. `area` matches the area keys
// used by weeklybriefing.html so Message Center and Release Planner content
// share one set of toggles.
const BRIEFING_PRODUCTS = [
  { id: 'e72f17ac-715d-e911-a968-000d3a4e32b5', name: 'Power Apps', area: 'powerapps' },
  { id: 'e92f17ac-715d-e911-a968-000d3a4e32b5', name: 'Power Automate', area: 'powerautomate' },
  { id: 'a0e02858-50a4-ea11-a812-000d3a8faea9', name: 'Microsoft Dataverse', area: 'dataverse' },
  { id: 'dbedfa94-1517-ea11-a811-000d3a8f010c', name: 'Power Platform governance and administration', area: 'governance' },
  { id: 'f3f92645-5223-ea11-a810-000d3a8f0f1e', name: 'Power Platform pro development', area: 'prodev' },
  { id: '1197f7de-0a44-ec11-8c62-00224829b77f', name: 'Power Pages', area: 'powerpages' },
];
const PRODUCT_BY_ID = new Map(BRIEFING_PRODUCTS.map(p => [p.id, p]));

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_FILE_RE = /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/;
const CORRUPT_GRACE_MS = 60 * 1000;

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decodeEntities(String(html == null ? '' : html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// First sentence of plain text, capped so a run-on sentence can't blow up the
// email layout.
function firstSentence(text, maxLen) {
  const limit = maxLen || 240;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  let sentence = match ? match[1] : clean;
  if (sentence.length > limit) {
    sentence = sentence.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
  }
  return sentence;
}

// Release Planner dates arrive as MM/DD/YYYY (month granularity in practice).
// Returns YYYY-MM-DD or '' when absent/invalid.
function parsePlannerDate(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!m) return '';
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function learnUrl(raw) {
  const safe = /^[a-z0-9][a-z0-9/-]*$/i;
  const article = String(raw.ArticlePath || '').trim().replace(/^articles\//i, '');
  if (article && safe.test(article) && !article.includes('..') && article.split('/').length >= 3) {
    return `https://learn.microsoft.com/en-us/power-platform/release-plan/${article}`;
  }
  const segment = String(raw.SegmentPath || raw.GASegmentPath || '').trim();
  const folder = String(raw.ProductAssociatedFolder || '').trim();
  if (segment && folder && safe.test(segment) && safe.test(folder) && !folder.includes('..')) {
    return `https://learn.microsoft.com/en-us/power-platform/release-plan/${segment}/${folder}`;
  }
  return '';
}

// Product documentation link, accepted only from Microsoft Learn over https.
function docsUrl(raw) {
  const value = String(raw.DocsUrl || '').trim();
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'learn.microsoft.com' ? u.toString() : '';
  } catch {
    return '';
  }
}

function featureKey(raw) {
  return String(raw.ReleasePlanID || raw.SnapshotId || `${raw.FeatureName}|${raw.ProductId}`);
}

// Normalize a raw Release Planner record into the compact shape the briefing
// page and the snapshot store share.
function normalizeFeature(raw) {
  if (!raw || !raw.FeatureName) return null;
  const product = PRODUCT_BY_ID.get(raw.ProductId);
  const benefit = firstSentence(htmlToText(raw.BusinessValue) || htmlToText(raw.FeatureDetails), 220);
  return {
    id: featureKey(raw),
    name: decodeEntities(raw.FeatureName).trim(),
    product: product ? product.name : decodeEntities(raw.Product || ''),
    productId: String(raw.ProductId || ''),
    area: product ? product.area : 'other',
    productArea: decodeEntities(raw.ProductArea || ''),
    previewDate: parsePlannerDate(raw.PublicPreviewDate),
    gaDate: parsePlannerDate(raw.GADate),
    wave: decodeEntities(raw.GAReleaseWaveName || raw.ReleaseWaveName || ''),
    enabledFor: decodeEntities(raw.EnabledFor || ''),
    benefit,
    url: learnUrl(raw),
    docsUrl: docsUrl(raw),
  };
}

function normalizeFeatures(results) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(results) ? results : []) {
    if (/^ai builder$/i.test(String(raw && raw.Product || ''))) continue;
    const feature = normalizeFeature(raw);
    if (!feature || seen.has(feature.id)) continue;
    seen.add(feature.id);
    out.push(feature);
  }
  return out;
}

// Week key = the UTC date of the Monday that starts the ISO week containing `date`.
function weekKey(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (isNaN(d.getTime())) throw new Error('Invalid date for weekKey');
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay(); // 0 = Sunday
  const offset = dow === 0 ? -6 : 1 - dow;
  return new Date(utc.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
}

// The briefing week a given moment belongs to. Weekend prep counts toward the
// coming Monday's email, matching defaultBriefingDate() in briefing-model.js.
function currentBriefingWeek(now) {
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  return weekKey(new Date(t + 2 * DAY_MS));
}

// Validate a client-supplied briefing week: a Monday no later than the
// current briefing week. Returns the week or null.
function parseBriefingWeek(value, now) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s || d.getUTCDay() !== 1) return null;
  return s <= currentBriefingWeek(now) ? s : null;
}

function compactForSnapshot(feature) {
  return {
    id: feature.id,
    name: feature.name,
    product: feature.product,
    productId: feature.productId,
    area: feature.area,
    previewDate: feature.previewDate || '',
    gaDate: feature.gaDate || '',
    url: feature.url || '',
  };
}

function describeDateChange(from, to) {
  if (from === to) return null;
  if (!from) return 'dated';
  if (!to) return 'undated';
  return to > from ? 'slipped' : 'pulled-in';
}

// Compare a baseline snapshot with the current feature list. Only products
// present in BOTH (i.e. fetched successfully now and captured in the baseline)
// are compared, so a transient upstream failure never reads as "removed".
function diffSnapshots(baseline, current, comparableProductIds) {
  const comparable = new Set(comparableProductIds || []);
  const prevById = new Map();
  for (const f of (baseline && baseline.features) || []) {
    if (comparable.has(f.productId)) prevById.set(f.id, f);
  }
  const added = [];
  const changed = [];
  const currIds = new Set();
  for (const f of current || []) {
    if (!comparable.has(f.productId)) continue;
    currIds.add(f.id);
    const prev = prevById.get(f.id);
    if (!prev) { added.push(compactForSnapshot(f)); continue; }
    const changes = [];
    for (const field of ['previewDate', 'gaDate']) {
      const kind = describeDateChange(prev[field] || '', f[field] || '');
      if (kind) changes.push({ field, from: prev[field] || '', to: f[field] || '', kind });
    }
    if (changes.length) changed.push({ feature: compactForSnapshot(f), changes });
  }
  const removed = [];
  for (const [id, f] of prevById) {
    if (!currIds.has(id)) removed.push(f);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  added.sort(byName);
  removed.sort(byName);
  changed.sort((a, b) => byName(a.feature, b.feature));
  return { added, removed, changed };
}

// ── Snapshot store ──────────────────────────────────────────────────────────
// One JSON file per week: snapshot-YYYY-MM-DD.json (the week's Monday). The
// first complete fetch of a week becomes that week's snapshot and is never
// overwritten, so diffs stay stable for the whole week.
function createSnapshotStore(options) {
  const dir = options.dir;
  const retainWeeks = Math.max(2, options.retainWeeks || 12);

  function listWeeks(done) {
    fs.readdir(dir, (err, entries) => {
      if (err) return done(err.code === 'ENOENT' ? null : err, []);
      const weeks = entries
        .map(name => SNAPSHOT_FILE_RE.exec(name))
        .filter(Boolean)
        .map(m => m[1])
        .sort();
      done(null, weeks);
    });
  }

  function fileFor(week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('Invalid snapshot week');
    return path.join(dir, `snapshot-${week}.json`);
  }

  function read(week, done) {
    fs.readFile(fileFor(week), 'utf8', (err, raw) => {
      if (err) return done(err);
      try {
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.features)) throw new Error('Malformed snapshot');
        done(null, data);
      } catch (e) {
        done(e);
      }
    });
  }

  // Latest readable snapshot strictly older than `week`. A corrupt file is
  // skipped in favor of the next-oldest week rather than failing the diff.
  function readBaseline(week, done) {
    listWeeks((err, weeks) => {
      if (err) return done(err);
      const older = weeks.filter(w => w < week).reverse();
      const tryNext = (i) => {
        if (i >= older.length) return done(null, null);
        read(older[i], (e, data) => (e ? tryNext(i + 1) : done(null, data)));
      };
      tryNext(0);
    });
  }

  function prune(done) {
    listWeeks((err, weeks) => {
      if (err || weeks.length <= retainWeeks) return done();
      const stale = weeks.slice(0, weeks.length - retainWeeks);
      let pending = stale.length;
      stale.forEach(w => fs.unlink(fileFor(w), () => { if (--pending === 0) done(); }));
    });
  }

  // Save `snapshot` for `week` unless one already exists. Calls back with
  // { created: boolean }.
  function saveIfAbsent(week, snapshot, done) {
    const target = fileFor(week);
    const payload = JSON.stringify(snapshot);
    fs.mkdir(dir, { recursive: true }, (mkErr) => {
      if (mkErr) return done(mkErr);
      attempt(true);
    });

    // 'wx' = exclusive create, so a concurrent or later writer can never
    // replace a week's valid snapshot. Works on SMB-backed App Service
    // storage, where hard links are not supported.
    function attempt(canRepair) {
      fs.writeFile(target, payload, { flag: 'wx' }, (wErr) => {
        if (!wErr) return prune(() => done(null, { created: true }));
        if (wErr.code !== 'EEXIST') {
          // Don't leave a truncated file behind to block the week.
          return fs.unlink(target, () => done(wErr));
        }
        if (!canRepair) return done(null, { created: false });
        repairIfCorrupt(() => attempt(false));
      });
    }

    // A file left by an interrupted write would otherwise block the week
    // forever. Only files old enough not to be an in-flight write are removed.
    function repairIfCorrupt(retry) {
      read(week, (readErr) => {
        if (!readErr) return done(null, { created: false });
        fs.stat(target, (statErr, st) => {
          if (statErr || Date.now() - st.mtimeMs < CORRUPT_GRACE_MS) return done(null, { created: false });
          fs.unlink(target, (unlinkErr) => (unlinkErr ? done(null, { created: false }) : retry()));
        });
      });
    }
  }

  return { dir, listWeeks, read, readBaseline, saveIfAbsent };
}

function defaultSnapshotDir(env, baseDir) {
  if (env.BRIEFING_SNAPSHOT_DIR) return path.resolve(env.BRIEFING_SNAPSHOT_DIR);
  // App Service: /home is persistent and writable even when wwwroot is a
  // read-only run-from-package mount.
  if (env.WEBSITE_INSTANCE_ID && env.HOME) return path.join(env.HOME, 'data', 'briefing-snapshots');
  return path.join(baseDir, 'data', 'briefing-snapshots');
}

module.exports = {
  BRIEFING_PRODUCTS,
  createSnapshotStore,
  compactForSnapshot,
  currentBriefingWeek,
  defaultSnapshotDir,
  diffSnapshots,
  firstSentence,
  htmlToText,
  learnUrl,
  normalizeFeature,
  normalizeFeatures,
  parseBriefingWeek,
  parsePlannerDate,
  weekKey,
};
