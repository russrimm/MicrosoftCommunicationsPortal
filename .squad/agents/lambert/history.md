# Project Context

- **Owner:** Russ Rimmerman
- **Project:** Microsoft Communications Portal — single-pane-of-glass web app aggregating Microsoft update/health streams. Static HTML per page, no framework.
- **Stack:** HTML/CSS/vanilla JS. Light + dark themes via `?clawpilotTheme=light|dark` and a header toggle. Screenshots captured at 1440×900 @ 2× DPR via Playwright.
- **Pages:** `/powerplatform` (index.html), `/m365updates`, `/azureupdates`, `/messagecenter`, `/servicehealth`. Root `/` redirects to `/powerplatform`.
- **Created:** 2026-07-04

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-07-05: Service health top-row layout reorganization
- Changed `.sh-top-row` from 3-column to 2-column grid
- Created `.sh-top-left` wrapper to stack Overview + By Service panels vertically in left column
- Trend chart gets full right column (~60% width)
- Added `max-height: 220px` on By Service panel to prevent unbounded growth
- No JS changes needed — all element IDs and hooks preserved
