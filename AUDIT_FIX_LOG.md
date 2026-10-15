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
