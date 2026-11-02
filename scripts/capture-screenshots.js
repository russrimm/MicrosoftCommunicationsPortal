// One-shot Playwright capture for the README screenshot gallery.
// Usage: node scripts/capture-screenshots.js  (server must be running on :3000)

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT  = path.join(__dirname, '..', 'screenshots');

const PAGES = [
  { slug: 'home',                 url: '/home' },
  { slug: 'power-platform',       url: '/powerplatform' },
  { slug: 'feature-geography',    url: '/featuregeo' },
  { slug: 'm365-roadmap',         url: '/m365updates' },
  { slug: 'azure-updates',        url: '/azureupdates' },
  { slug: 'message-center',       url: '/messagecenter' },
  { slug: 'service-health',       url: '/servicehealth' },
  { slug: 'azure-service-health', url: '/azureservicehealth' },
  { slug: 'fabric-roadmap',       url: '/fabricroadmap' },
  { slug: 'guided-report',        url: '/guidedreport' },
  { slug: 'weekly-briefing',      url: '/weeklybriefing' },
];

// Extra element-level captures: the generated Monday email is the weekly
// briefing's main deliverable, so it gets its own full-height image.
const ELEMENT_SHOTS = [
  { slug: 'weekly-briefing-email', url: '/weeklybriefing', selector: '#wb-preview', maxHeight: 1500 },
];

// ONLY=home,weekly-briefing re-captures just those slugs.
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(s => s.trim())) : null;
const wanted = (slug) => !ONLY || ONLY.has(slug);

const THEMES = ['light', 'dark'];

async function openPage(page, url, theme) {
  const sep = url.includes('?') ? '&' : '?';
  const target = `${BASE}${url}${sep}clawpilotTheme=${theme}`;
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  // Wait for any visible "Loading…" banner / spinner to clear. The Power
  // Platform page in particular fans out ~20 upstream calls and may take
  // 30–45s to settle on a cold cache.
  try {
    await page.waitForFunction(() => {
      const txt = (document.body && document.body.innerText) || '';
      if (/Loading\u2026?\s*selected products/i.test(txt)) return false;
      if (/^\s*Loading[\u2026.\s]*$/m.test(txt)) return false;
      // The weekly briefing shows load progress through data-state="loading".
      if (document.querySelector('[data-state="loading"]')) return false;
      // Any visible element with "loading" in its class or id
      const stillLoading = Array.from(document.querySelectorAll('[class*="loading" i],[id*="loading" i]'))
        .some(el => el.offsetParent !== null && getComputedStyle(el).display !== 'none');
      return !stillLoading;
    }, { timeout: 45000 });
  } catch {
    process.stdout.write('(loading banner still visible after 45s) ');
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  return target;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  let saved = 0;
  for (const { slug, url } of PAGES.filter(p => wanted(p.slug))) {
    for (const theme of THEMES) {
      const file = `${slug}-${theme}.png`;
      process.stdout.write(`Capturing ${url} (${theme}) -> ${file} ... `);
      await openPage(page, url, theme);
      await page.screenshot({
        path: path.join(OUT, file),
        fullPage: false,
      });
      saved++;
      console.log('ok');
    }
  }

  for (const { slug, url, selector, maxHeight } of ELEMENT_SHOTS.filter(s => wanted(s.slug))) {
    for (const theme of THEMES) {
      const file = `${slug}-${theme}.png`;
      process.stdout.write(`Capturing ${selector} on ${url} (${theme}) -> ${file} ... `);
      await openPage(page, url, theme);
      const target = page.locator(selector);
      const box = await target.boundingBox();
      if (maxHeight && box && box.height > maxHeight) {
        // Crop long elements to their top so README images stay readable. The
        // preview sits in a scrollable pane, so release its ancestors first.
        await page.evaluate((sel) => {
          for (let el = document.querySelector(sel); el && el !== document.body; el = el.parentElement) {
            el.style.overflow = 'visible';
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
          }
        }, selector);
        const free = await target.boundingBox();
        await page.screenshot({
          path: path.join(OUT, file),
          fullPage: true,
          clip: { x: free.x, y: free.y, width: free.width, height: maxHeight },
        });
      } else {
        await target.screenshot({ path: path.join(OUT, file) });
      }
      saved++;
      console.log('ok');
    }
  }

  await browser.close();
  console.log(`\nSaved ${saved} screenshots to ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
