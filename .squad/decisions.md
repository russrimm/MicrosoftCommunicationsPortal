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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
