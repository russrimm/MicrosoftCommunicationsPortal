# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — Node.js proxy fronting Microsoft update/health APIs so a static frontend can aggregate them without CORS/auth pain in the browser.
- **Stack:** Node.js, `dotenv` (only prod dep). Server: `server.js` on `http://localhost:3000`. `npm start` / `npm run dev` (`node --watch`).
- **Upstreams:** `releaseplans.microsoft.com` (Power Platform), M365 Roadmap RSS, Azure Updates RSS, Microsoft Graph (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`), optionally Azure Management API for Service/Resource Health.
- **Auth:** Entra ID client-credentials flow. Env: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, plus client secret (see `.env.example`).
- **Notable behavior:** Power Platform page fans out ~20 upstream calls on a cold cache — screenshot script waits up to 45s for the loading banner to clear.
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-07-05: Deploy infrastructure — Dockerfile & azure.yaml
- Created single-stage node:20-alpine Dockerfile — no build step means multi-stage adds zero value
- Used wget for HEALTHCHECK (Alpine doesn't ship curl)
- Set HOST=0.0.0.0 + ALLOW_REMOTE_BIND=true — server.js defaults to 127.0.0.1 for security, Docker requires 0.0.0.0
- azure.yaml postprovision hook runs create-entra-app.ps1 with continueOnError:true — Graph is optional, 6/8 pages work without it
- Kane found COPY without --chown and hardcoded HEALTHCHECK port — both fixed

### 2026-07-05: GitHub Actions Docker workflow
- Created .github/workflows/docker-publish.yml for CI/CD
- Triggers: push to main, release publish, workflow_dispatch (manual)
- Uses docker/metadata-action for semantic tagging (sha, branch, semver from release tags)
- docker/build-push-action with BuildKit layer caching for fast rebuilds
- Pushes to ghcr.io/${{ github.repository }}
- Kane verified: image builds clean (21 packages, 0 vulns), container starts, healthcheck passes
