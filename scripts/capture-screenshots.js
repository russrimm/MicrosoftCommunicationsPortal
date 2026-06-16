// One-shot Playwright capture for the README screenshot gallery.
// Usage: node scripts/capture-screenshots.js  (server must be running on :3000)

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3010';
const OUT  = path.join(__dirname, '..', 'screenshots');

const PAGES = [
  { slug: 'power-platform', url: '/powerplatform' },
  { slug: 'm365-roadmap',   url: '/m365updates' },
  { slug: 'azure-updates',  url: '/azureupdates' },
  { slug: 'message-center', url: '/messagecenter' },
  { slug: 'service-health', url: '/servicehealth' },
];

const THEMES = ['light', 'dark'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  for (const { slug, url } of PAGES) {
    for (const theme of THEMES) {
      const file = `${slug}-${theme}.png`;
      const sep = url.includes('?') ? '&' : '?';
      const target = `${BASE}${url}${sep}clawpilotTheme=${theme}`;
      process.stdout.write(`Capturing ${target} -> ${file} ... `);
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
      await page.screenshot({
        path: path.join(OUT, file),
        fullPage: false,
      });
      console.log('ok');
    }
  }

  await browser.close();
  console.log(`\nSaved ${PAGES.length * THEMES.length} screenshots to ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
