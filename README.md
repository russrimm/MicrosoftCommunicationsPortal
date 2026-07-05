# Microsoft Communications Portal

> **Disclaimer:** This is a sample/reference implementation provided "AS IS"
> without warranty. It is not an official Microsoft product or service and is
> not supported by Microsoft Support. See [NOTICE.md](NOTICE.md) for full
> details.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## About

This project grew out of a recurring request from customers: they wanted a **single
pane of glass** to see all the Microsoft updates that affect them — Power Platform
release plans, the Microsoft 365 roadmap, Azure announcements, tenant-specific
Message Center posts, and Service Health incidents — without bouncing between half a
dozen portals, RSS feeds, and admin centers. Just like the https://www.mspulse360.app site I created, but something they could run internally as a Canvas App (Code app type) or on an app server in Azure. The Microsoft Communications Portal
brings those streams together into one filterable, dark-mode-friendly UI backed by
a small local Node.js server that proxies the upstream APIs and handles Microsoft
Graph authentication.

If you wire up the Azure Management API as well, this same portal can surface
**Azure Service Health** and **Azure Resource Health events** alongside the
Microsoft 365 data, giving you a complete view of platform-side communications and
tenant-side incidents in one place.

## Pages

| Page | Route | Source file | Backend |
|---|---|---|---|
| Home | `/home` | `home.html` | — (dashboard/landing page) |
| Power Platform Release Planner | `/powerplatform` | `index.html` | `releaseplans.microsoft.com` (proxied) |
| Microsoft 365 Roadmap | `/m365updates` | `m365updates.html` | M365 Roadmap RSS |
| Azure Updates | `/azureupdates` | `azureupdates.html` | Azure Updates RSS |
| Microsoft Fabric Roadmap | `/fabricroadmap` | `fabricroadmap.html` | `roadmap.fabric.microsoft.com` (proxied) |
| Microsoft 365 Message Center | `/messagecenter` | `messagecenter.html` | Microsoft Graph |
| Microsoft 365 Service Health | `/servicehealth` | `servicehealth.html` | Microsoft Graph |
| Azure Service Health | `/azureservicehealth` | `azureservicehealth.html` | Azure Management API (ARM) |

Every page supports light and dark themes. Pass `?clawpilotTheme=light` or
`?clawpilotTheme=dark` on the URL, or click the theme toggle in the header.

The site root (`/`) redirects to `/home`.

## Screenshots

All 8 pages are shown in light and dark mode below (16 screenshots). Regenerate with
`node scripts/capture-screenshots.js` (Playwright) while the server is running
on `http://localhost:3000`. The script visits each route with both theme query
strings, waits for any visible "Loading…" banner to clear (up to 45 s, since
the Power Platform page fans out ~20 upstream calls on a cold cache), and writes
1440×900 × 2 DPR PNGs to `screenshots/`.

### Home

| Light | Dark |
|---|---|
| ![Home — light](screenshots/home-light.png) | ![Home — dark](screenshots/home-dark.png) |

### Power Platform Release Planner

| Light | Dark |
|---|---|
| ![Power Platform Release Planner — light](screenshots/power-platform-light.png) | ![Power Platform Release Planner — dark](screenshots/power-platform-dark.png) |

### Microsoft 365 Roadmap

| Light | Dark |
|---|---|
| ![Microsoft 365 Roadmap — light](screenshots/m365-roadmap-light.png) | ![Microsoft 365 Roadmap — dark](screenshots/m365-roadmap-dark.png) |

### Azure Updates

| Light | Dark |
|---|---|
| ![Azure Updates — light](screenshots/azure-updates-light.png) | ![Azure Updates — dark](screenshots/azure-updates-dark.png) |

### Microsoft Fabric Roadmap

| Light | Dark |
|---|---|
| ![Microsoft Fabric Roadmap — light](screenshots/fabric-roadmap-light.png) | ![Microsoft Fabric Roadmap — dark](screenshots/fabric-roadmap-dark.png) |

### Microsoft 365 Message Center

| Light | Dark |
|---|---|
| ![Microsoft 365 Message Center — light](screenshots/message-center-light.png) | ![Microsoft 365 Message Center — dark](screenshots/message-center-dark.png) |

### Microsoft 365 Service Health

| Light | Dark |
|---|---|
| ![Microsoft 365 Service Health — light](screenshots/service-health-light.png) | ![Microsoft 365 Service Health — dark](screenshots/service-health-dark.png) |

### Azure Service Health

| Light | Dark |
|---|---|
| ![Azure Service Health — light](screenshots/azure-service-health-light.png) | ![Azure Service Health — dark](screenshots/azure-service-health-dark.png) |

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Microsoft Graph authentication** (required only for Message Center and Service Health):

   The Power Platform, M365 Roadmap, and Azure Updates pages work without credentials —
   skip this step if you only need those.

   **Option A — Managed identity (recommended for Azure deployments)**

   If the portal runs on Azure (App Service, Container Apps, or a VM), assign a
   system- or user-assigned managed identity to the host and grant it the
   `ServiceMessage.Read.All` + `ServiceHealth.Read.All` Graph **application**
   permissions with admin consent. Then set one variable in `.env`:

   ```
   USE_MANAGED_IDENTITY=true
   ```

   For a **user-assigned** identity, also add:

   ```
   AZURE_CLIENT_ID=<managed-identity-client-id>
   ```

   No client secret is needed — the platform issues the token automatically. On
   App Service / Container Apps the `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`
   environment variables are set by the platform. On a VM the Azure IMDS endpoint
   is used.

   **Option B — Scripted app registration (local dev or non-Azure hosts)**

   You'll need an account that can register apps **and** grant tenant-wide admin
   consent (Global Administrator, Privileged Role Administrator, or Cloud Application
   Administrator).

   [`scripts/create-entra-app.ps1`](scripts/create-entra-app.ps1) does everything in
   Option C for you: creates the app registration, adds the two required Microsoft
   Graph application permissions, grants admin consent, creates a client secret, and
   writes `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET` into `.env`
   (backing up any existing `.env` first). It's idempotent — safe to re-run to
   rotate the secret or repair drift.

   Prerequisites: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
   and [PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)
   (`pwsh`).

   ```powershell
   az login --tenant <your-tenant-id>
   pwsh .\scripts\create-entra-app.ps1
   ```

   Optional overrides (set before running):

   ```powershell
   $env:APP_NAME     = 'My Portal Name'   # default: Microsoft Communications Portal
   $env:SECRET_YEARS = '1'                # default: 2
   ```

   Skip ahead to step 3 once the script finishes.

   **Option C — Manual (portal UI)**

   <details>
   <summary>Click to expand manual steps</summary>

   **2a. Create the app registration**

   1. Sign in to the [Entra admin center](https://entra.microsoft.com) (or
      [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppRegistrations)).
   2. Go to **Identity → Applications → App registrations** and click **+ New registration**.
   3. Fill in:
      - **Name:** `Microsoft Communications Portal` (or any name you like)
      - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
      - **Redirect URI:** leave blank — this app uses the client-credentials flow, no redirect is needed.
   4. Click **Register**.
   5. On the **Overview** blade, copy these two values — you'll paste them into `.env` later:
      - **Application (client) ID** → `M365_CLIENT_ID`
      - **Directory (tenant) ID** → `M365_TENANT_ID`

   **2b. Add Microsoft Graph API permissions**

   1. In the new app registration, go to **API permissions → + Add a permission**.
   2. Choose **Microsoft Graph → Application permissions** (NOT delegated).
   3. Search for and add each of these permissions:
      - `ServiceMessage.Read.All` — required for the Message Center page
      - `ServiceHealth.Read.All` — required for the Service Health page
   4. Click **Add permissions**.
   5. Back on the **API permissions** blade, click **Grant admin consent for &lt;your tenant&gt;**
      and confirm. The **Status** column should show a green check for both permissions.

   **2c. Create a client secret**

   1. Go to **Certificates & secrets → Client secrets → + New client secret**.
   2. Enter a description (e.g. `portal-local-dev`) and pick an expiration (6–24 months).
   3. Click **Add**.
   4. **Immediately copy the secret's `Value`** (not the Secret ID) — it's only shown once.
      This is your `M365_CLIENT_SECRET`. If you navigate away before copying it, delete it
      and create a new one.

   **2d. Configure `.env`**

   1. Copy the template:
      ```bash
      # macOS / Linux
      cp .env.example .env

      # Windows PowerShell
      Copy-Item .env.example .env
      ```
   2. Open `.env` and paste in the three values you collected above:
      ```
      M365_CLIENT_ID=00000000-0000-0000-0000-000000000000
      M365_CLIENT_SECRET=your-client-secret-value
      M365_TENANT_ID=00000000-0000-0000-0000-000000000000
      ```

   </details>

   > Treat the client secret like a password. Never commit `.env` to source
   > control — the included `.gitignore` already excludes it. The server reads
   > `.env` at startup, so restart `node server.js` after any change.
   >
   > **Heads up:** Message Center and Service Health data can take up to ~1 hour
   > to appear after first consent while Microsoft Graph provisions access.

3. **Run the server:**
   ```bash
   npm start
   # or
   node server.js
   ```

4. **Open in browser:**
   http://localhost:3000

## Features

### Content sources
- **Power Platform Release Planner** — browse release features by product, wave, and date.
- **Microsoft 365 Roadmap** — current and upcoming M365 features from the official RSS feed.
- **Azure Updates** — Azure product announcements from the official RSS feed.
- **Microsoft Fabric Roadmap** — browse Fabric release features across 14 product areas from the official roadmap.
- **Message Center** — tenant-specific Microsoft 365 Message Center announcements,
  filterable by severity and date.
- **Service Health** — current service incidents and advisories for your tenant.
- **Azure Service Health** — Azure-level service health events, resource availability, and emerging issues for selected subscriptions.

### Across every page
- **Product / service logos on every card** — each card's product badge auto-resolves
  to a Microsoft product icon from `/public/*.svg` using a curated alias map plus
  token-based fuzzy matching (Jaccard + coverage). Covers Power Platform, Dynamics 365,
  the full M365/Viva/Copilot family, security and identity (Defender, Entra, Purview,
  Intune), Office apps, and 30+ Azure services. Falls back silently when no icon
  matches, so unknown products never show a broken image. Implementation:
  [`static/product-icons.js`](static/product-icons.js).
- **⬇ Export** — one-click export of the currently filtered view to a self-contained
  `.html` file you can paste straight into a new Outlook email. The exporter (see
  [`static/outlook-export.js`](static/outlook-export.js)) commits to a single
  high-contrast light palette and puts inline `style="…"` plus a redundant
  legacy `bgcolor="…"` attribute on every cell so the table renders correctly
  even after Outlook's compose surface strips `<style>` blocks, CSS variables,
  and `@media` rules. Outlook's built-in dark-mode rendering handles the dark
  conversion automatically.
- **🛠 Generate Full Export** — opens a modal that lets you build a focused export by date range
  (the right date axis for the page — GA Date, Published, Started, etc.) plus a
  checklist of products / services with select-all, clear, and search. A live counter
  shows how many items match before you generate. Items that don't carry a product /
  service field appear under an `(Unclassified)` bucket (pinned to the bottom of the
  list) so they can still be included or excluded explicitly. The output is the same
  Outlook-friendly HTML produced by the regular export.
- **Dark mode** — toggle between light and dark themes from the header, or pass
  `?clawpilotTheme=light` / `?clawpilotTheme=dark` on the URL. Theme is applied
  before first paint to avoid flash.
- **Auto-refresh** — Graph-backed pages (Message Center, Service Health) refresh
  on an interval; non-Graph pages refresh on demand.

### ✨ AI Insights *(optional)*
- A per-feed **"Top 5 most impactful changes this week"** digest at the top of the page,
  covering the last 14 days and refreshed on demand.
- A **Summarize with AI** button inside every announcement's detail modal — produces a
  plain-language summary, impact rating (high / medium / low), audience (IT admins,
  end users, developers, security), and an admin-action flag with deadline.
- Highlights breaking changes, retirements, GA launches, security/compliance changes,
  and items requiring admin action. See [AI summarization](#ai-summarization-optional) below.

### Security hardening
- **Strict Content Security Policy** — inline scripts are authorized via a per-request
  cryptographic nonce (`script-src 'self' 'nonce-…'`); `'unsafe-inline'` is **not** used.
  Additional directives: `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`,
  `object-src 'none'`, `frame-src 'none'`.
- **Allow-list HTML sanitizer** — a single hardened sanitizer in
  [`static/util.js`](static/util.js) is shared across all pages. It parses untrusted
  feed / Graph HTML via `DOMParser`, keeps only an explicit allow-list of safe tags and
  attributes (links forced to `target="_blank" rel="noopener noreferrer"`), and drops
  everything else — including `<script>`, `<style>`, `<iframe>`, `<math>`, `<template>`,
  `<svg>`, event-handler attributes, `javascript:` / `data:` / `blob:` URLs, and `style`
  attributes. This resists mutation-XSS far better than the deny-list approach.
- **Event delegation (no inline handlers)** — all user-facing event handlers use a
  `data-act` delegation system in `util.js`. No `onclick=`, `onchange=`, or other
  inline handler attributes appear anywhere in the markup, so the CSP nonce policy is
  fully enforceable.
- **Per-IP rate limiting** on every API endpoint (AI, Graph, RSS, and proxy), with a
  `TRUST_PROXY` option for correct client-IP extraction behind a reverse proxy.
- **Managed identity support** — preferred for Azure deployments; eliminates the
  client secret entirely. See [Setup → Option A](#setup).
- **Redirect-following restricted to Microsoft hosts** — the RSS and release-plan
  fetchers only follow redirects to `*.microsoft.com` / `*.azure.com` over HTTPS.
  Graph bearer tokens are never sent to any host other than `graph.microsoft.com`.
- **Admin endpoint auth** — the `/api/empty-products` endpoint is restricted to
  loopback and, when `ADMIN_TOKEN` is set, requires a bearer token compared in
  constant time (`crypto.timingSafeEqual`).
- **Prototype pollution guard** — the JSON body parser strips `__proto__`,
  `constructor`, and `prototype` keys before they reach application code.
- **`X-Content-Type-Options: nosniff`** on all HTML, JSON, and static-asset responses.

## AI summarization (optional)

The portal can call an LLM to surface what actually matters in the firehose of
Microsoft updates. When enabled, every feed page shows:

- A **Top 5 most impactful changes** digest at the top of the page (covers the
  last 14 days, refreshed on demand), with one-line themes and an overall headline.
- A **✨ Summarize with AI** button inside each announcement's detail modal —
  produces a plain-language summary, an impact rating (high/medium/low), the
  intended audience (IT admins, end users, developers, security), and a flag
  if admin action is required before a deadline.

The server speaks the OpenAI-compatible chat-completions protocol, so any of
these providers work out of the box — set **one** of the blocks in `.env` and
restart. The server auto-detects which provider to use (priority: Azure OpenAI →
OpenAI → GitHub Models).

| Provider | Env vars | When to use |
|---|---|---|
| **Azure OpenAI** | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, *(optional)* `AZURE_OPENAI_API_VERSION` | Recommended for Microsoft customers — data stays in your Azure tenant. |
| **OpenAI** | `OPENAI_API_KEY`, *(optional)* `OPENAI_MODEL`, `OPENAI_BASE_URL` | Quickest setup if you already have an OpenAI key. |
| **GitHub Models** | `GITHUB_TOKEN`, *(optional)* `GITHUB_MODEL` | Free tier — great for trying it out. Uses `https://models.github.ai`. |

Recommended model: `gpt-4o-mini` (or your deployment name) — fast, cheap, and
plenty capable for this kind of triage. Responses are cached in memory:
summaries for 10 minutes, digests for 15 minutes, so repeat views don't burn tokens.

When no AI provider is configured the portal still works fine — the AI panel
shows a short note pointing back at `.env.example` and the per-item Summarize
button is hidden.

## API Endpoints

The Node server exposes the following local endpoints (all return JSON):

| Endpoint | Description | Auth | Rate limit |
|---|---|---|---|
| `GET /healthz` or `/health` | Health check / liveness probe | None | — |
| `GET /api/auth-check` | Reports auth configuration status for Graph, ARM, and AI | None | — |
| `GET /proxy?productId=...&langCode=...` | Power Platform Release Planner proxy (follows 301/302/307/308 redirects; auto-skips IDs cached as known-empty) | None | 600/min |
| `GET /api/m365updates` | Microsoft 365 Roadmap RSS, parsed to JSON | None | 60/min |
| `GET /api/azureupdates` | Azure Updates RSS, parsed to JSON | None | 60/min |
| `GET /api/fabricroadmap` | Microsoft Fabric Roadmap JSON (14 product areas) | None | 60/min |
| `GET /api/messagecenter` | Microsoft 365 Message Center via Microsoft Graph | `.env` | 60/min |
| `GET /api/servicehealth` | Microsoft 365 Service Health via Microsoft Graph | `.env` | 60/min |
| `GET /api/subscriptions` | List Azure subscriptions (for subscription picker) | `.env` | 30/min |
| `GET /api/subscriptions/selected` | Get currently selected Azure subscriptions | None | 30/min |
| `POST /api/subscriptions/selected` | Save selected Azure subscriptions | None | 30/min |
| `GET /api/azure-resource-health/emerging-issues` | Azure emerging issues (tenant-level) | `.env` | 60/min |
| `GET /api/azure-resource-health/events` | Azure Resource Health events (subscription-scoped) | `.env` | 60/min |
| `GET /api/azure-resource-health/availability-statuses` | Azure resource availability summary | `.env` | 60/min |
| `GET /api/azure-resource-health/impacted-resources` | Resources impacted by an event | `.env` | 60/min |
| `GET /api/azure-resource-health/resource-events` | Events for a specific resource | `.env` | 60/min |
| `GET /api/azure-resource-health/resource-availability` | Availability history for a resource | `.env` | 60/min |
| `GET /api/azure-resource-health/resource-status` | Current status of a resource | `.env` | 60/min |
| `GET /api/ai-status` | Reports whether AI is configured and which provider is active | None | — |
| `POST /api/summarize` | Body `{source, items[]}` → per-item AI summaries | AI provider | 5/min |
| `GET /api/impact-digest?source=azure\|m365\|messagecenter\|servicehealth\|fabricroadmap&limit=5&windowDays=14` | Top N most impactful items for a source | AI provider | 10/min |
| `GET /api/empty-products` | List product IDs cached as known-empty by the `/proxy` route | Loopback + `ADMIN_TOKEN` | — |
| `DELETE /api/empty-products` | Clear the entire known-empty cache | Loopback + `ADMIN_TOKEN` | — |
| `GET /static/<file>` | Shared client JS (`util.js`, `product-icons.js`, `outlook-export.js`, `ai-insights.js`, `export-formats.js`, `subscription-picker.js`) and other static assets | None | — |
| `GET /public/<file>` | Microsoft product / service SVG icons | None | — |

OAuth tokens for Microsoft Graph are cached in-memory and refreshed 60 seconds before expiry.
Rate limits are per-IP fixed-window counters; set `TRUST_PROXY=true` when running behind a reverse proxy so the limiter reads the client IP from `X-Forwarded-For`.
AI provider responses are cached in-memory (summarize: 10 min, digest: 15 min, hashed by input).
The known-empty product cache is persisted to [`empty-products.json`](empty-products.json) so
restarts don't lose the auto-skip list.
Static `/public/` icons are sent with a 24-hour `Cache-Control` and an ETag, and gzipped when >1 KB.

## Project structure

```
home.html                        Home / dashboard landing page
index.html                       Power Platform Release Planner UI
m365updates.html                 M365 Roadmap UI
azureupdates.html                Azure Updates UI
fabricroadmap.html               Microsoft Fabric Roadmap UI
messagecenter.html               M365 Message Center UI
servicehealth.html               M365 Service Health UI
azureservicehealth.html          Azure Service Health UI
server.js                        Node HTTP server, static file host, API proxy, AI endpoints
static/
  util.js                        Shared client-side utilities (escapeHtml, sanitizeHtml, safeUrl, theme toggle, event delegation)
  ai-insights.js                 Shared client-side AI helper (digest panel + per-item summarize)
  product-icons.js               Shared client-side product-icon resolver (alias map + fuzzy matcher)
  outlook-export.js              Shared client-side Outlook-friendly HTML exporter (inline styles + bgcolor)
  export-formats.js              Multi-format export (HTML, Markdown, PDF, Word) for the Generate Full Export modal
  subscription-picker.js         Shared Azure subscription selection picker
public/                          Microsoft product / service SVG icons served at /public/<file>.svg
empty-products.json              Persisted cache of known-empty Release Planner product IDs (auto-skip list)
package.json                     Dependencies (dotenv only)
.env.example                     Template for Graph auth, AI providers, and server/security options
scripts/capture-screenshots.js   Playwright script that regenerates the README screenshot gallery
screenshots/                     Light + dark mode PNGs rendered into the README above
```

## Requirements

- Node.js 18+ (uses the built-in `http`, `https`, and global `URL` APIs)
- An Entra app registration (only for the Message Center and Service Health pages)

## Contributing

This project welcomes suggestions and feedback. Please open an issue to discuss
changes before submitting a pull request. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
for community guidelines.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

## Contact

Questions, feedback, or ideas to make this portal better? Reach out to **Russ Rimmerman**
at [russ.rimmerman@microsoft.com](mailto:russ.rimmerman@microsoft.com) or connect on
[LinkedIn](https://www.linkedin.com/in/russrimm).
