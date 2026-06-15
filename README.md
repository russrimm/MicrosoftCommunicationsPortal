# Microsoft Communications Portal

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
| Power Platform Release Planner | `/powerplatform` | `index.html` | `releaseplans.microsoft.com` (proxied) |
| Microsoft 365 Roadmap | `/m365updates` | `m365updates.html` | M365 Roadmap RSS |
| Azure Updates | `/azureupdates` | `azureupdates.html` | Azure Updates RSS |
| Microsoft 365 Message Center | `/messagecenter` | `messagecenter.html` | Microsoft Graph |
| Microsoft 365 Service Health | `/servicehealth` | `servicehealth.html` | Microsoft Graph |

Every page supports light and dark themes. Pass `?clawpilotTheme=light` or
`?clawpilotTheme=dark` on the URL, or click the theme toggle in the header.

The site root (`/`) redirects to `/powerplatform`.

## Screenshots

Each page is shown in light and dark mode below. Regenerate with
`node scripts/capture-screenshots.js` (Playwright) while the server is running
on `http://localhost:3010`.

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

### Microsoft 365 Message Center

| Light | Dark |
|---|---|
| ![Microsoft 365 Message Center — light](screenshots/message-center-light.png) | ![Microsoft 365 Message Center — dark](screenshots/message-center-dark.png) |

### Microsoft 365 Service Health

| Light | Dark |
|---|---|
| ![Microsoft 365 Service Health — light](screenshots/service-health-light.png) | ![Microsoft 365 Service Health — dark](screenshots/service-health-dark.png) |

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Entra ID credentials** (required only for Message Center and Service Health):

   The Power Platform, M365 Roadmap, and Azure Updates pages work without credentials —
   skip this step if you only need those.

   **2a. Create the app registration**

   1. Sign in to the [Entra admin center](https://entra.microsoft.com) (or
      [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppRegistrations))
      with an account that can register apps and grant tenant-wide admin consent
      (Global Administrator, Privileged Role Administrator, or Cloud Application Administrator).
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

   > Treat the secret like a password. Never commit `.env` to source control —
   > the included `.gitignore` already excludes it.

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
   3. Save the file. The server reads `.env` at startup, so restart `node server.js`
      after any change.

3. **Run the server:**
   ```bash
   npm start
   # or
   node server.js
   ```

4. **Open in browser:**
   http://localhost:3010

## Features

- **Power Platform Release Planner** — browse release features by product, wave, and date
- **Microsoft 365 Roadmap** — current and upcoming M365 features from the official RSS feed
- **Azure Updates** — Azure product announcements from the official RSS feed
- **Message Center** — tenant-specific Microsoft 365 Message Center announcements,
  filterable by severity and date
- **Service Health** — current service incidents and advisories for your tenant
- **✨ AI Insights** *(optional)* — per-feed "Top 5 most impactful changes this week"
  digest plus a per-item "Summarize with AI" button on every announcement. Picks out
  breaking changes, retirements, GA launches, security/compliance changes, and items
  requiring admin action. See [AI summarization](#ai-summarization-optional) below.
- **Auto-refresh** — Graph-backed pages refresh on an interval
- **Dark mode** — toggle between light and dark themes
- **Export** — printable export view for the Power Platform release plan

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

| Endpoint | Description | Auth |
|---|---|---|
| `GET /proxy?productId=...&langCode=...` | Power Platform Release Planner proxy (follows 301/302/307/308 redirects) | None |
| `GET /api/m365updates` | Microsoft 365 Roadmap RSS, parsed to JSON | None |
| `GET /api/azureupdates` | Azure Updates RSS, parsed to JSON | None |
| `GET /api/messagecenter` | Microsoft 365 Message Center via Microsoft Graph | `.env` |
| `GET /api/servicehealth` | Microsoft 365 Service Health via Microsoft Graph | `.env` |
| `GET /api/ai-status` | Reports whether AI is configured and which provider is active | None |
| `POST /api/summarize` | Body `{source, items[]}` → per-item AI summaries | AI provider |
| `GET /api/impact-digest?source=azure\|m365\|messagecenter\|servicehealth&limit=5&windowDays=14` | Top N most impactful items for a source | AI provider |

OAuth tokens for Microsoft Graph are cached in-memory and refreshed 60 seconds before expiry.
AI provider responses are cached in-memory (summarize: 10 min, digest: 15 min, hashed by input).

## Project structure

```
index.html                       Power Platform Release Planner UI
m365updates.html                 M365 Roadmap UI
azureupdates.html                Azure Updates UI
messagecenter.html               M365 Message Center UI
servicehealth.html               M365 Service Health UI
server.js                        Node HTTP server, static file host, API proxy, AI endpoints
static/ai-insights.js            Shared client-side AI helper (digest panel + per-item summarize)
package.json                     Dependencies (dotenv only)
.env.example                     Template for Entra ID credentials and optional AI provider
scripts/capture-screenshots.js   Playwright script that regenerates the README screenshot gallery
screenshots/                     Light + dark mode PNGs rendered into the README above
```

## Requirements

- Node.js 24+ (uses the built-in `http`, `https`, and global `URL` APIs)
- An Entra app registration (only for the Message Center and Service Health pages)

## Contact

Questions, feedback, or ideas to make this portal better? Reach out to **Russ Rimmerman**
at [russ.rimmerman@microsoft.com](mailto:russ.rimmerman@microsoft.com) or connect on
[LinkedIn](https://www.linkedin.com/in/russrimm).
