# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Frontend / HTML pages / theming / client-side JS | Lambert | Edit any of the 5 pages, add filters, fix dark-mode issues, `?clawpilotTheme=` behavior |
| Backend / `server.js` / proxy / auth / RSS / Graph | Parker | Add/modify upstream routes, cache tuning, Graph token handling, `.env` conventions, `scripts/` |
| Architecture / scope / cross-cutting review | Ripley | Should we add Azure Management? Should we split server.js? Review multi-file PRs |
| Testing / doc-vs-code drift / capability audit / gap analysis | Kane | Verify README setup steps, probe error paths, catalog what the app claims vs delivers |
| Code review across areas | Ripley | Reviewer of last resort; can escalate to specialist |
| Session logging | Scribe | Automatic — never needs routing |
| RAI review | Rai | Content safety, secret leaks, bias, ethical review |
| Work-queue monitoring / backlog | Ralph | "Ralph, go" / "keep working" |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Ripley |
| `squad:ripley`  | Architecture / cross-cutting / triage rework | Ripley |
| `squad:lambert` | Frontend page work | Lambert |
| `squad:parker`  | Backend / proxy / auth work | Parker |
| `squad:kane`    | Test / doc-drift / audit work | Kane |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Ripley** triages — reads it, assigns the right `squad:{member}` label, and comments with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Ripley.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn for "what port does it run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn Ripley + Lambert + Parker + Kane in parallel as `mode: "background"`.
6. **Anticipate downstream work.** New feature? Spawn Kane to draft tests/audits simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied, route to that member. All `squad` triage → Ripley.
