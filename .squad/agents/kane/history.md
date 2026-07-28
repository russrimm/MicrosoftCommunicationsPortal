# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — sample/reference implementation aggregating Microsoft update/health streams. MIT license, not an official Microsoft product.
- **Stack:** Node.js server, static HTML pages, Playwright for screenshots. Runs at `http://localhost:3000`.
- **Test scope:** 5 pages × 2 themes, upstream fan-out (Power Platform ~20 calls), Graph auth paths, empty/error/loading states.
- **Screenshot regen:** `node scripts/capture-screenshots.js` while server is running; outputs to `screenshots/`.
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-07-05: Deploy infrastructure audit — 4 issues found
- NODE_ENV was missing from Bicep appSettings — production containers need this set to "production"
- Dockerfile COPY without --chown meant files were owned by root, not the node user — security concern
- HEALTHCHECK hardcoded port 3000 instead of using $PORT variable — would break if PORT env var changed
- README references GHCR image (ghcr.io/...) that doesn't exist yet — advisory, needs CI pipeline to publish
