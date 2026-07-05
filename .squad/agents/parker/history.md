# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — Node.js proxy fronting Microsoft update/health APIs so a static frontend can aggregate them without CORS/auth pain in the browser.
- **Stack:** Node.js, `dotenv` (only prod dep). Server: `server.js` on `http://localhost:3000`. `npm start` / `npm run dev` (`node --watch`).
- **Upstreams:** `releaseplans.microsoft.com` (Power Platform), M365 Roadmap RSS, Azure Updates RSS, Microsoft Graph (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`), optionally Azure Management API for Service/Resource Health.
- **Auth:** Entra ID client-credentials flow. Env: `M365_CLIENT_ID`, `M365_TENANT_ID`, plus client secret (see `.env.example`).
- **Notable behavior:** Power Platform page fans out ~20 upstream calls on a cold cache — screenshot script waits up to 45s for the loading banner to clear.
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
