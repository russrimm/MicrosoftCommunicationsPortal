# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — single-pane-of-glass web app aggregating Microsoft update/health streams. Static HTML per page, no framework.
- **Stack:** HTML/CSS/vanilla JS. Light + dark themes via `?clawpilotTheme=light|dark` and a header toggle. Screenshots captured at 1440×900 @ 2× DPR via Playwright.
- **Pages:** `/powerplatform` (powerplatform.html), `/m365updates`, `/azureupdates`, `/messagecenter`, `/servicehealth`. Root `/` redirects to `/powerplatform`.
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-07-05: README Quick Deploy section
- Added Quick Deploy section to README with azd and Docker instructions
- Added GitHub Codespaces badge
- Kane noted GHCR image reference doesn't exist yet — will need to be created or updated when CI publishes
- Changed `.sh-top-row` from 3-column to 2-column grid
- Created `.sh-top-left` wrapper to stack Overview + By Service panels vertically in left column
- Trend chart gets full right column (~60% width)
- Added `max-height: 220px` on By Service panel to prevent unbounded growth
- No JS changes needed — all element IDs and hooks preserved

## 2026-07-06 – Service Health layout cleanup

**Files changed:** `servicehealth.html`, `static/servicehealth.css`

### Problems fixed:
1. **Missing CSS grid rules** — `sh-top-row`, `sh-top-left`, `sh-top-right` had no CSS definitions. Added a 320px / 1fr two-column grid with responsive collapse at 1000px.
2. **Information hierarchy was flat** — everything competed for attention in the cramped right column.

### Layout changes:
- **Left column (320px fixed):** Overview donut + By Service breakdown — compact status at a glance
- **Right column (fluid):** Recent Activity + Uptime Heatmap — activity-focused, scrollable
- **Trend chart moved to full-width** below the top row — benefits from horizontal space for readability
- **Current Issues** stays full-width at the bottom (unchanged)

### Visual refinements:
- Donut: 80→68px, number 20→17px, label 10→9px — more compact
- Legend gap: 0.4→0.3rem — denser
- Activity list: capped at 220px max-height so it doesn't push heatmap off-screen
- Trend chart: 150→100px height — appropriate for full-width display
- Both dark and light themes unaffected (only structural CSS changed)

### What was NOT changed:
- No JS rendering logic touched
- All element IDs preserved — JS bindings intact
- Dark/light theme variables untouched

## 2026-07-06 – Shared Nav, Mobile, Focus Traps, State Helpers

**Files created:** `static/nav.js`
**Files modified:** `static/util.js`, `static/common.css`, all 9 HTML pages

### What was done:
1. **Shared nav (`nav.js`):** Single IIFE injects header/nav/dropdown into all pages. Theme toggle via `data-act="toggleTheme"` + CPActions. Eliminated ~360 lines of copy-pasted markup.
2. **Mobile responsive:** `@media` breakpoints at 768px and 480px in `common.css` for header, nav tabs (horizontal scroll), modal.
3. **Focus traps:** `trapFocus(modalEl)` and `releaseFocus()` added to `util.js`. Wired into 6 modal pages (powerplatform, m365updates, azureupdates, fabricroadmap, messagecenter, servicehealth).
4. **State helpers:** `CPUtil.renderLoading()`, `renderError()`, `renderEmpty()` in `util.js` + `.cp-state` CSS classes. For new code — existing page states untouched.
5. **Home theme fix:** `home.html` now loads `util.js`, removed ad-hoc theme toggle script.

### Learnings:
- Nav link to Azure Service Health was inconsistent (`/servicehealth#arh-section` vs `/azureservicehealth`) — standardized to `/azureservicehealth`
- `servicehealth.html` has a `window.toggleTheme` wrapper for chart re-render that must be preserved even when using CPActions
- FOUC-prevention IIFE in `<head>` must stay — `nav.js` runs after DOM, so the theme class is already set
- `util.js` must load before `nav.js` in script order
