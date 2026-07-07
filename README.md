# Microsoft Communications Portal

> **Disclaimer:** This is a sample/reference implementation provided "AS IS"
> without warranty. It is not an official Microsoft product or service and is
> not supported by Microsoft Support. See [NOTICE.md](NOTICE.md) for full
> details.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/russrimm/MicrosoftCommunicationsPortal)

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
| Power Platform Release Planner | `/powerplatform` | `powerplatform.html` | `releaseplans.microsoft.com` (proxied) |
| Microsoft 365 Roadmap | `/m365updates` | `m365updates.html` | M365 Roadmap RSS |
| Azure Updates | `/azureupdates` | `azureupdates.html` | Azure Updates RSS |
| Microsoft Fabric Roadmap | `/fabricroadmap` | `fabricroadmap.html` | `roadmap.fabric.microsoft.com` (proxied) |
| Microsoft 365 Message Center | `/messagecenter` | `messagecenter.html` | Microsoft Graph |
| Microsoft 365 Service Health | `/servicehealth` | `servicehealth.html` | Microsoft Graph |
| Azure Service Health | `/azureservicehealth` | `azureservicehealth.html` | Azure Management API (ARM) |
| Guided Report | `/guidedreport` | `guidedreport.html` | — (multi-source report wizard) |

Every page supports light and dark themes. Pass `?clawpilotTheme=light` or
`?clawpilotTheme=dark` on the URL, or click the theme toggle in the header.

The site root (`/`) redirects to `/home`.

## Quick Deploy

Seven of nine pages work with **zero credentials** — you can be up and running in
under a minute. Only a few pages need extra setup, and each is optional:

| Pages | What you need | Who should care |
|-------|--------------|-----------------|
| Power Platform Release Planner, M365 Roadmap, Azure Updates, Fabric Roadmap, Guided Report | **Nothing** — works immediately | Everyone |
| Message Center, Service Health | An **Entra app registration** that can read your tenant's Microsoft Graph data (see [Setup step 2](#setup)) | IT admins who want tenant-specific M365 announcements and incident reports |
| Azure Service Health | The same Entra credentials **plus** an Azure role assignment (see [Setup step 3](#setup)) | Teams who also monitor Azure subscription-level health events |
| AI Insights (available on all pages) | An API key from **Azure OpenAI**, **OpenAI**, or **GitHub Models** (see [AI summarization](#ai-summarization-optional)) | Anyone who wants AI-generated summaries and "top 5 most impactful changes" digests |

> **Not sure where to start?** Pick the deployment option below that matches your
> situation. You can always add Graph credentials, Azure Service Health, or AI later.

### Option 1 — Azure Developer CLI *(recommended for Azure users)*

**What this does:** Deploys the portal as an Azure App Service (a managed web server
in your Azure subscription) with a single command. The infrastructure (server,
networking, etc.) is created automatically from the included Bicep templates.

**Best for:** Teams that want a shared, always-on instance hosted in Azure without
managing servers manually.

**Prerequisites:**
- [Azure Developer CLI (`azd`)](https://aka.ms/azd) — a command-line tool for
  deploying apps to Azure
- [PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)
  (`pwsh`) — needed for the post-deploy script that sets up Graph permissions
- An Azure subscription with permission to create resources

```bash
azd init --template russrimm/MicrosoftCommunicationsPortal
azd up
```

After `azd up` finishes, the post-provision hook will offer to set up Graph
permissions for Message Center and Service Health automatically.

**Enable Entra ID authentication (recommended for shared deployments):**

By default the App Service is deployed without login requirements — anyone with the
URL can access it. To require users to sign in with their organizational account
before using the portal, set the `authClientId` parameter:

```bash
azd env set AUTH_CLIENT_ID <your-entra-app-client-id>
azd up
```

This turns on "Easy Auth" on the App Service, so unauthenticated visitors are
redirected to the Entra ID login page. **Strongly recommended** if the portal will
hold Graph credentials or AI API keys, since those enable access to tenant data and
billed API calls.

### Option 2 — Docker *(recommended for quick trials or on-prem)*

**What this does:** Runs the portal in a Docker container — a lightweight,
self-contained package that includes everything the app needs. No need to install
Node.js or other tools on your machine.

**Best for:** Trying the portal quickly, running on an existing Docker host, or
deploying on-premises where Azure isn't available.

**Prerequisite:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(Windows/Mac) or Docker Engine (Linux).

Pull and run:

```bash
docker run -p 127.0.0.1:3000:3000 ghcr.io/russrimm/microsoftcommunicationsportal:latest
```

Or build from source:

```bash
docker build -t mcp .
docker run -p 127.0.0.1:3000:3000 mcp
```

Open http://localhost:3000. Seven pages work immediately.

> **Security note:** The examples above bind to `127.0.0.1` (loopback), which means
> only your local machine can reach the portal. Using `-p 3000:3000` instead exposes
> it on all network interfaces — only do that behind an authenticated reverse proxy
> on a trusted network, since the app can hold Graph credentials and call billed
> LLM APIs.

For Graph-backed pages (Message Center, Service Health), pass credentials as
environment variables:

```bash
docker run -p 127.0.0.1:3000:3000 \
  -e AZURE_TENANT_ID=your-tenant-id \
  -e AZURE_CLIENT_ID=your-client-id \
  -e AZURE_CLIENT_SECRET=your-client-secret \
  mcp
```

> **Where do these values come from?** See [Setup step 2](#setup) below — it walks
> you through creating the Entra app registration that produces these three values.

### Option 3 — Run locally *(best for development and testing)*

**What this does:** Clones the source code and runs the portal directly on your
machine using Node.js. You can edit the code and see changes immediately.

**Best for:** Developers who want to customize the portal, contribute code, or just
kick the tires without Docker or Azure.

**Prerequisites:**

| Prerequisite | Version | Check | Install |
|---|---|---|---|
| **Node.js** (LTS) | 24.x or later | `node -v` | [nodejs.org/download](https://nodejs.org/en/download) |
| **npm** | Bundled with Node | `npm -v` | Comes with Node.js |
| **Git** | Any recent | `git --version` | [git-scm.com](https://git-scm.com/) |
| **PowerShell 7+** *(optional)* | 7.x | `pwsh -v` | [Install PowerShell](https://learn.microsoft.com/powershell/scripting/install/installing-powershell) |
| **Azure CLI** *(optional)* | Any recent | `az --version` | [Install Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) |

> **Node.js note:** The server uses the built-in `http`, `https`, `crypto`, and `URL` APIs with no native add-ons, so any Node 24 LTS build (x64, ARM64, etc.) works. Earlier versions (18–22) may work but are not tested.
>
> **Optional tools:** PowerShell 7+ and Azure CLI are only needed if you want to run `scripts/create-entra-app.ps1` to set up Graph API credentials for the Message Center and Service Health pages.

**Clone and run:**

```bash
git clone https://github.com/russrimm/MicrosoftCommunicationsPortal.git
cd MicrosoftCommunicationsPortal
npm install
npm start            # production mode
# or
npm run dev           # watch mode — auto-restarts on file changes
```

Open http://localhost:3000. Seven of nine pages work immediately with no credentials.

For Graph-backed pages (Message Center, Service Health), copy `.env.example` to `.env` and fill in your Entra app credentials — or run `pwsh scripts/create-entra-app.ps1` to automate it.

## Screenshots

All 9 pages are shown in light and dark mode below (18 screenshots). Regenerate with
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

### Guided Report

| Light | Dark |
|---|---|
| ![Guided Report — light](screenshots/guided-report-light.png) | ![Guided Report — dark](screenshots/guided-report-dark.png) |

## Setup

> **For a faster setup, see [Quick Deploy](#quick-deploy) above.**

### Step 1 — Install dependencies

```bash
npm install
```

This downloads the one runtime dependency (`dotenv`) and is required before the
server can start.

### Step 2 — Configure Microsoft Graph authentication

*(Required only for the Message Center and Service Health pages. Skip this step
if you only need the other seven pages.)*

The Message Center and Service Health pages pull data from
[Microsoft Graph](https://learn.microsoft.com/graph/overview) — Microsoft's API
for reading your tenant's admin announcements and service incidents. To access
Graph, the portal needs credentials that prove it has permission to read that data.

**Which option should I pick?**

| Option | Best for | Pros | Cons |
|--------|----------|------|------|
| **A — Managed identity** | Portal hosted on Azure (App Service, Container Apps, VM) | No secrets to manage or rotate; most secure; the Azure platform handles tokens automatically | Only works when running on Azure infrastructure; requires CLI commands to grant Graph permissions (can't use the portal UI) |
| **B — Automated script** | Local development, or non-Azure servers | One command does everything; writes credentials to `.env` automatically; idempotent (safe to re-run) | Requires PowerShell 7+ and Azure CLI installed locally; needs an admin account that can grant tenant-wide consent |
| **C — Manual portal UI** | When you can't run scripts, or prefer clicking through the Azure portal | No tools needed beyond a web browser; good for learning how app registrations work | More steps; easy to miss a step; you must copy/paste secrets carefully |

> **What is an "app registration"?** It's an identity record in Microsoft Entra ID
> (formerly Azure AD) that represents this portal. Think of it as a username and
> password for the app itself (not for any human user). The portal uses it to call
> Microsoft Graph on behalf of your organization, without any user needing to sign in.

> **What is "admin consent"?** Some Graph permissions are sensitive enough that a
> tenant administrator must explicitly approve them. The two permissions this portal
> needs (`ServiceMessage.Read.All` and `ServiceHealth.Read.All`) both require admin
> consent — meaning a Global Administrator, Privileged Role Administrator, or Cloud
> Application Administrator must click "Grant" before the portal can read data.

---

#### Option A — Managed identity *(recommended for Azure deployments)*

**What is a managed identity?** When you host an app on Azure, the platform can
automatically give it an identity (like a built-in service account) so it can call
other Microsoft services without you having to create or store any passwords. Azure
handles the credential lifecycle — no secrets to rotate or leak.

If the portal runs on Azure (App Service, Container Apps, or a VM), assign a
system- or user-assigned managed identity to the host and grant it two Graph
**application** permissions with admin consent. Then set one variable in `.env`:

```
USE_MANAGED_IDENTITY=true
```

**System-assigned vs. user-assigned identity:**
- **System-assigned** (simpler): Azure creates the identity automatically when you
  enable it on the App Service. It's tied to that specific resource and deleted if
  the resource is deleted. No extra configuration needed.
- **User-assigned** (more flexible): You create the identity separately and attach
  it to one or more resources. Useful if you want to share one identity across
  multiple apps. If you use this type, also add its client ID to `.env`:
  ```
  AZURE_MI_CLIENT_ID=<managed-identity-client-id>
  ```

No client secret is needed — the platform issues the token automatically. On
App Service / Container Apps the `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`
environment variables are set by the platform. On a VM the Azure IMDS endpoint
is used.

> **`azd up` users:** the post-provision hook runs `scripts/create-entra-app.ps1`
> which automatically grants these Graph permissions to the App Service managed
> identity — no manual steps needed.

**Granting Graph permissions to a managed identity manually**

Graph application permissions cannot be added through the portal UI for managed
identities — you must use the CLI or Microsoft Graph API. Run these commands as
a Global Administrator (or Privileged Role Administrator):

   ```powershell
   # 1. Get the managed identity's object ID
   $miObjectId = az webapp identity show `
       --name <app-service-name> -g <resource-group> `
       --query principalId -o tsv

   # 2. Get the Microsoft Graph service principal's object ID in your tenant
   $graphSpId = az ad sp show `
       --id "00000003-0000-0000-c000-000000000000" `
       --query id -o tsv

   # 3. Grant ServiceMessage.Read.All (Message Center)
   az rest --method POST `
       --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$graphSpId/appRoleAssignments" `
       --body "{`"principalId`":`"$miObjectId`",`"resourceId`":`"$graphSpId`",`"appRoleId`":`"1b620472-6534-4fe6-9df2-4680e8aa28ec`"}"

   # 4. Grant ServiceHealth.Read.All (Service Health)
   az rest --method POST `
       --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$graphSpId/appRoleAssignments" `
       --body "{`"principalId`":`"$miObjectId`",`"resourceId`":`"$graphSpId`",`"appRoleId`":`"79c261e0-fe76-4144-aad5-bdc68fbe4037`"}"
   ```

   You can verify the assignments in Azure portal → Entra ID → Enterprise
   applications → search for the managed identity object ID → Permissions.

---

#### Option B — Automated script *(recommended for local dev or non-Azure hosts)*

**What this does:** Runs a PowerShell script that creates the app registration,
adds the two required permissions, grants admin consent, creates a client secret,
and writes everything into your `.env` file automatically. If the app registration
already exists, it reuses it (safe to re-run).

**You'll need:**
- An account that can register apps **and** grant tenant-wide admin consent
  (Global Administrator, Privileged Role Administrator, or Cloud Application
  Administrator)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed
- [PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)
  installed (`pwsh`)

**Steps:**

1. Sign in to Azure CLI with your admin account:
   ```powershell
   az login --tenant <your-tenant-id>
   ```
   *(Replace `<your-tenant-id>` with your organization's tenant ID — find it in
   Azure portal → Entra ID → Overview.)*

2. Run the setup script:
   ```powershell
   pwsh .\scripts\create-entra-app.ps1
   ```

3. The script writes `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`
   into `.env`. You're done — skip ahead to [Step 3](#step-3--configure-azure-service-health).

**Optional overrides** (set before running):

```powershell
$env:APP_NAME     = 'My Portal Name'   # default: Microsoft Communications Portal
$env:SECRET_YEARS = '1'                # default: 2 years
```

---

#### Option C — Manual setup via the portal UI

Use this if you prefer clicking through the Azure portal or can't install
PowerShell / Azure CLI.

<details>
<summary>Click to expand step-by-step instructions</summary>

**Step 2a — Create the app registration**

1. Sign in to the [Entra admin center](https://entra.microsoft.com) (or
   [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppRegistrations)).
2. Go to **Identity → Applications → App registrations** and click **+ New registration**.
3. Fill in:
   - **Name:** `Microsoft Communications Portal` (or any name you like)
   - **Supported account types:** *Accounts in this organizational directory only
     (Single tenant)* — this means only users and apps in your organization can use it.
   - **Redirect URI:** leave blank — this app uses the "client-credentials flow"
     (app-to-app authentication), so no redirect is needed.
4. Click **Register**.
5. On the **Overview** blade, copy these two values — you'll paste them into `.env` later:
   - **Application (client) ID** → this becomes `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → this becomes `AZURE_TENANT_ID`

**Step 2b — Add Microsoft Graph API permissions**

These permissions tell Microsoft Graph what data the portal is allowed to read.

1. In the new app registration, go to **API permissions → + Add a permission**.
2. Choose **Microsoft Graph → Application permissions** (NOT "Delegated" — that's
   for apps where a user signs in; this portal uses app-only access).
3. Search for and check each of these permissions:
   - `ServiceMessage.Read.All` — lets the portal read Message Center announcements
   - `ServiceHealth.Read.All` — lets the portal read Service Health incidents
4. Click **Add permissions**.
5. Back on the **API permissions** blade, click **Grant admin consent for &lt;your tenant&gt;**
   and confirm. The **Status** column should show a green check ✅ for both permissions.

   > **Don't see the "Grant admin consent" button?** You need to be signed in as a
   > Global Administrator, Privileged Role Administrator, or Cloud Application
   > Administrator. Ask your IT admin to grant consent on your behalf.

**Step 2c — Create a client secret**

A client secret is like a password for the app registration. The portal uses it to
prove its identity when calling Microsoft Graph.

1. Go to **Certificates & secrets → Client secrets → + New client secret**.
2. Enter a description (e.g. `portal-local-dev`) and pick an expiration (6–24 months).
   Shorter is more secure but means you'll need to rotate it sooner.
3. Click **Add**.
4. **Immediately copy the secret's `Value`** (not the "Secret ID") — it's only shown
   once. This is your `AZURE_CLIENT_SECRET`. If you navigate away before copying it,
   delete it and create a new one.

**Step 2d — Create your `.env` file**

1. Copy the template:
   ```bash
   # macOS / Linux
   cp .env.example .env

   # Windows PowerShell
   Copy-Item .env.example .env
   ```
2. Open `.env` in any text editor and paste in the three values you collected:
   ```
   AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000
   AZURE_CLIENT_SECRET=your-client-secret-value
   AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000
   ```

</details>

> **Keep secrets safe.** Treat the client secret like a password — never commit
> `.env` to source control (the included `.gitignore` already excludes it). The
> server reads `.env` at startup, so restart `node server.js` after any change.
>
> **Data delay:** Message Center and Service Health data can take **up to ~1 hour**
> to appear after first consent while Microsoft Graph provisions access to your
> tenant's data. This is a one-time delay.

### Step 3 — Configure Azure Service Health

*(Optional — only needed for the Azure Service Health page. Skip if you don't
need Azure-level health monitoring.)*

**What is Azure Service Health?** While the M365 Service Health page (Step 2)
shows incidents for Microsoft 365 services (Teams, Exchange, SharePoint, etc.),
the **Azure Service Health** page shows incidents for Azure infrastructure services
(Virtual Machines, App Service, Storage, etc.) in your specific subscriptions.

**How it works:** This page uses the
[Azure Resource Manager (ARM) REST API](https://learn.microsoft.com/rest/api/resourcehealth/)
(`management.azure.com`) — a different API from Microsoft Graph. It reuses the same
credentials (managed identity or client secret) you set up in Step 2, but the
service principal also needs an **Azure RBAC role** (a permission assignment) on the
Azure subscription(s) you want to monitor.

> **What is RBAC?** Role-Based Access Control is Azure's permission system. You
> assign a "role" (like "Reader") to an identity (like your app registration) on a
> "scope" (like a subscription). This grants the identity specific permissions within
> that scope.

**Steps:**

1. **Assign a Reader role** to your app registration's service principal (or managed
   identity) on each Azure subscription you want to monitor:

   ```bash
   # Replace the placeholders with your values:
   az role assignment create \
       --assignee <service-principal-app-id-or-managed-identity-object-id> \
       --role "Reader" \
       --scope "/subscriptions/<subscription-id>"
   ```

   > **Which role?** `Reader` is the simplest choice — it grants read-only access
   > to all resources in the subscription. For a more restrictive option, use
   > `Resource Health Reader` which only grants access to health data. Either works.

   > **Where do I find my subscription ID?** Azure portal → Subscriptions → click
   > your subscription → the **Subscription ID** is shown on the Overview blade.

2. **Set the default subscription** in `.env` (optional — you can also pick
   subscriptions in the UI):
   ```
   AZURE_SUBSCRIPTION_ID=your-subscription-id-here
   ```

Without a role assignment, the ARM API calls will return `403 Forbidden`. The portal
includes a subscription picker on the Azure Service Health page so you can select
which subscriptions to monitor after the role is granted.

### Step 4 — Run the server

```bash
npm start
# or
node server.js
```

### Step 5 — Open in browser

Navigate to http://localhost:3000. The home page shows status cards for all
configured data sources so you can confirm which pages are working.

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
- **Entra ID Easy Auth** — the Bicep infrastructure supports enabling Entra ID
  authentication on the App Service via the `authClientId` parameter. When set,
  all requests require an Entra ID sign-in before reaching the app — protecting
  tenant-sensitive Graph data, Azure Resource Health endpoints, and billed LLM
  API calls from unauthenticated access. See [Quick Deploy](#quick-deploy).
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

The portal can call an LLM (Large Language Model) to surface what actually matters
in the firehose of Microsoft updates. When enabled, every feed page shows:

- A **Top 5 most impactful changes** digest at the top of the page (covers the
  last 14 days, refreshed on demand), with one-line themes and an overall headline.
- A **✨ Summarize with AI** button inside each announcement's detail modal —
  produces a plain-language summary, an impact rating (high/medium/low), the
  intended audience (IT admins, end users, developers, security), and a flag
  if admin action is required before a deadline.

**How to enable:** Pick **one** of the three providers below, set the corresponding
variables in `.env`, and restart the server. The server auto-detects which provider
to use (priority: Azure OpenAI → OpenAI → GitHub Models). When no AI provider is
configured the portal still works fine — the AI panel just shows a note pointing
to `.env.example`.

**Which provider should I pick?**

| Provider | Env vars to set | Pros | Cons | Cost |
|----------|----------------|------|------|------|
| **Azure OpenAI** | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, *(optional)* `AZURE_OPENAI_API_VERSION` | Data stays in your Azure tenant (best for compliance); enterprise SLAs; content filtering built in | Requires an Azure OpenAI resource (need to [apply for access](https://aka.ms/oai/access) if you don't have one); most setup steps | Pay-per-token (very low with `gpt-4o-mini`) |
| **OpenAI** | `OPENAI_API_KEY`, *(optional)* `OPENAI_MODEL`, `OPENAI_BASE_URL` | Fastest setup — just paste an API key; no Azure subscription needed | Data leaves your tenant; usage is billed to your OpenAI account | Pay-per-token |
| **GitHub Models** | `GITHUB_TOKEN`, *(optional)* `GITHUB_MODEL` | **Free tier** — great for trying it out; no billing setup | Rate limits on free tier; data processed by GitHub; not for production workloads | Free (with limits) |

**Recommended model:** `gpt-4o-mini` (or your deployment name for Azure OpenAI) —
fast, cheap, and plenty capable for this kind of triage.

**Example `.env` for each provider:**

```bash
# ── Azure OpenAI (recommended for enterprise) ──
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-azure-openai-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini

# ── OpenAI (quickest setup) ──
OPENAI_API_KEY=sk-...

# ── GitHub Models (free, great for testing) ──
GITHUB_TOKEN=ghp_...
```

Responses are cached in memory (summaries for 10 minutes, digests for 15 minutes)
so repeat views don't burn tokens.

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
| `GET /static/<file>` | Shared client JS (`util.js`, `nav.js`, `product-icons.js`, `outlook-export.js`, `ai-insights.js`, `export-formats.js`, `subscription-picker.js`) and CSS (`common.css`, page-specific stylesheets) | None | — |
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
powerplatform.html               Power Platform Release Planner UI
m365updates.html                 M365 Roadmap UI
azureupdates.html                Azure Updates UI
fabricroadmap.html               Microsoft Fabric Roadmap UI
messagecenter.html               M365 Message Center UI
servicehealth.html               M365 Service Health UI
azureservicehealth.html          Azure Service Health UI
guidedreport.html                Guided Report wizard (multi-source report builder)
server.js                        Node HTTP server, static file host, API proxy, AI endpoints
static/
  util.js                        Shared client-side utilities (escapeHtml, sanitizeHtml, safeUrl, theme toggle, event delegation)
  nav.js                         Shared navigation header and dropdown menu (injected into every page)
  common.css                     Shared CSS (nav dropdowns, header, layout primitives)
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

- **Node.js 24 LTS** or later (uses the built-in `http`, `https`, `crypto`, and global `URL` APIs — no native add-ons)
- **npm** (bundled with Node.js)
- An Entra app registration (only for the Message Center and Service Health pages)
- PowerShell 7+ and Azure CLI (only if using `scripts/create-entra-app.ps1`)

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
