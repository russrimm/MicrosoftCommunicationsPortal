// Unit tests for the Weekly Customer Briefing: server-side snapshot/diff
// helpers (briefing.js) and the browser model + email renderer, which are
// loaded into a Node `vm` context because they attach to `window`.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const briefing = require('../briefing.js');

const ROOT = path.join(__dirname, '..');
const POWER_PAGES = '1197f7de-0a44-ec11-8c62-00224829b77f';
const POWER_APPS = 'e72f17ac-715d-e911-a968-000d3a4e32b5';

// Values created inside the vm context have foreign prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadBrowserModules() {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ['briefing-model.js', 'briefing-email.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', file), 'utf8'), context, { filename: file });
  }
  return { BM: context.window.BriefingModel, BE: context.window.BriefingEmail };
}

function rawFeature(overrides) {
  return Object.assign({
    ReleasePlanID: 'rp-1',
    FeatureName: 'Configure site analytics &amp; server logging',
    ProductId: POWER_PAGES,
    Product: 'Power Pages',
    ProductArea: 'Administration and governance',
    PublicPreviewDate: '09/01/2026',
    GADate: '',
    BusinessValue: '<p>You can monitor your site traffic with ease. Track page views and more.</p>',
    ArticlePath: 'articles/2026wave1/power-pages/configure-site-analytics-server-logging',
    ReleaseWaveName: '2026 release wave 1',
  }, overrides);
}

// ── briefing.js ─────────────────────────────────────────────────────────────

test('weekKey returns the Monday that starts the ISO week', () => {
  assert.equal(briefing.weekKey(new Date('2026-10-04T12:00:00Z')), '2026-09-28'); // Sunday
  assert.equal(briefing.weekKey(new Date('2026-10-05T00:00:00Z')), '2026-10-05'); // Monday
  assert.equal(briefing.weekKey(new Date('2026-10-07T23:00:00Z')), '2026-10-05'); // Wednesday
});

test('briefing week treats weekend prep as the coming Monday and validates client weeks', () => {
  const sunday = new Date('2026-10-04T12:00:00Z');
  assert.equal(briefing.currentBriefingWeek(sunday), '2026-10-05');
  assert.equal(briefing.currentBriefingWeek(new Date('2026-10-03T12:00:00Z')), '2026-10-05'); // Saturday
  assert.equal(briefing.currentBriefingWeek(new Date('2026-10-09T12:00:00Z')), '2026-10-05'); // Friday
  assert.equal(briefing.parseBriefingWeek('2026-10-05', sunday), '2026-10-05');
  assert.equal(briefing.parseBriefingWeek('2026-09-28', sunday), '2026-09-28');
  assert.equal(briefing.parseBriefingWeek('2026-10-12', sunday), null); // future
  assert.equal(briefing.parseBriefingWeek('2026-10-06', sunday), null); // not a Monday
  assert.equal(briefing.parseBriefingWeek('2026-02-30', sunday), null); // invalid date
  assert.equal(briefing.parseBriefingWeek('../x', sunday), null);
});

test('parsePlannerDate accepts MM/DD/YYYY only', () => {
  assert.equal(briefing.parsePlannerDate('09/01/2026'), '2026-09-01');
  assert.equal(briefing.parsePlannerDate(''), '');
  assert.equal(briefing.parsePlannerDate('13/01/2026'), '');
  assert.equal(briefing.parsePlannerDate('Sep 2026'), '');
});

test('normalizeFeature trims business value, decodes names, and builds a Learn URL', () => {
  const f = briefing.normalizeFeature(rawFeature());
  assert.equal(f.id, 'rp-1');
  assert.equal(f.name, 'Configure site analytics & server logging');
  assert.equal(f.area, 'powerpages');
  assert.equal(f.previewDate, '2026-09-01');
  assert.equal(f.gaDate, '');
  assert.equal(f.benefit, 'You can monitor your site traffic with ease.');
  assert.equal(f.url, 'https://learn.microsoft.com/en-us/power-platform/release-plan/2026wave1/power-pages/configure-site-analytics-server-logging');

  const unsafe = briefing.normalizeFeature(rawFeature({ ArticlePath: 'articles/../../evil', SegmentPath: '', ProductAssociatedFolder: '' }));
  assert.equal(unsafe.url, '');
  const offsite = briefing.normalizeFeature(rawFeature({ DocsUrl: 'https://evil.example.com/x' }));
  assert.equal(offsite.docsUrl, '');
});

test('normalizeFeatures drops AI Builder, duplicates, and unnamed records', () => {
  const list = briefing.normalizeFeatures([
    rawFeature(),
    rawFeature(),
    rawFeature({ ReleasePlanID: 'rp-2', Product: 'AI Builder' }),
    rawFeature({ ReleasePlanID: 'rp-3', FeatureName: '' }),
  ]);
  assert.deepEqual(list.map(f => f.id), ['rp-1']);
});

test('diffSnapshots classifies added, removed, slipped, pulled-in, and dated features', () => {
  const feature = (id, productId, previewDate, gaDate) => ({ id, name: id, productId, area: 'x', previewDate, gaDate });
  const baseline = {
    features: [
      feature('slips', POWER_PAGES, '2026-07-01', '2026-09-01'),
      feature('pulls', POWER_PAGES, '', '2026-12-01'),
      feature('gone', POWER_PAGES, '2026-08-01', ''),
      feature('dated', POWER_PAGES, '', ''),
      feature('same', POWER_PAGES, '2026-08-01', ''),
      feature('other-product', POWER_APPS, '2026-08-01', ''),
    ],
  };
  const current = [
    feature('slips', POWER_PAGES, '2026-09-01', '2026-11-01'),
    feature('pulls', POWER_PAGES, '', '2026-10-01'),
    feature('dated', POWER_PAGES, '2026-10-01', ''),
    feature('same', POWER_PAGES, '2026-08-01', ''),
    feature('brand-new', POWER_PAGES, '2026-10-01', ''),
  ];
  // Power Apps failed to load this time, so it must not be reported as removed.
  const diff = briefing.diffSnapshots(baseline, current, [POWER_PAGES]);
  assert.deepEqual(diff.added.map(f => f.id), ['brand-new']);
  assert.deepEqual(diff.removed.map(f => f.id), ['gone']);
  const byId = Object.fromEntries(diff.changed.map(c => [c.feature.id, c.changes.map(x => x.kind)]));
  assert.deepEqual(byId, { dated: ['dated'], pulls: ['pulled-in'], slips: ['slipped', 'slipped'] });
});

test('snapshot store writes once per week and reads the latest older baseline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-snap-'));
  const store = briefing.createSnapshotStore({ dir, retainWeeks: 2 });
  const save = (week, marker) => new Promise((resolve, reject) =>
    store.saveIfAbsent(week, { week, productIds: [], features: [{ id: marker }] }, (e, r) => (e ? reject(e) : resolve(r))));
  const baselineFor = (week) => new Promise((resolve, reject) =>
    store.readBaseline(week, (e, r) => (e ? reject(e) : resolve(r))));
  try {
    assert.equal(await baselineFor('2026-09-28'), null);
    assert.deepEqual(await save('2026-09-14', 'a'), { created: true });
    assert.deepEqual(await save('2026-09-21', 'b'), { created: true });
    assert.deepEqual(await save('2026-09-21', 'b2'), { created: false });
    assert.equal((await baselineFor('2026-09-28')).features[0].id, 'b');
    assert.equal((await baselineFor('2026-09-21')).features[0].id, 'a');

    // A corrupt newest file falls back to the next-oldest snapshot.
    fs.writeFileSync(path.join(dir, 'snapshot-2026-09-27.json'), '{not json');
    assert.equal((await baselineFor('2026-09-28')).features[0].id, 'b');

    assert.deepEqual(await save('2026-09-28', 'c'), { created: true });
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ['snapshot-2026-09-27.json', 'snapshot-2026-09-28.json']);
    assert.throws(() => store.saveIfAbsent('../escape', {}, () => {}), /Invalid snapshot week/);

    // A truncated file from an interrupted write is replaced once it is old
    // enough not to be an in-flight write; a fresh one is left alone.
    const stuck = path.join(dir, 'snapshot-2026-10-05.json');
    fs.writeFileSync(stuck, '{"week":"2026-10');
    assert.deepEqual(await save('2026-10-05', 'd'), { created: false });
    const old = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(stuck, old, old);
    assert.deepEqual(await save('2026-10-05', 'd'), { created: true });
    assert.equal(JSON.parse(fs.readFileSync(stuck, 'utf8')).features[0].id, 'd');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('defaultSnapshotDir honors overrides and App Service persistent storage', () => {
  assert.equal(briefing.defaultSnapshotDir({ BRIEFING_SNAPSHOT_DIR: '/tmp/x' }, '/app'), path.resolve('/tmp/x'));
  assert.equal(briefing.defaultSnapshotDir({ WEBSITE_INSTANCE_ID: '1', HOME: '/home' }, '/app'),
    path.join('/home', 'data', 'briefing-snapshots'));
  assert.equal(briefing.defaultSnapshotDir({}, '/app'), path.join('/app', 'data', 'briefing-snapshots'));
});

// ── static/briefing-model.js ────────────────────────────────────────────────

const CAE_MESSAGE = {
  id: 'MC1446723',
  title: 'Power Platform - New Continuous Access Evaluation (CAE) rollout nearing completion',
  services: ['Microsoft Dataverse', 'Power Platform'],
  tags: ['Admin impact'],
  isMajorChange: false,
  actionRequiredByDateTime: null,
  startDateTime: '2026-08-03T16:35:53Z',
  lastModifiedDateTime: '2026-08-03T16:35:53Z',
  body: {
    contentType: 'html',
    content: 'The CAE rollout is entering its final stage. We expect to complete the rollout by the week of August 10, 2026.' +
      '<br><br><b>How does this affect me?</b><br>Dataverse user access is transitioning to CAE-enabled authentication. Sessions are evaluated continuously.' +
      '<br><br><b>What do I need to do to prepare?</b><br>Review your user-targeted CAE Conditional Access policies. Test Dataverse access for end users.',
  },
};

const AWARENESS_MESSAGE = {
  id: 'MC1446172',
  title: 'Copilot Studio - Block the use of maker-provided credentials for authentication',
  services: ['Microsoft Copilot (Power Platform)'],
  tags: ['New feature'],
  startDateTime: '2026-08-03T02:44:51Z',
  lastModifiedDateTime: '2026-08-03T02:44:51Z',
  body: {
    content: 'We are announcing the ability to block maker-provided credentials. This feature will reach general availability on August 25, 2026.' +
      '<br><br><b>How does this affect me?</b><br>Admins can restrict maker-provided credentials across all tools within an agent.' +
      '<br><br><b>What action do I need to take?</b><br>This message is for awareness, and no action is required. Visit <a href="https://learn.microsoft.com/power-platform/admin/security">the docs</a>.',
  },
};

test('parseMessage separates action items from awareness posts and extracts key dates', () => {
  const { BM } = loadBrowserModules();
  const cae = BM.parseMessage(CAE_MESSAGE);
  assert.equal(cae.area, 'dataverse');
  assert.equal(cae.isAction, true);
  assert.equal(cae.actionReason, 'prepare');
  assert.match(cae.actionText, /^Review your user-targeted CAE/);
  assert.equal(cae.summary, 'Dataverse user access is transitioning to CAE-enabled authentication. Sessions are evaluated continuously.');
  assert.deepEqual(plain(cae.keyDates.map(d => [d.label, d.date])), [['Rollout', '2026-08-10']]);
  assert.equal(cae.cleanTitle, 'New Continuous Access Evaluation (CAE) rollout nearing completion');
  assert.equal(cae.link, 'https://www.mspulse360.app/message/MC1446723');

  const aware = BM.parseMessage(AWARENESS_MESSAGE);
  assert.equal(aware.area, 'copilotstudio');
  assert.equal(aware.isAction, false);
  assert.equal(aware.actionText, '');
  assert.deepEqual(plain(aware.keyDates.map(d => [d.label, d.date])), [['GA', '2026-08-25']]);
  assert.equal(aware.learnUrl, 'https://learn.microsoft.com/power-platform/admin/security');
});

test('message scope, routine detection, and retirements', () => {
  const { BM } = loadBrowserModules();
  assert.equal(BM.isInScopeMessage({ title: 'Teams update', services: ['Microsoft Teams'] }), false);
  assert.equal(BM.isInScopeMessage({ title: 'Something', services: ['Power Platform'] }), true);
  const routine = BM.parseMessage({ id: 'MC1', title: 'Power Pages - Power Pages version 9.8.9.17 Production Release', services: ['Power Platform'] });
  assert.equal(routine.isRoutine, true);
  assert.equal(routine.area, 'powerpages');
  const retire = BM.parseMessage({
    id: 'MC2', title: 'Power Automate - Legacy chatbot retirement', services: ['Microsoft Power Automate'], tags: ['Retirement'],
    body: { content: 'Starting on September 2, 2026, the legacy chatbot will no longer be available.<br><b>What action do I need to take?</b><br>This message is for awareness, and no action is required.' },
  });
  assert.equal(retire.isAction, true);
  assert.equal(retire.actionReason, 'retirement');
  assert.deepEqual(plain(retire.keyDates.map(d => [d.label, d.date])), [['Retires', '2026-09-02']]);

  const versioned = BM.parseMessage({
    id: 'MC3', title: 'Microsoft Copilot Studio - End of support for the GPT-5.5 Chat model', services: ['Microsoft Copilot (Power Platform)'],
    body: { content: '<b>What action do I need to take?</b><br>Identify agents using the GPT-5.5 Chat model , then test them. Update prompts before <b>October 31, 2026</b> . Contact support if needed.' },
  });
  assert.equal(versioned.actionText, 'Identify agents using the GPT-5.5 Chat model, then test them. Update prompts before October 31, 2026. Contact support if needed.');
  assert.equal(versioned.cleanTitle, 'End of support for the GPT-5.5 Chat model');
});

test('briefing dates: weekend prep targets the coming Monday, release windows use whole months', () => {
  const { BM } = loadBrowserModules();
  assert.equal(BM.defaultBriefingDate(new Date(2026, 9, 4)), '2026-10-05'); // Sunday
  assert.equal(BM.defaultBriefingDate(new Date(2026, 9, 3)), '2026-10-05'); // Saturday
  assert.equal(BM.defaultBriefingDate(new Date(2026, 9, 7)), '2026-10-05'); // Wednesday
  const win = BM.monthWindow('2026-10-05', 2);
  assert.deepEqual({ start: win.start, end: win.end }, { start: '2026-10-01', end: '2026-12-01' });
  assert.equal(BM.monthRangeLabel(win), 'Oct – Nov 2026');
  const phase = BM.featurePhase({ previewDate: '2026-09-01', gaDate: '2026-11-01' }, win, '2026-10-05');
  assert.equal(phase.inWindow, true);
  assert.equal(phase.isGa, true);
  assert.equal(phase.label, 'GA Nov');
  assert.equal(BM.featurePhase({ previewDate: '2027-01-01', gaDate: '' }, win, '2026-10-05').inWindow, false);
});

// ── static/briefing-email.js ────────────────────────────────────────────────

test('email renderer escapes feed text, drops unsafe links, and stays Outlook-safe', () => {
  const { BM, BE } = loadBrowserModules();
  const area = BM.AREA_BY_KEY.copilotstudio;
  const view = {
    headline: 'Weekly <b>news</b>',
    dateLabel: 'Monday, October 5, 2026',
    greeting: 'Happy Monday!',
    intro: 'Intro <script>alert(1)</script>',
    stats: [{ value: 1, label: 'need attention' }],
    sectionOrder: ['actions', 'highlights', 'messages', 'releaseplan', 'resources'],
    actions: [{ cleanTitle: 'Do the thing', href: 'javascript:alert(1)', actionText: 'Review policies.', keyDates: [{ label: 'Act by', dateLabel: 'Oct 9' }] }],
    highlights: [{ text: 'Big news', href: 'https://learn.microsoft.com/x' }],
    messageGroups: [{ area, items: [{ id: 'MC1', cleanTitle: 'Item "one"', summary: 'Summary', href: 'https://admin.microsoft.com/x', keyDates: [] }] }],
    featureGroups: [{ area, items: [{ name: 'Feature', url: 'https://learn.microsoft.com/f', phaseLabel: 'GA Nov', benefit: 'Helps.' }] }],
    resources: [{ label: 'Guide', url: 'https://example.com/guide.pdf' }, { label: 'Bad', url: 'data:text/html,hi' }],
    signature: { name: 'Pat', email: 'pat@example.com', bookingUrl: 'https://outlook.office.com/book' },
  };
  const html = BE.buildHtml(view);
  assert.doesNotMatch(html, /<script|<style|javascript:|data:text/i);
  assert.match(html, /Weekly &lt;b&gt;news&lt;\/b&gt;/);
  assert.match(html, /Item &quot;one&quot;/);
  assert.match(html, /href="https:\/\/learn\.microsoft\.com\/f"/);
  assert.match(html, /href="mailto:pat@example\.com"/);
  assert.ok(html.indexOf('Action required') < html.indexOf('Top highlights'), 'sections follow sectionOrder');
  assert.doesNotMatch(html, /class="/, 'no class-based styling (Outlook strips it)');

  const text = BE.buildText(view);
  assert.match(text, /ACTION REQUIRED/);
  assert.match(text, /What to do: Review policies\./);
  assert.doesNotMatch(text, /Bad: data:/);
});

test('fallback draft leads with action items', () => {
  const { BM } = loadBrowserModules();
  const cae = BM.parseMessage(CAE_MESSAGE);
  const aware = BM.parseMessage(AWARENESS_MESSAGE);
  const draft = BM.fallbackDraft({ actionItems: [cae], messages: [cae, aware], features: [], featureCount: 4, windowLabel: 'Oct – Nov 2026' });
  assert.match(draft.intro, /2 new Message Center announcements/);
  assert.match(draft.intro, /1 item needs your attention/);
  assert.match(draft.intro, /4 release plan features are scheduled/);
  assert.equal(draft.highlights[0].itemId, cae.key);
  assert.equal(draft.highlights.length, 2);
});
