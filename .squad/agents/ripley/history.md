# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — single-pane-of-glass web app aggregating Microsoft update/health streams (Power Platform release plans, M365 Roadmap RSS, Azure Roadmap RSS, M365 Message Center via Graph, M365 Service Health via Graph). Optional Azure Service/Resource Health via Azure Management API.
- **Stack:** Node.js (minimal — `dotenv` only dep), static HTML/JS frontend (no framework), Playwright for screenshot capture, MIT-licensed sample/reference implementation.
- **Version:** 1.1.0
- **Auth:** Entra ID client-credentials → Microsoft Graph (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`)
- **Runs on:** `http://localhost:3000` via `npm start` or `npm run dev` (`node --watch`)
- **Deploy targets mentioned:** Canvas App (Code app type) or Azure app server
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
