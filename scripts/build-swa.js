// Stage the static front end for Azure Static Web Apps.
//
//   node scripts/build-swa.js [--out dist]
//
// What it does:
//   1. Copies the HTML pages plus /static and /public into the output folder.
//   2. Hashes every attribute-less inline <script> block and injects the
//      resulting sha256 values into the Content-Security-Policy in
//      staticwebapp.config.json. Static Web Apps serves HTML straight from
//      storage, so server.js's per-request CSP nonce cannot run — hashes give
//      the same guarantee without falling back to 'unsafe-inline'.
//   3. Substitutes the Entra ID tenant into the auth registration, or drops the
//      custom registration when no tenant is supplied.
//   4. Emits auth-required.json, the body returned for edge-rejected requests.
//
// Environment:
//   ENTRA_TENANT_ID / AZURE_TENANT_ID  Tenant for the custom Entra ID provider.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Mirrors the pageMap in server.js. Keep the two in sync.
const PAGES = [
  'home.html',
  'powerplatform.html',
  'messagecenter.html',
  'servicehealth.html',
  'azureservicehealth.html',
  'm365updates.html',
  'azureupdates.html',
  'fabricroadmap.html',
  'featuregeo.html',
  'guidedreport.html',
];

// Only ship asset types the site actually references. Anything else in
// public/ or static/ (scratch files, editor leftovers) stays out of the deploy.
const ASSET_EXTENSIONS = new Set([
  '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
]);

const INLINE_SCRIPT_RE = /<script>([\s\S]*?)<\/script>/g;
const HASH_PLACEHOLDER = '__INLINE_SCRIPT_HASHES__';
const TENANT_PLACEHOLDER = '__ENTRA_TENANT_ID__';

function parseArgs(argv) {
  const args = { out: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

function copyAssetTree(sourceDir, targetDir) {
  let copied = 0;
  let skipped = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      const nested = copyAssetTree(from, to);
      copied += nested.copied;
      skipped += nested.skipped;
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      skipped++;
      continue;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
  return { copied, skipped };
}

// A CSP hash must match the script text the browser sees, not the bytes on disk.
// HTML input stream preprocessing rewrites every CRLF and lone CR to LF before
// tokenising, so hashing raw CRLF files blocks every inline script. Normalising
// here also keeps hashes identical between Windows checkouts and LF-only CI.
function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const text = match[1].replace(/\r\n?/g, '\n');
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function buildConfig(sourceConfigPath, hashes, tenantId) {
  const raw = fs.readFileSync(sourceConfigPath, 'utf8');
  if (!raw.includes(HASH_PLACEHOLDER)) {
    throw new Error(
      `${path.basename(sourceConfigPath)} no longer contains ${HASH_PLACEHOLDER}; ` +
      'the Content-Security-Policy would ship without inline-script hashes.'
    );
  }
  const config = JSON.parse(raw.replace(HASH_PLACEHOLDER, hashes.join(' ')));

  if (tenantId) {
    const registration =
      config.auth?.identityProviders?.azureActiveDirectory?.registration;
    if (!registration) {
      throw new Error('staticwebapp.config.json is missing the azureActiveDirectory registration.');
    }
    registration.openIdIssuer = registration.openIdIssuer.replace(TENANT_PLACEHOLDER, tenantId);
  } else {
    // Leaving the placeholder in place would ship a broken issuer URL. Dropping
    // the custom registration re-enables the preconfigured providers instead.
    delete config.auth;
  }
  return config;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  const tenantId = (process.env.ENTRA_TENANT_ID || process.env.AZURE_TENANT_ID || '').trim();

  if (tenantId && !/^[0-9a-zA-Z.-]{1,120}$/.test(tenantId)) {
    throw new Error(`Refusing to build: tenant id "${tenantId}" is not a valid tenant identifier.`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const hashes = new Set();
  for (const page of PAGES) {
    const source = path.join(ROOT, page);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing page ${page} — update PAGES in scripts/build-swa.js.`);
    }
    const html = fs.readFileSync(source, 'utf8');
    const pageHashes = inlineScriptHashes(html);
    if (pageHashes.length === 0) {
      console.warn(`  ! ${page}: no attribute-less inline <script> blocks found`);
    }
    for (const hash of pageHashes) hashes.add(hash);
    fs.copyFileSync(source, path.join(outDir, page));
    console.log(`  page  ${page.padEnd(26)} inline scripts: ${pageHashes.length}`);
  }

  const staticAssets = copyAssetTree(path.join(ROOT, 'static'), path.join(outDir, 'static'));
  const publicAssets = copyAssetTree(path.join(ROOT, 'public'), path.join(outDir, 'public'));

  const config = buildConfig(
    path.join(ROOT, 'staticwebapp.config.json'),
    [...hashes],
    tenantId
  );
  fs.writeFileSync(
    path.join(outDir, 'staticwebapp.config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );

  // Body for requests the Static Web Apps edge rejects before they reach the
  // backend. Matches the JSON shape server.js returns so the UI can treat both
  // the same way.
  fs.writeFileSync(
    path.join(outDir, 'auth-required.json'),
    JSON.stringify({
      error: 'Authentication required. Sign in at /.auth/login/aad and retry.',
      code: 'AUTH_REQUIRED',
    }, null, 2) + '\n'
  );

  console.log(`  static/ ${staticAssets.copied} files (${staticAssets.skipped} skipped)`);
  console.log(`  public/ ${publicAssets.copied} files (${publicAssets.skipped} skipped)`);
  console.log(`  CSP inline-script hashes: ${hashes.size}`);
  console.log(`  Entra ID registration: ${tenantId ? `custom (tenant ${tenantId})` : 'preconfigured providers'}`);
  console.log(`\nStatic Web Apps payload ready in ${outDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\nbuild-swa failed: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { PAGES, inlineScriptHashes, buildConfig };
