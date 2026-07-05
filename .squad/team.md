# Squad Team

> MicrosoftCommunicationsPortal

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Ripley  | Lead / Architect | .squad/agents/ripley/charter.md  | active |
| Lambert | Frontend Dev     | .squad/agents/lambert/charter.md | active |
| Parker  | Backend Dev      | .squad/agents/parker/charter.md  | active |
| Kane    | Tester           | .squad/agents/kane/charter.md    | active |
| Scribe  | Session Logger   | .squad/agents/scribe/charter.md  | active |
| Ralph   | Work Monitor     | .squad/agents/ralph/charter.md   | active |
| Rai     | RAI Reviewer     | .squad/agents/Rai/charter.md     | active |

## Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — single-pane-of-glass web app that aggregates Microsoft update/health streams (Power Platform release plans, M365 Roadmap, Azure Updates, M365 Message Center via Graph, M365 Service Health via Graph). Optional Azure Service/Resource Health via Azure Management API. Sample/reference implementation, MIT-licensed.
- **Stack:** Node.js (only prod dep is `dotenv`), static HTML/JS frontend (no framework), Playwright for screenshot capture.
- **Version:** 1.1.0
- **Runs on:** `http://localhost:3000` via `npm start` or `npm run dev`
- **Created:** 2026-07-04
