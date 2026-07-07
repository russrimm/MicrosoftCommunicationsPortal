# Squad Decisions

## Active Decisions

### 2026-07-04T13:48:31-05:00: Architecture capabilities audit
**By:** Ripley (via Copilot, requested by Russ Rimmerman)
**What:** Verified 15+ implemented capabilities. Identified 2 major doc drift issues in README (Canvas App and Azure Management API claims are aspirational — no code). Called out 10 architecture-level gaps (no /healthz, no rate limiting, no structured logging, no auth on the portal, no auth on DELETE /api/empty-products, no retry on transient upstream failures, no secret-expiry alerting, no metrics/request IDs). Flagged 7 perceived-bug risks (cold-cache slowness, silent 401 on missing Graph consent, `/` redirect surprise, `recovered:true` invisible signal, `?clawpilotTheme=` stickiness, etc.).
**Why:** Baseline for v1.1.x doc correction and v1.2.0 planning. Decisions: (a) strip Canvas/Azure-Mgmt-API from README, (b) document the unauthenticated-vs-Graph auth boundary explicitly, (c) return 503 vs 502 for not-configured vs upstream-error, (d) queue /healthz + rate-limit + admin-auth as prereqs for any non-localhost deployment.

### 2026-07-04T13:48:31-05:00: Frontend capabilities audit
**By:** Lambert (via Copilot, requested by Russ Rimmerman)
**What:** Verified all 5 pages deliver documented filter/sort/search/group/export capabilities with full light/dark theming. Found doc drift: README claims "product logos on every card" but only Power Platform and Service Health render them; "checklist … with … search" claim for Generate Full Export modal has no search field; Service Health has no Generate Full Export button; refresh model differs per page (60s auto for Graph pages, manual ↻ for RSS pages, none for Power Platform). Identified frontend gaps (no search in export modal, filter state not persisted in URL, no retry button, no keyboard shortcuts). Perceived-bug risks (multi-select dropdown closes on first click on some pages, Message Center caret doesn't rotate when open, "Clear All Filters" leaves sort untouched, export always enabled even at 0 results). Substantial code duplication (~200 lines/page) across multi-select, modal, HTML sanitization, and date-formatting logic.
**Why:** Convention proposal — extract shared multi-select/modal/sanitize/date-format utilities to `/static/*.js`. Standardize dropdown behavior (stay open on checkbox click, chevron rotates on open). Fix "Clear All Filters" scope or rename. Disable export at 0 results. Add live-region announcements and focus trap for accessibility.

### 2026-07-04T13:48:31-05:00: Backend capabilities audit
**By:** Parker (via Copilot, requested by Russ Rimmerman)
**What:** Full inventory of routes (22), upstream integrations (5), env vars (13), and auth flow. Secret hygiene is solid (.env gitignored, 127.0.0.1 bind, no token logging, 1MB body cap, strict CSP, path-traversal protection). Token acquisition coalesces concurrent refreshes and caches with a 60s safety margin. Gaps: server does NOT fail loudly at boot when Graph creds are missing (charter mismatch), `/api/summarize` and `/api/impact-digest` have no rate limiting, `DELETE /api/empty-products` has no auth, Playwright is required by `scripts/capture-screenshots.js` but missing from `package.json`. Undocumented capabilities: `/api/empty-products` GET+DELETE, CORS headers, gzip/deflate compression, per-endpoint cache TTLs, PORT env var, BASE_URL env var. Perceived-bug risks: `recovered:true` on `/proxy` has no explanatory header, Graph pagination silently truncates at 20 pages, `DELETE ?id=<not-in-cache>` returns `{ok:true}` unconditionally, AI cache invalidates silently when model name changes.
**Why:** 3 medium-risk items block any deployment beyond localhost — (1) decide boot-validation policy and either implement or update charter, (2) add per-IP rate limiter (~10 req/min) to AI endpoints, (3) restrict DELETE `/api/empty-products` to localhost or add `X-Admin-Token`. Playwright missing is a straight-up bug for anyone regenerating screenshots — add to `devDependencies`.

### 2026-07-04T13:48:31-05:00: Doc-vs-code drift audit
**By:** Kane (via Copilot, requested by Russ Rimmerman)
**What:** 16 doc-vs-code drift issues found. Critical: `scripts/capture-screenshots.js` requires Playwright but it's not in package.json — will fail with `Cannot find module 'playwright'` for anyone following README. High: README claims Canvas App and Azure Management API support that doesn't exist; theme persistence differs from user expectation (localStorage exists but confusing UX); cold-cache load warning is not prominent enough in Setup; per-endpoint cache TTLs undocumented; PORT env var undocumented. Medium: missing `engines` field in package.json (README says Node 24+ but not enforced); `util.js` omitted from project structure list; `BASE_URL` env var undocumented; error responses undocumented; AI silently disabled without prominent warning. Low: redirect code (302) not specified; empty-products.json runtime file behavior not explained. Would a first-time user succeed? Score: 7/10 — succeeds if they have Entra admin rights and don't need screenshots.
**Why:** README correctness affects every new user. Top 10 fixes ordered by impact — add Playwright to devDependencies, document PORT/util.js/BASE_URL/cache TTLs, add Node engines field, fix theme persistence UX or document per-page reset, add troubleshooting section for missing M365 creds, remove/clarify aspirational Canvas/Azure-Mgmt-API claims.

### 2026-07-04T14:00:00-05:00: Boot validation policy — per-request 503, not boot failure
**By:** Ripley (requested by Russ Rimmerman)
**What:** Graph credentials are optional. Server MUST start successfully without them. When Graph creds are absent, the server logs a warning at startup (console.warn) and Graph-backed endpoints return 503 "AUTH_NOT_CONFIGURED" with an actionable message. The `/api/auth-check` and `/healthz` endpoints make the state inspectable. This replaces the charter's "fail loudly at boot" language.
**Why:** 3 of 5 data streams work without Graph auth. Blocking server startup for optional features punishes users who don't need those features. Per-request 503 is self-diagnostic and compatible with container health checks.

### 2026-07-04: README documentation drift fixes
**By:** Kane (requested by Russ Rimmerman)
**What:** Applied 7 fixes to README.md: removed Canvas App/Azure Management API claims, added auth boundary callout, fixed product logo claim accuracy, removed search from export modal bullet, replaced vague auto-refresh with per-page specifics, added PORT env var documentation. Verified util.js already listed.
**Why:** README correctness affects every new user. Targeted highest-impact drift items from capabilities audit.

### 2026-07-04: Implement audit fixes 1, 5, 8, D7
**By:** Parker (requested by Russ Rimmerman)
**What:** (1) Added Playwright to devDependencies. (2) Added engines field to package.json. (3) Graph-backed endpoints now return 503 AUTH_NOT_CONFIGURED when creds missing instead of misleading 502. (4) New `/api/auth-check` endpoint for frontend configuration status. (5) New `/healthz` endpoint for container orchestrators.
**Why:** Fixes critical audit findings — Playwright missing was a straight-up bug, 503 vs 502 distinction enables self-diagnostic deployments, /healthz is prerequisite for any containerized deployment.

### 2026-07-05T00:00:00-05:00: Guided Report Feature Architecture
**By:** Ripley (Lead, requested by Russ Rimmerman)
**What:** Five architectural decisions for Guided Report: (1) PPTX via client-side PptxGenJS, (2) dedicated guidedreport.html page, (3) client-side data aggregation reusing existing API routes, (4) three-step wizard (select sources → select products/topics → review + generate), (5) themed PPTX output. Deferred: search/filter at >50 items, saved templates, email delivery.
**Why:** Ship client-side — no backend bloat, aligns with existing philosophy, reversible. New page gives room for 3-step flow. No aggregator endpoint — reuse existing API routes.

### 2026-07-05T12:00:00-05:00: Container & deploy infrastructure
**By:** Parker (requested by Russ Rimmerman)
**What:** Dockerfile uses single-stage node:20-alpine with wget healthcheck. HOST=0.0.0.0 + ALLOW_REMOTE_BIND=true for Docker networking. azure.yaml postprovision hook runs create-entra-app.ps1 with continueOnError:true (Graph is optional — 6 of 8 pages work without it).
**Why:** Single-stage is appropriate since there's no build step. Alpine keeps image small. continueOnError ensures azd up succeeds even without admin consent.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 2026-07-06T12:00:00-05:00: UX/Maintainability – Shared Nav, Mobile, Focus Traps, State Helpers
**By:** Lambert (Frontend Developer)
**What:** Five fixes in one pass: (1) Created `static/nav.js` — shared IIFE replacing ~360 lines of copy-pasted header/nav across 9 HTML pages. Theme toggle unified via `data-act="toggleTheme"` through CPActions delegation. (2) Added mobile responsive `@media` breakpoints (768px, 480px) to `common.css`. (3) Added `trapFocus()`/`releaseFocus()` to `util.js`, wired into 6 modal pages for accessibility. (4) Added `CPUtil.renderLoading/renderError/renderEmpty` state helpers to `util.js` + `.cp-state` CSS. (5) Fixed `home.html` theme persistence (added `util.js`, removed ad-hoc toggle). Standardized Azure Service Health nav link to `/azureservicehealth`.
**Why:** Code duplication was the #1 maintainability risk from the capabilities audit. Shared nav eliminates 9× copy-paste. Focus traps and mobile support are accessibility prerequisites. State helpers standardize loading/error/empty patterns for future development.
