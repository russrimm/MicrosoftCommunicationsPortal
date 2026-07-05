# Capabilities Audit — 2026-07-04

> Full team review of Microsoft Communications Portal v1.1.0. Verifies what the app actually does vs what's documented, then flags gaps and behaviors likely to be perceived as bugs.

**Audit team:** Ripley (Lead), Lambert (Frontend), Parker (Backend), Kane (Docs-truth)
**Requested by:** Russ Rimmerman
**Scope:** Everything in the repo — code, docs, scripts, static assets, config.

---

## 1. Executive Summary

**What works well**
- Clean architecture: single Node.js process, minimal dependencies (only `dotenv`), 5 aggregated data streams behind a proxy.
- Robust upstream handling: redirects, gzip/deflate, malformed-JSON recovery on the Power Platform feed, request coalescing on Graph token refresh, `empty-products.json` cache to skip known-empty product IDs.
- Good security hygiene: `.env` in `.gitignore`, binds to `127.0.0.1`, strict CSP headers (`frame-ancestors 'none'`, `form-action 'none'`), path-traversal protection on `/static/` and `/public/`, 1 MB body limit, upstream timeouts.
- Theming is consistent: all colors are `--cp-*` CSS custom properties, dark/light both work, FOUC prevention via inline `<script>` in `<head>`.

**What's broken or misleading**
- **README promises features that don't exist**: Canvas App (Code app type) deployment, Azure Management API for Azure Service/Resource Health.
- **`scripts/capture-screenshots.js` needs Playwright, which is not in `package.json`** — README tells users to run the script but omits the install step. This is the highest-severity concrete bug.
- **README claims product/service logos "on every card"** — only Power Platform and Service Health render them; M365 Roadmap, Azure Updates, and Message Center do not.
- **Server doesn't fail loudly at boot** when Graph credentials are missing (Parker's charter and general expectations both call for this). Instead, `/api/messagecenter` and `/api/servicehealth` return 502 per request with a generic error — hard to diagnose for a first-time user.
- **Many capabilities are implemented but undocumented**: `/api/empty-products` admin endpoint (GET/DELETE), CORS on RSS/proxy endpoints, gzip compression, per-endpoint cache TTLs, CSP header set, `PORT` env var, `BASE_URL` env var for the screenshot script, `util.js` in the project structure.

**Top 10 highest-impact fixes** (see full list in §6)
1. Add `playwright` to `devDependencies` (or document the manual install).
2. Remove Canvas App and Azure Management API claims from README (or move to a clearly labeled "Planned" section).
3. Document the auth boundary: 3 streams work without setup, 2 require Entra registration.
4. Document `/api/empty-products`, CORS, gzip, cache TTLs, `PORT`, `BASE_URL`, and `util.js`.
5. Decide + implement: fail loud at boot vs fail per-request (currently mismatched with charter/expectation).
6. Return distinct 503 "not configured" vs 502 "upstream error" for the Graph pages.
7. Fix README claim about product logos on every card.
8. Add a health check endpoint (`/healthz`) — required for any container / managed deployment.
9. Add rate limiting on `/api/summarize` and `/api/impact-digest` before any exposed deployment.
10. Add auth (at minimum a localhost/token check) on `DELETE /api/empty-products`.

---

## 2. Verified Capabilities (grouped)

### Data streams (5)
| Stream | Route | Upstream | Auth | Cache TTL |
|---|---|---|---|---|
| Power Platform Release Planner | `/powerplatform` → `/proxy` | `releaseplans.microsoft.com/releaseplanner-json/` | None | 300 s per product |
| Microsoft 365 Roadmap | `/m365updates` → `/api/m365updates` | `www.microsoft.com/.../m365/rss` | None | 300 s |
| Azure Updates | `/azureupdates` → `/api/azureupdates` | `www.microsoft.com/.../azure/rss` | None | 300 s |
| M365 Message Center | `/messagecenter` → `/api/messagecenter` | Microsoft Graph `admin/serviceAnnouncement/messages` | Graph client-credentials | 60 s |
| M365 Service Health | `/servicehealth` → `/api/servicehealth` | Microsoft Graph `admin/serviceAnnouncement/healthOverviews` | Graph client-credentials | 60 s |

### AI (optional, undocumented in the README beyond a brief mention)
- `GET /api/ai-status` — `{ enabled, provider, model }` (30 s cache)
- `POST /api/summarize` — per-item summaries (10 min cache, keyed by content+model)
- `GET /api/impact-digest` — weekly-window highlights (15 min cache)
- Providers auto-detected in this order: Azure OpenAI → OpenAI → GitHub Models. If none configured, `/api/summarize` returns 503 and the UI silently omits AI panels.

### Admin / observability
- `GET /api/empty-products` — list product IDs currently cached as "known empty" (7-day TTL).
- `DELETE /api/empty-products` — clear entire cache (or `?id=<guid>` for one).
- **Not present:** health check, metrics, structured logs, request IDs.

### Static / infra
- Root `/` → 302 redirect to `/powerplatform`.
- `/static/` → JS/CSS with ETag + `no-cache`, gzipped if >1 KB.
- `/public/` → product-icon SVG/PNG with `Cache-Control: public, max-age=86400`, ETag, gzipped if SVG >1 KB.
- CORS: `Access-Control-Allow-Origin: *` on `/api/m365updates`, `/api/azureupdates`, `/proxy`.
- Body size limit: 1 MB on JSON POSTs (`/api/summarize`).
- Upstream timeouts: 15 s Graph/proxy/RSS, 30 s AI.
- CSP on all HTML: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`, `form-action 'none'`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

### Frontend (per-page)
| Page | Filters | Sort | Group | Export | Auto-refresh | Modal detail |
|---|---|---|---|---|---|---|
| Power Platform | Product / area / wave / GA status / feature type / enabled-for, date range + presets, full-text | GA date / name | Product/area/wave (collapsible) | ⬇ Export + 🛠 Generate Full Export | No | Feature card expand |
| M365 Roadmap | Status / product (multi-select), full-text | Date | Product (opt-in) | ⬇ + 🛠 | Manual ↻ | — |
| Azure Updates | Status / product (multi-select), full-text | Date, Group by product | Product (opt-in) | ⬇ + 🛠 | Manual ↻ | — |
| Message Center | Severity / product / date range, full-text | Date, group by product | Product | ⬇ + 🛠 | 60 s (pausable) | Full message detail |
| Service Health | — | — | Service overview + issues list | (none) | 60 s (pausable) | Issue detail + timeline |

### Theming
- URL param `?clawpilotTheme=light|dark` + header toggle. Toggle state persists in `localStorage`.
- FOUC prevention via a `<script>` in `<head>` that sets `data-theme` before first paint.
- Donut and trend charts on Service Health read theme colors via `getComputedStyle()` so theme toggle is live.

---

## 3. Documentation Drift (what the docs say vs what the code does)

### Highest-impact (fix soon)

| # | Claim | Where | Reality | Suggested fix |
|---|---|---|---|---|
| D1 | "Something they could run internally as a Canvas App (Code app type)" | README intro | No Canvas packaging, no `.azure/`, no ARM template | Remove from README or move to a clearly labeled "Planned / contributions welcome" section |
| D2 | "If you wire up the Azure Management API as well, this same portal can surface Azure Service Health and Azure Resource Health events" | README intro | No Azure Management API code, no related env vars | Remove or move to Planned |
| D3 | "Regenerate with `node scripts/capture-screenshots.js` (Playwright)" | README Screenshots | Playwright is not in `package.json`; script crashes on `require('playwright')` for anyone who ran only `npm install` | Add `playwright` to `devDependencies`, OR document `npm install --save-dev playwright` step |
| D4 | "Product / service logos on every card" (Features section) | README | Only Power Platform and Service Health render icons on cards; M365 Roadmap / Azure Updates / Message Center do not | Update wording: "Product logos on Power Platform and Service Health cards, and in filter sidebars" |
| D5 | "Generate Full Export … checklist of products / services with select-all, clear, and search" | README Generate Full Export | Select-all and clear exist; **no search field** | Remove "and search", or add a search field to the modal |
| D6 | "Auto-refresh … Graph-backed pages refresh on an interval; non-Graph pages refresh on demand" | README | Message Center + Service Health: 60 s auto-refresh with pause. M365 + Azure Updates: manual ↻ Refresh only. **Power Platform: no refresh button at all** | Add "Power Platform has no refresh button; reload the page to refresh" |
| D7 | Node.js 24+ requirement (mentioned in README) | README | `package.json` has no `engines` field; users on Node 20 can `npm install` with no warning | Add `"engines": { "node": ">=24" }` to `package.json` |
| D8 | `.env.example` lists three AI provider blocks | `.env.example` | Behavior when none is configured (AI features silently disabled, `/api/summarize` returns 503) is not stated | Add a comment at the top of the AI block: `# Optional. If none are set, AI features are disabled and /api/summarize returns 503.` |
| D9 | SECURITY.md mentions reverse proxy / TLS | SECURITY.md | Server doesn't do TLS itself; assumes reverse proxy | Say so explicitly: "Terminate TLS at a reverse proxy (nginx, Azure App Service, Front Door)." |

### Lower-impact but real

| # | Claim | Where | Reality | Suggested fix |
|---|---|---|---|---|
| D10 | "Runs on `http://localhost:3000`" | README | `PORT` env var is respected (`Number(process.env.PORT) \|\| 3000`); not documented | Add: "The server binds to `127.0.0.1` on `PORT` (default `3000`)." |
| D11 | Project structure lists static/ JS files | README | `util.js` is loaded on every page but omitted from the list | Add `util.js` |
| D12 | Screenshot script uses `BASE_URL` | (nowhere) | `process.env.BASE_URL` is read but not in `.env.example` or README | Add to `.env.example` under an "Optional / scripts" block |
| D13 | Root redirect | README | `/` returns 302 (temporary) | Optional: mention it's a 302 |
| D14 | Cold-cache warning | README Screenshots | Cold Power Platform load can be ~30–45 s (~20 upstream fan-out) — warned in Screenshots section but not on the Setup page | Move to Setup as "First load may take 30–45 s while the proxy warms upstream caches. This is expected." |
| D15 | Charter says "Fail loudly at boot when required env is missing" | `.squad/agents/parker/charter.md` | Server starts fine with no Graph creds; only fails on demand | Either implement the boot check for M365_* vars, or update the charter |
| D16 | README API section | README | `/api/empty-products` (GET + DELETE) not listed | Add to the API endpoint table |

---

## 4. Capability Gaps

Things a reasonable user or operator would expect to exist but don't.

### Architecture / ops
| # | Missing | Severity | Why it matters |
|---|---|---|---|
| G1 | Health check endpoint (`/healthz` or `/health`) | Medium | Required for Kubernetes readiness probes, App Service health checks, any load balancer |
| G2 | Rate limiting on `/api/summarize` and `/api/impact-digest` | Medium | Endpoints are expensive (LLM calls); localhost binding is the only current mitigation. Blocker for any exposed deployment |
| G3 | Structured logging / log sink | Medium | Errors only print to console; no way to correlate across restarts or attach to a log platform |
| G4 | Auth / audit trail for the portal itself | Medium | Anyone on the network can view all data (again, mitigated only by 127.0.0.1 binding) |
| G5 | Auth check on `DELETE /api/empty-products` | Low → Medium | Currently anyone who can reach the port can wipe the cache. `Referer`/`Origin` check or localhost gate is a 3-line fix |
| G6 | Retry on transient Graph token / API failures | Low | One socket blip surfaces as a 502 to the user |
| G7 | Alerting on client-secret expiry | Low → Medium | Secret expires silently; auth then fails with a generic message. At minimum log token-refresh failures loudly |
| G8 | Metrics / request IDs / correlation | Low | Nice-to-have for debugging multi-hop upstream chains |

### Frontend
| # | Missing | Severity |
|---|---|---|
| G9 | Search within the Generate Full Export product list | Medium (painful on 50+ item lists) |
| G10 | Filter state in URL (persist across reloads / share deep links) | Medium — refresh loses selections |
| G11 | Retry button on error banners | Low |
| G12 | Explicit "no active incidents" state on Service Health hero band | Low |
| G13 | Copy-to-clipboard confirmation toast on the Power Platform "copy deep link" export | Low |
| G14 | Keyboard shortcuts (`/` for search, `?` for help) | Low |

### Data / features
| # | Missing | Severity |
|---|---|---|
| G15 | Azure Management API integration for Azure Service / Resource Health (promised) | Medium (broken promise) |
| G16 | Canvas App (Code app type) packaging (promised) | Medium (broken promise) |
| G17 | Per-tenant / per-user filter presets saved server-side | Low (out of scope for reference impl) |
| G18 | Historical archive of Message Center posts beyond the 30-day Graph window | Low |
| G19 | Configurable upstream hostnames (for internal mirrors or test envs) | Low |

---

## 5. Perceived-Bug Risks (behaviors that will be reported as bugs even if intentional)

| # | Behavior | Why it reads as a bug | Suggested remediation |
|---|---|---|---|
| P1 | Missing Graph creds → generic 502 on Message Center / Service Health | User has no idea whether it's a config problem or an outage | Return **503 "Not configured"** with an actionable message when M365_* vars are unset; keep 502 for real upstream errors. Add a `/api/auth-check` returning `{ required, configured }` so the UI can show "⚠️ Configure `.env` with M365_CLIENT_ID" |
| P2 | Cold Power Platform load takes 30–45 s with only a "Loading…" banner | Looks hung; users hit refresh or close the tab | Add ETA text: "First load fans out ~20 upstream calls, this can take ~30 s." Consider a striped skeleton |
| P3 | Empty-array response on a product with no release plan | Looks like broken filtering | Show "No release plans published for this product" instead of empty |
| P4 | Upstream returns HTML/garbage → `/proxy` responds `{ results: [], recovered: true }` with no visible signal | Looks like data loss | Set an `X-Upstream-Recovered: true` response header; surface in a small "some upstream sources returned no data" note |
| P5 | Root `/` unexpectedly redirects to `/powerplatform` for someone who wanted Message Center | Feels like the wrong app opened | Document explicitly. Consider a lightweight `/` landing page in a future version |
| P6 | `?clawpilotTheme=` param sticks across nav (and toggle is `localStorage`-backed) — but there's no obvious way to "clear" the override back to system preference | Users think dark mode is stuck | Add "Match system" as a third option in the toggle |
| P7 | Multi-select filter dropdown closes on first checkbox click (on some pages) | Users expect it to stay open to pick multiple items | Verify behavior across all pages; standardize: dropdown stays open until outside click / chevron |
| P8 | Message Center caret arrow doesn't rotate when the dropdown is open | Looks broken | Add `.mc-multi.open .mc-multi-caret { transform: rotate(180deg); }` (already present on other pages) |
| P9 | `DELETE /api/empty-products?id=<not-in-cache>` silently returns `{ ok: true }` | Caller assumes it worked | Return `{ ok: true, cleared: N }` |
| P10 | Graph pagination silently stops at 20 pages | Callers assume they got everything | Add `truncated: true` flag on response when the cap is hit |
| P11 | Server binds only to `127.0.0.1` but README never says so | Users trying to hit it from another machine on the LAN see "connection refused" | Say so in Setup and mention `PORT` and `HOST` (if we add one) |
| P12 | AI cache key includes model name — switching `AZURE_OPENAI_DEPLOYMENT` silently invalidates cached summaries | Confusing "why did all my AI results disappear?" | One-line note in README AI section |
| P13 | "Clear All Filters" on Power Platform leaves sort and group-by unchanged | Users expect a full reset | Either reset everything, or rename to "Clear Category Filters" |
| P14 | Export button is always enabled — clicking with 0 results produces a blank export | Feels broken | Disable with tooltip "No items to export" when count is 0 |
| P15 | `capture-screenshots.js` fails with `Cannot find module 'playwright'` for any contributor who ran only `npm install` | Straight-up looks like a bug | Fix D3 (add to devDependencies) |
| P16 | `scripts/capture-screenshots.js` doesn't check the server is up first | Cryptic timeouts | Fetch `/` with a 2 s timeout at start; print a friendly message if it fails |

---

## 6. Recommended Top 10 Fixes (with owner)

Ordered by user impact. Owner column is who should implement.

| # | Fix | Owner | Why now |
|---|---|---|---|
| 1 | Add `playwright` to `devDependencies` in `package.json` | Parker | Fixes the only genuine "install & follow README" breakage |
| 2 | README: strike Canvas App and Azure Management API claims (or move to "Planned") | Ripley + Kane | Stops misleading new users on day 1 |
| 3 | README: document the auth boundary (3 streams unauthenticated, 2 need Entra) up front | Kane | First-visit setup clarity |
| 4 | README: add sections for `/api/empty-products`, CORS, gzip, cache TTLs, `PORT`, `BASE_URL`, and `util.js` in project structure | Kane | Restores doc-to-code parity for hidden features |
| 5 | Return 503 (not 502) when Graph creds are missing; add `/api/auth-check` | Parker | Makes P1 self-diagnostic |
| 6 | Decide fail-loud vs fail-per-request; either add boot validation or update Parker's charter | Ripley | Removes the D15 charter mismatch |
| 7 | Fix D4 (product-logo claim) in README | Kane | Correctness |
| 8 | Add `/healthz` endpoint | Parker | Unblocks any container / managed deployment |
| 9 | Add per-IP rate limiting on `/api/summarize` and `/api/impact-digest` | Parker | Required before any deployment beyond localhost |
| 10 | Add auth (or localhost check) on `DELETE /api/empty-products` | Parker | Small, high-value hardening |

---

## 7. Notes for Follow-Up

- The frontend has substantial code duplication (multi-select dropdowns, modals, HTML sanitization, date formatting) across the 5 pages — ~200+ lines per page of largely identical logic. A `/static/multiselect.js`, `/static/modal.js`, `/static/html-sanitize.js`, `/static/date-formats.js` refactor would pay for itself immediately and lock in consistency (Lambert can lead).
- Accessibility: modals lack focus trap; multi-selects lack live-region "N of M selected" announcements; some interactive elements are color-only (severity). All fixable, none critical, all worth queuing.
- `SECURITY.md` doesn't currently mention the CSP header set or the path-traversal protection — worth adding since they're real strengths of the current implementation.

---

*Compiled by Squad (Coordinator) from four parallel audits — 2026-07-04.*
