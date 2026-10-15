# Audit fix log

Working branch: `ui/ux` (PR #144). **Front end only**: another person owns the back end, so no API
routes, commands, migrations, schema or `src/platform` / domain-module server code are changed.

## Scope decisions (agreed with the product owner)

- Stay on `ui/ux`; no new branch.
- Back end is off limits. Every brief item that needs a server rule, a new table, a new endpoint or a
  background job is built as far as the UI allows (guards computed from data the UI already receives,
  messages mapped from existing error text/codes) and recorded below as **Partly done / Blocked: needs back end**.
- New npm packages are allowed.
- Styling: the repo uses global CSS tokens (no Tailwind). Brief Tailwind classes are translated to CSS.
- Work context: extend the existing canonical module `src/modules/context` (cookie
  `shanda-fuel-context`, `/api/context`) instead of creating a `sf_ctx` cookie. Its README forbids a
  second selector or cookie.
- Step order rule (Close shift before Enter figures) is the intended business rule.
- Skipped: the 23:00 "day not closed" notification (needs a scheduled job).
- Commit at the end of each phase; push only when asked; never merge to `main`.

## Codebase map

- Framework: Next.js 16 (App Router, Turbopack), React 19, TypeScript 6, pnpm 11, Node >=24.
- Scripts: `dev`, `build`, `lint` (eslint), `format:check` (prettier), `typecheck` (`next typegen && tsc --noEmit`),
  `test` (vitest), `test:integration`, `test:e2e` (playwright), `test:a11y`.
- Global CSS: `src/app/globals.css` (4.5k lines) plus `src/design-system/styles/*.css`; tokens in `tokens.css`/`tokens.ts`.
- Routes (`page.tsx`): `/`, `/login`, `/join`, `/invite/[token]`, `/workplace`, `/my-shift`, `/operations`,
  `/operations/daily`, `/operations/reconciliations/[id]` and `/review`, `/stations/[stationId]/cash`,
  `/stations/[stationId]/settlements`, `/stations/[stationId]/reconciliations` (+ `/new`, `/[id]`, `/[id]/review`),
  `/inventory`, `/inventory/valuation/...`, `/customers`, `/customers/[customerId]`, `/suppliers`,
  `/suppliers/[supplierId]`, `/reports`, `/reports/[slug]`, `/settings`, plus `/foundation`,
  `/design-system/*`, `/dev-preview/*`.
- Work context: server-owned `src/modules/context` (`resolveCurrentContext(request)`, `buildContextHref`,
  cookie `shanda-fuel-context`, `GET/POST /api/context`). UI: `src/design-system/context-selector.tsx`
  ("Switch station" modal) and `src/design-system/app-shell.tsx`. Nav links take context from the URL only
  (`readWorkContext` in `src/design-system/navigation.ts`), which is the root of bug 1.1.
  `src/app/my-shift/page.tsx` shows the pattern for resolving context in a page.
- "Choose a station / organisation" states: `operations/daily` (`DailyOperationsContextRequired`),
  `reports/page.tsx`, `reports/[slug]/page.tsx`, `inventory-workspace.tsx`, `settings-workspace.tsx`,
  `settlement-workspace.tsx`, `workplace/page.tsx`, `today-overview.tsx`.
- Workflow UI: `src/modules/forecourt/ui/` — `operations-control-room.tsx` (day/shift board),
  `daily-operations-workspace.tsx` (6-step wizard), `production-reconciliation-workflow.tsx`,
  `next-step-card.tsx` + `next-step.ts` (quick actions), `reconciliation-board.tsx`, `my-shift-workspace.tsx`.
- Raw system strings: `daily-operations-state.ts:45`, `daily-operations-workspace.tsx:664`,
  `operations-control-room.tsx:357`; server-originated (cannot change): `forecourt/commands.ts:146`,
  `platform/security/permissions.ts:480`.
- Status chip: `StatusBadge` in `src/design-system/primitives.tsx`. Money formatting:
  `src/design-system/formatters.ts` (`formatMoney`, `formatUsd`). Page header: `PageHeader` in
  `src/design-system/layout.tsx`. Search palette: `app-shell.tsx` (~line 1143, "Coming soon" at ~1193).
- E2E specs: `tests/e2e/*.spec.ts`; local run needs `APP_ENV=test AUTH_PROVIDER=BETTER_AUTH`.

## Progress (front end only, branch `ui/ux`)

Commits: `aed5753` (Phase 1), `594f4a4` / `5b9fbcd` / `8c50f2e` (Phase 2). Unit tests, lint and typecheck pass.

| Item | Status | Notes |
|---|---|---|
| 1.1 Work context | Done | Pages resolve the saved station via the existing `src/modules/context` (no `sf_ctx` cookie: that module forbids a second one). Nav links use the saved station. Re-selecting a station closes the dialog; switching refreshes. Empty copy updated. |
| 1.2 Workflow order | Partly done | UI guards, new step order, direct land on the wizard, Close meters sheet, disabled-with-reason all built. Server-side enforcement and typed error codes are back end (not done). Start-shift form has a Shift preset (sets time) but not an attendants picker: attendants can only be listed once a shift exists, and a supervisor's session gets an empty list (back end). |
| 1.3 Consistent status | Done | `getDisplayStatus` used on board, wizard, review, dashboard attention link. |
| 1.4 Plain-language errors | Done (UI) | `user-messages.ts`; server text is only used to pick a code. Typed codes from the server would make this exact. |
| 1.5 Confirmations | Done | Open day, start shift, submit, approve, send back, close day, close shift; Close meters sheet is its own confirmation. |
| 1.6 Review screen | Done | Approve/Send back only for approvers who did not submit. Approve needs step-up on the server. |
| 2.1–2.8 | Done | Search groups are built client-side from existing endpoints (no new `/api/search`). |
| 3.x | Not started | Mostly needs back end (new tables, jobs). See below. |
| 4 | Not started | Needs clean seed data and an e2e run. |

### Back-end issues found (not changed)
1. `SealSegment` runs `SELECT … FOR UPDATE` on `app.meter_segments`, but `app_runtime` has no UPDATE on that table, so sealing a segment fails with a permission error. This is the real cause of "Close meters failed with an internal error". (Locally worked around with a one-off GRANT on the dev database only.)
2. A supervisor's session gets an empty attendant list from `/api/forecourt/operations/daily` (the manager's session sees them), so "No attendants set up" appears for supervisors.
3. `ApproveProductionReconciliation` requires step-up assurance; there is no UI path to satisfy it from the review screen.
4. Boundary commands are versioned against the shift, segments against themselves (0); a segment cannot end in the future and segments per nozzle cannot overlap.
