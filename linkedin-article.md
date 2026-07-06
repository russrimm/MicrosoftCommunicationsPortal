# I Got Tired of Checking Six Portals Every Morning — So I Built One That Checks Them All

---

You know that Monday morning feeling — you open the M365 Admin Center and there's a Message Center post about a Teams policy change rolling out in 30 days. You flip to Azure and Service Health flagged something over the weekend. Power Platform just shipped a GA feature your devs have been asking about. And somewhere in a 200-item roadmap, there's a retirement notice for a service your finance team actually depends on.

Six portals. Six different UIs. Some need admin creds. Some are RSS feeds nobody remembers to check. Some show up in email threads that get buried under everything else.

I kept running into this with customers — and honestly with myself — so I built something to fix it.

---

## The pain points that wouldn't go away

I've been a Cloud Solution Architect at Microsoft for a while now, and the same problems kept coming up in every customer conversation:

**Portal fatigue.** Between the M365 Admin Center, Azure Portal, Power Platform Admin Center, the M365 Roadmap site, Azure Updates, and the Fabric Roadmap — that's 6+ surfaces you're supposed to monitor just to stay informed. Nobody has time for that.

**Imporant updates get missed.** A breaking change buried in 50 Message Center posts? A service retirement that lands during a busy week? You don't find out until someone in finance asks "why did this stop working?" and now you're in reactive mode. After all, it's Murphy's #1 Law.

**Teams working in silos.** Your infra team watches Azure Service Health. Your collab team watches M365 updates. Your app dev folks track Power Platform releases. Nobody has the cross-cutting view — and nobody can brief leadership with a coherent story because the data lives in six different places.

**Reporting is painful.** When your CIO asks "what's changing in our Microsoft environment this quarter?" — the answer is hours of copy-pasting from multiple portals into a slide deck. Every. Single. Time.

---

## So I built the Microsoft Communications Portal

It's open source, MIT-licensed, and any org can deploy it internally. It pulls **eight Microsoft communication streams** into one filterable, light/dark-mode-friendly interface:

| Stream | What it covers |
|--------|---------------|
| **Power Platform Release Planner** | Planned features and timelines for Power Apps, Power Automate, Power BI, Copilot Studio |
| **Microsoft 365 Roadmap** | Current and upcoming M365 features |
| **Azure Updates** | Azure product announcements and launches |
| **Microsoft Fabric Roadmap** | Release features across 14 Fabric product areas |
| **Microsoft 365 Message Center** | Tenant-specific admin communications and action items |
| **Microsoft 365 Service Health** | Service incidents and advisories for your tenant |
| **Azure Service Health** | Azure service issues, maintenance, and health advisories per subscription |
| **Guided Report Builder** | Focused exports by date range and product |

---

## The stuff that actually matters day-to-day

**One URL, zero portal-hopping.**
Your team opens one page and sees everything. No more bouncing between six admin portals before your first coffee.

**AI summaries if you want them.**
Wire up Azure OpenAI, OpenAI, or GitHub Models and you get a "Top 5 Most Impactful Changes This Week" digest at the top of each feed — plus per-item summaries with impact ratings, audience tags, and deadlines. It turns the firehose into something you can actually act on. Totally optional — the portal works great without it.

**One-click Outlook export.**
Every page has an export button that generates an inline-styled HTML table — the kind that actually renders in Outlook (because Outlook strips `<style>` blocks, as we all know). Your weekly stakeholder update goes from an hour of manual work to one click.

**Export however you want.**
Outlook HTML, Markdown, PDF, Word-compatible docs, PowerPoint — the Guided Report Builder lets you filter by date range and product before exporting. Pick your format and go.

**Works without credentials (mostly).**
Seven of nine pages work with zero setup — just deploy and go. Only Message Center and Service Health need an Entra app registration for tenant-specific data. You can stand it up in minutes to kick the tires.

**Deploy however you want.**
- `azd up` gets you to Azure App Service in two commands
- Docker container on GitHub Container Registry if that's more your thing
- `npm start` locally for development
- Managed identity support — no secrets needed in Azure

**Security is baked in — not bolted on.**
Strict CSP with cryptographic nonces, allow-list HTML sanitization, per-IP rate limiting, prototype pollution guards, Graph tokens that never leave Microsoft-bound requests. The boring stuff that matters.

---

## Who's this for?

Honestly, anyone who's tired of the portal sprawl:

- **IT admins** who check six portals before lunch
- **Cloud architects** who need the cross-platform picture
- **IT directors and CIOs** who want a weekly briefing without the manual effort
- **MSPs** juggling multiple tenants
- **Change advisory boards** who need one source of truth for Microsoft platform changes

---

## This is a community project — come build it with me

Here's the thing — I built this to scratch my own itch and solve real problems I was seeing with customers. But I know there are gaps, rough edges, and ideas I haven't thought of yet. That's why it's open source.

If you deploy it and think "this would be way better if it also did X" — open an issue, submit a PR, or just reach out. I'd genuinely love to collaborate on making this more useful. Whether it's a bug fix, a new export format, better filtering, accessibility improvements, or a feature I haven't even considered — contributions are welcome and appreciated.

The goal isn't for this to be *my* project — it's for it to be something the community finds useful and helps shape. So fork it, break it, improve it, and let me know what you think.

---

**🔗 GitHub:** github.com/russrimm/MicrosoftCommunicationsPortal

*Built by Russ Rimmerman, Cloud Solution Architect at Microsoft. This is a community project — not an official Microsoft product — but built from real customer needs and shipped as open source because I think it should exist for everyone.*

---

#Microsoft365 #Azure #PowerPlatform #CloudManagement #ITOperations #ChangeManagement #OpenSource #MicrosoftCloud #DigitalTransformation #ITLeadership #AzureOpenAI #ServiceHealth
