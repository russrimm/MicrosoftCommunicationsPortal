# Product & Engineering Audit — 2026-07-31

## Audit record

| Field | Value |
|---|---|
| Repository | `russrimm/MicrosoftCommunicationsPortal` |
| Branch | `russrimm-audit-portal-hardening` |
| Baseline | `72b7760` |
| Security/reliability commit | `8c23d11` — `Harden portal security and reliability` |
| Product/performance commit | `c5cbd2e` — `Improve feed freshness and filter workflows` |
| Final test count | 49 passing |
| Cloud operations | None |
| Credentials used | None |

This document records two accepted, autonomous audit passes over the Microsoft
Communications Portal. The first pass focused on security, tenant isolation,
correctness, accessibility, resilience, delivery, and operational hardening.
The second pass was intentionally non-duplicative and focused on expected
product capabilities and measurable runtime performance.

## Constraints observed

- No credentials were read or used.
- Secret-bearing `.env*` files were not read; only `.env.example` was reviewed.
- No Azure, Microsoft 365, Fabric, Power Platform, Graph, or ARM resource was
  deployed or modified.
- No speculative major feature or data-model decision was made.
- Changes were limited to high-confidence, low-risk improvements that could be
  validated locally.
- Existing export-filter behavior from PR #7 and linked Message Center export
  IDs from PR #8 were preserved rather than reimplemented.

## Executive summary

The audit closed a remotely reachable tenant-data authentication bypass,
prevented Easy Auth header spoofing when App Service authentication is not
actually enforced, removed client-facing ARM identifier leakage, strengthened
AI cost and failure controls, fixed several broken frontend workflows, and
hardened CI, Docker, and Azure configuration.

The product/performance pass then made public filters shareable, exposed data
source and freshness state, added real cache-bypassing refresh, introduced
bounded stale-data fallback and actionable offline states, compressed large
public API payloads, and fixed the shared event-delegation loading contract.

A live Microsoft 365 Roadmap response measured:

- **1,380,214 bytes** without compression.
- **292,531 bytes** with gzip.
- Approximately **78.8% less transferred data**.

## Pass 1 — Security, reliability, delivery, and UX hardening

### Authentication and tenant-data isolation

- Removed the bare `/servicemessages` route. It bypassed the universal
  `/api/*` authentication guard while returning tenant-specific Microsoft 365
  Message Center data. The supported routes remain `/api/messagecenter` and
  `/api/servicemessages`.
- Added a live-server regression check confirming `/servicemessages` returns
  HTTP 404.
- App Service Easy Auth requests now fail closed with
  `AUTH_NOT_ENFORCED` unless the read-only platform signal
  `WEBSITE_AUTH_ENABLED` is exactly `True`.
- Spoofed `X-MS-CLIENT-PRINCIPAL` and
  `X-MS-CLIENT-PRINCIPAL-ID` headers are rejected before principal parsing when
  App Service authentication is disabled or absent.
- Valid Easy Auth principals remain supported when platform enforcement is
  enabled.
- The off-App-Service Easy Auth-compatible proxy mode remains supported.
- Public feed routes remain available for intentionally public-only
  deployments, including `/api/featuregeo`.
- Reverse-proxy bearer tokens and admin tokens continue to use constant-time
  comparison through one shared helper.

### Error privacy and tenant-data handling

- Added a shared upstream-error redactor for GUIDs and email addresses.
- Applied redaction to every client-facing ARM error path:
  subscriptions, emerging issues, events, availability statuses, impacted
  resources, resource events, resource availability, and current resource
  status.
- ARM managed-identity error bodies are logged server-side only; clients receive
  generic diagnostic messages.
- Graph error redaction now uses the same shared implementation.
- Subscription display names and IDs are no longer written to routine
  selection-update logs.
- AI provider error bodies are no longer echoed to clients.

### API validation and resilience

- Oversized JSON bodies now stop buffering, return HTTP 413, and cannot invoke
  the completion callback more than once.
- `/api/summarize` retains its tighter 256 KB request cap; general JSON requests
  retain the 1 MB cap.
- Rate-limit buckets are isolated by fixed server-defined policy
  (`IP + limit + window`) rather than allowing traffic to one tier to exhaust
  another tier.
- Invalid AI numeric configuration no longer produces `NaN` and silently
  disables limits.
- AI digest `limit` and `windowDays` values are bounded and use safe defaults.
- AI digest source failures no longer return a successful “No items” response.
  Source failures return a clear 502 instead.
- ARM current-status errors no longer pass the raw upstream body through.
- Message Center and Service Health retain request coalescing and token caching.
- The server reuses the shared constant-time helper rather than maintaining a
  duplicate implementation.

### AI safety and cost controls

- Invalid `LLM_DAILY_LIMIT` values fall back to 200; values below 1 clamp to 1.
- Daily budget exhaustion returns HTTP 429 with `AI_DAILY_LIMIT`.
- Provider failures return HTTP 502 with `AI_UPSTREAM_ERROR` and a generic
  client message.
- Existing prompt-injection fencing, strict JSON output requests, per-IP limits,
  item caps, token caps, timeouts, and input hashing were retained.
- `.env.example` now documents `LLM_DAILY_LIMIT`.
- Documentation now makes clear that configured feed content, including
  tenant-specific data, is sent to the selected AI provider.

### Frontend correctness and accessibility

- Fixed a duplicate `const messageId` declaration that broke the entire Message
  Center inline script and export workflow.
- Replaced a CSP-blocked inline Service Health heatmap picker handler with
  delegated click and keyboard handling.
- Removed an obsolete Guided Report theme script that accessed a nonexistent
  button and threw on page load.
- Added Escape-to-close and focus restoration to roadmap filters, Message
  Center filters, Azure subscription filters, and global navigation menus.
- Added focus trapping and restoration to the subscription picker.
- Added keyboard focus/blur behavior to geography map tooltips.
- Added accessible labels to Guided Report fields.
- Added `role="status"` and polite live regions to result counts and AI digest
  output.
- Added an AI request token and disabled state so overlapping “Regenerate”
  actions cannot display stale results.
- Added a global reduced-motion rule.
- Replaced the missing favicon response with the existing checked-in site icon.
- Corrected Home page source labels and communication-stream counts.

### Docker and dependency hardening

- Production image installation now uses:
  `npm ci --omit=dev --ignore-scripts`.
- Corrected lockfile drift so `pptxgenjs` and its transitive packages are
  development-only.
- Corrected the lockfile Node engine from `>=18` to `>=24`, matching
  `package.json`.
- The production dependency tree now contains only `dotenv`.
- Clarified that `node:24-alpine` is a mutable major-line tag rather than an
  immutable image pin.
- Docker Compose now treats `.env` as genuinely optional using
  `required: false`.
- Existing non-root execution and container health checks were retained.
- `npm audit` reported zero vulnerabilities.

### CI and supply-chain hardening

- Added a CI test job that runs `npm ci` and `npm test`.
- Docker image publication now depends on the test job.
- Pull requests run application and Bicep validation without publishing an
  image.
- CI compiles `infra/main.bicep`.
- Workflow triggers include root JavaScript, tests, infrastructure, Compose,
  Azure configuration, Docker configuration, and workflow changes.
- Default workflow permissions are read-only; package write permission is
  isolated to the publish job.
- All GitHub Actions are pinned to verified full commit SHAs:
  `actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`,
  `docker/login-action`, `docker/metadata-action`, and
  `docker/build-push-action`.

### Azure configuration hardening

- Added App Service `healthCheckPath: '/healthz'`.
- Corrected the Microsoft Entra v2 issuer to use the cloud-portable
  `environment().authentication.loginEndpoint`.
- Allowed both raw client ID and `api://<client-id>` token audiences.
- Easy Auth remains optional for public-feed-only deployments.
- When Easy Auth is omitted, protected Graph, ARM, and AI endpoints fail closed
  in application code.
- The Entra setup script can reuse the exact `AUTH_CLIENT_ID` instead of relying
  only on a display-name match.
- The setup script idempotently registers the App Service
  `/.auth/login/aad/callback` redirect URI.
- If an `azd` deployment omitted Easy Auth, the script prints the exact commands
  needed to enable it on the next deployment.
- The Bicep build completes without warnings.

## Pass 2 — Product capabilities and measurable performance

### Cache behavior

- Extracted a reusable, bounded TTL cache with explicit metadata.
- Added and tested cache states:
  `miss`, `hit`, `coalesced`, and `stale`.
- Forced refresh bypasses a valid cache entry and updates the cache.
- Concurrent requests for the same key coalesce into one upstream request.
- Stale fallback is allowed only within a configured maximum age.
- Synchronous fetcher exceptions clear in-flight state and do not permanently
  wedge a cache key.
- Expired entries are evicted before oldest-entry eviction.
- Callback errors are surfaced through the configured server error reporter.

### Public feed refresh and stale-data behavior

- Microsoft 365 Roadmap, Azure Updates, Fabric Roadmap, and Feature Geography
  accept `?refresh=1`.
- Refresh buttons use `cache: 'no-store'` and a unique request URL to bypass the
  browser cache.
- The server ignores cache-busting query values when selecting its internal
  cache key, avoiding cache fragmentation.
- Forced refresh responses send `Cache-Control: no-store`.
- Public RSS and Fabric feeds can serve stale data for up to 24 hours after a
  transient refresh failure.
- Feature Geography can serve stale data for up to 7 days.
- Stale responses include:
  - `Warning: 110 - "Response is stale"`
  - `X-Cache: stale`
  - `X-Data-Fetched-At`
  - `meta.stale: true`
  - A visible UI warning state.
- Fabric reports partial upstream product coverage rather than silently
  presenting it as complete.

### Response compression and cache headers

- Public M365, Azure, Fabric, and geography APIs now use the shared asynchronous
  JSON response path.
- Responses over 4 KB support gzip and deflate.
- CORS responses correctly vary on both `Origin` and `Accept-Encoding`.
- Public feed responses include additive metadata:
  source, cache state, fetch time, stale state, and warning.
- Live validation confirmed:
  - First request: cache `miss`.
  - Second request: cache `hit`.
  - Manual refresh: cache `miss`.
  - Manual refresh response: `Cache-Control: no-store`.

### Shareable filter state

- Microsoft 365 Roadmap, Azure Updates, and Fabric Roadmap now reflect their
  public-data filter state in the URL.
- Supported shareable state includes search, sort, grouping, timeframe, status,
  product, and release type where applicable.
- Reloading a URL restores the same filter state.
- Repeated query parameters preserve multi-select values.
- Invalid or obsolete filter values are pruned against the current source data.
- Theme parameters, hashes, and unrelated query parameters are preserved.
- Tenant-specific Message Center and ARM filter/search state is intentionally
  excluded from URLs to avoid browser-history and link-sharing privacy risks.

### Freshness, offline, and export UX

- Public roadmap and geography pages display:
  source, fetch time, and fresh/cached/partial/stale/unavailable state.
- Manual refresh buttons disable while a request is active.
- Offline and source failures show an actionable Retry control.
- Export controls start disabled and remain disabled when no filtered rows are
  available on:
  Microsoft 365 Roadmap, Azure Updates, Fabric Roadmap, Power Platform,
  Message Center, and Feature Geography CSV.
- Export controls include an explanatory title when disabled.

### Delegated controls and rendering performance

- Removed `defer` from `static/util.js` on all ten pages.
- This aligns implementation with the file’s synchronous-loading contract and
  ensures `CPActions` exists before inline page scripts register
  argument-bearing handlers.
- Filter dropdowns now call their intended registered handlers instead of
  falling back to incompatible global functions.
- Added `content-visibility: auto` and intrinsic card sizing to reduce
  offscreen layout/paint work for large roadmap result sets.

## Validation evidence

### Automated checks

- **49/49 Node tests passed.**
- All root/server JavaScript passed `node --check`.
- Every inline script from all ten HTML pages passed syntax parsing.
- Every non-vendored standalone script passed syntax checks.
- Bicep compiled without warnings.
- PowerShell 7 parsed the Entra setup script successfully.
- Workflow YAML parsed successfully.
- `docker compose config` succeeded without an `.env` file.
- GitHub Action pins matched their documented release tags.
- Diff and staged secret scans found no high-confidence credential patterns.
- `git diff --check` passed.
- Final read-only reviews reported no significant defects.

### Live server and browser checks

- All ten portal routes returned HTTP 200.
- `/servicemessages` returned HTTP 404.
- `/favicon.ico` returned HTTP 200 with `image/png`.
- App Service Easy Auth spoof attempts returned HTTP 401 with
  `AUTH_NOT_ENFORCED`.
- Oversized AI requests returned HTTP 413.
- Rate-limit tiers did not interfere with each other.
- Desktop matrix: 1440 × 900.
- Mobile matrix: 390 × 844.
- All ten routes loaded without page errors or horizontal overflow.
- Filter URLs restored and survived reload.
- Manual refresh produced a server cache miss and `no-store`.
- Simulated offline mode displayed “Unavailable” plus Retry.
- Argument-bearing delegated filter controls opened correctly.
- Zero-result filters disabled export.

## Complete file inventory

| File | Changes |
|---|---|
| `.env.example` | Documented AI budget; corrected trusted proxy/XFF guidance. |
| `.github/workflows/docker-publish.yml` | Added PR/test/Bicep gates, least privilege, full SHA pins, complete path triggers. |
| `Dockerfile` | Added lifecycle-script blocking; corrected mutable base-image documentation. |
| `README.md` | Corrected feature/page counts and Azure auth guidance; documented security, AI privacy, filters, cache states, refresh, stale fallback, and compression. |
| `auth.js` | Added Easy Auth enforcement guard, shared redaction, public Feature Geography exemption, and shared token comparison exports. |
| `azureupdates.html` | Accessibility, freshness, forced refresh, offline retry, URL state, export disabling, synchronous utilities. |
| `fabricroadmap.html` | Accessibility, partial/freshness visibility, forced refresh, offline retry, URL state, export disabling, synchronous utilities. |
| `featuregeo.html` | Keyboard tooltips, source/freshness state, forced refresh, offline retry, export disabling, synchronous utilities. |
| `m365updates.html` | Accessibility, freshness, forced refresh, offline retry, URL state, export disabling, synchronous utilities. |
| `messagecenter.html` | Fixed script-breaking declaration; accessibility and export disabling; synchronous utilities. |
| `powerplatform.html` | Accessibility and export disabling; synchronous utilities. |
| `servicehealth.html` | Replaced CSP-blocked inline picker behavior; added keyboard support; synchronous utilities. |
| `azureservicehealth.html` | Escape/focus behavior; synchronous utilities. |
| `guidedreport.html` | Accessible labels; removed broken theme handler; synchronous utilities. |
| `home.html` | Corrected source/count metadata; synchronous utilities. |
| `docker-compose.yml` | Made `.env` optional. |
| `infra/main.bicep` | Made Easy Auth client ID optional for public-only deployments while protected APIs fail closed. |
| `infra/modules/appservice.bicep` | Health check, corrected Entra issuer/audiences, conditional Easy Auth. |
| `package-lock.json` | Corrected production/dev dependency and Node engine metadata. |
| `runtime-utils.js` | Added bounded integer parsing, rate-limit keys, Vary merging, and reusable TTL cache. |
| `scripts/create-entra-app.ps1` | Exact app reuse, callback registration, and Easy Auth follow-up guidance. |
| `scripts/test-auth.js` | Expanded auth, redaction, limits, cache, live-server, rate-limit, 413, and route coverage to 49 tests. |
| `server.js` | Auth integration, cache extraction, refresh/stale metadata, compression reuse, error privacy, AI controls, route correctness, favicon, and public feed behavior. |
| `static/ai-insights.js` | Live region, request-race protection, and Regenerate disabled state. |
| `static/common.css` | Reduced-motion support. |
| `static/nav.js` | Escape-to-close and focus restoration. |
| `static/roadmap.css` | Source-state styles and offscreen card rendering optimization. |
| `static/subscription-picker.js` | Focus trap and restoration. |
| `static/util.js` | Query-state, source/freshness rendering, and existing shared action utilities loaded synchronously. |

## Accepted prioritized backlog

### 1. True list virtualization or incremental paging

The Microsoft 365 Roadmap feed is approximately 1.38 MB uncompressed and can
produce thousands of DOM nodes. `content-visibility` reduces offscreen
layout/paint work but not DOM construction or memory use.

Further work requires decisions for:

- Grouped views.
- Search across unloaded pages.
- AI deep links.
- Exporting the full filtered set versus the rendered page.
- Keyboard and screen-reader navigation across virtual rows.

### 2. Stable deep-link schemas for complex pages

Power Platform and Feature Geography could support URL state, but they need
stable schemas for date ranges, categories, maps, and upstream-derived product
or geography indexes. Numeric upstream indexes must not become permanent public
URL identifiers.

Tenant-specific Message Center and ARM search/filter state also requires an
explicit privacy decision before appearing in URLs or browser history.

### 3. Persistent and distributed cache

Current cache and stale fallback are process-local. Persistence across restarts
or coordination across multiple App Service instances requires Redis, storage,
or another shared cache plus retention and tenant-data policies.

### 4. Bookmarks and alerts

Bookmarks and alerts need:

- A user-owned preference model.
- Identity-to-preference authorization.
- Durable storage.
- Scheduling.
- Notification channels.
- Deduplication and acknowledgement semantics.

The current stateless architecture does not support these safely without a
product and data-model decision.

### 5. Production telemetry

Long-term measurement of cache hit ratio, upstream latency percentiles,
compression savings, stale-serving frequency, and AI budget exhaustion requires
structured metrics, App Insights instrumentation, dashboards, and alert
thresholds.

### 6. Service-specific retry and circuit-breaker policy

Automatic retries need per-service handling for:

- HTTP 429 and `Retry-After`.
- Idempotency.
- Backoff and jitter.
- Maximum latency budgets.
- Circuit-open behavior.
- Interaction with stale fallback.

Generic automatic retries were not added because they could amplify an
upstream outage.

### 7. Container immutability

Deferred until live container validation is available:

- Digest-pin `node:24-alpine`.
- Read-only root filesystem.
- Drop Linux capabilities.
- `no-new-privileges`.

These require an image update process and runtime compatibility validation.

### 8. Production Easy Auth assertion

The template configures the client ID and callback URI but does not automate a
client secret or a user-assigned managed-identity federated credential.
Microsoft recommends one of those assertion methods over the legacy implicit
flow. A production deployment should complete that identity-provider
configuration and verify an authenticated tenant endpoint end to end.

## External guidance used

- [App Service authentication settings](https://learn.microsoft.com/azure/app-service/reference-app-settings#authentication-and-authorization)
- [Configure Microsoft Entra sign-in for App Service](https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad)
- [App Service Health Check](https://learn.microsoft.com/azure/app-service/monitor-instances-health-check)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)

## Known validation limits

- Docker Compose configuration was validated, but a live Docker build/run was
  not possible because the local Docker Linux engine was unavailable.
- Graph, ARM, Message Center, Service Health, Azure Easy Auth, and managed
  identity could not be exercised against a real tenant without credentials.
- No cloud deployment was performed by design.
