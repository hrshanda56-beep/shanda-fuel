# Shanda Fuel UI foundation

This directory owns the presentation foundation for Shanda Fuel. It is intentionally
domain-neutral: examples use synthetic context and do not represent tenant, station,
financial, or product master data.

The locked product direction lives in `docs/release-readiness.md` (calm, airy, premium,
restrained; less is more). This foundation is how that direction is applied. Build
screens by composing it; do not add page-specific visual systems.

Visual reference: run `pnpm dev` and open `/design-system`. It renders every token and
primitive in the current theme. The route is internal and development-only: production
builds intentionally return 404 (`reference/availability.ts`, unit-tested). The E2E suite
exercises it through `next dev`, which Playwright uses locally and in CI.

## Structure

| File                             | Owns                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles/tokens.css`              | Palette, semantic colour (light + dark), type, space, radius, border, elevation, sizing, layout widths, motion, z-index, chart tokens, legacy aliases                                                                                             |
| `styles/base.css`                | Document defaults, typography, focus visibility, utilities, motion policy                                                                                                                                                                         |
| `styles/components.css`          | Styles for every primitive below                                                                                                                                                                                                                  |
| `styles/shell.css`               | Product Shell frame: sidebar, icon rail, top bar, drawer, content frame, route states, sign-in frame                                                                                                                                              |
| `tokens.ts`                      | Breakpoints, content widths, motion timings, chart series order for JS                                                                                                                                                                            |
| `theme.ts` / `theme-runtime.tsx` | Theme preference model, no-flash init script, `useThemePreference`                                                                                                                                                                                |
| `icons.tsx`                      | Minimal inline icon set (`Icon`)                                                                                                                                                                                                                  |
| `modal.tsx`                      | Controlled accessible `Modal` (focus trap, inert background, focus restore)                                                                                                                                                                       |
| `primitives.tsx`                 | `Button`, `IconButton`, `StatusBadge`, `Card`, `Field`, `NumericInput`, loading/skeleton/empty/error/access/not-found/conflict/success/context-required states, `DialogFrame`, `BottomSheet`, `RiskConfirmation`, `EvidenceFile`, `OfflineBanner` |
| `forms.tsx`                      | `Select`, `Checkbox`, `Radio`, `Fieldset`, `Disclosure`                                                                                                                                                                                           |
| `feedback.tsx`                   | `Notice`, `NeedsAttention`, `WipBadge`, `WorkInProgressPanel`                                                                                                                                                                                     |
| `dialogs.tsx`                    | `ConfirmDialog`, `WorkInProgressDialog`, `WorkInProgressTrigger`                                                                                                                                                                                  |
| `layout.tsx`                     | `PageHeader`, `PageContainer`, `Section`, `MetricCard`                                                                                                                                                                                            |
| `app-shell.tsx`                  | `AppShell` (the permanent Product Shell) and `Breadcrumbs`                                                                                                                                                                                        |
| `context-selector.tsx`           | Accessible shared context selector backed by the server context contract                                                                                                                                                                          |
| `navigation.ts`                  | Grouped navigation model, projection, work-context forwarding, current-route matching                                                                                                                                                             |
| `shell-preferences.ts`           | Per-device sidebar rail / closed-group preferences and their no-flash init script                                                                                                                                                                 |
| `theme-control.tsx`              | `ThemeControl` segmented System / Light / Dark radio group                                                                                                                                                                                        |
| `route-states.tsx`               | `RouteLoading`, `RouteError`, `RouteNotFound` (whole-page states inside the shell)                                                                                                                                                                |
| `formatters.ts`                  | Presentation-only money, litre, ratio, percentage, date, status labels                                                                                                                                                                            |

## Page patterns

`styles/patterns.css` is the single answer to "how is an ordinary screen laid out":
`.pg` (page stack), `.pg-intro`, `.pg-stats` / `.pg-stat`, `.pg-card`, `.pg-list` /
`.pg-list-item` / `.pg-details`, `.pg-form` / `.pg-form-grid`, `.pg-actions`. Compose these
instead of writing page CSS. Never put `overflow-wrap: anywhere` on a flex or grid child (it
lets the item collapse to one character per line), never repeat the page title the top bar
already shows, and never leave bullets on a record list. `patterns.test.ts` guards the file.

Stylesheets are imported once, in order, from `src/app/layout.tsx`:
tokens → base → components → shell → `src/app/globals.css` (module layouts only).

## Tokens

Use **semantic** tokens only: `--bg-*`, `--text-*`, `--border-*`, `--accent-*`,
`--tone-{positive,warning,critical,info,neutral,offline}-{fg,text,bg,border}`. Never use
`--palette-*` in components, and never add raw colour literals. The legacy `--color-*`
names are aliases kept so existing module CSS renders; do not use them in new code.

- **Colour:** neutral greys carry the interface. The Shanda Fuel green (`#0d6b58`) is the
  accent: primary actions, focus, selection, links, and "informational" status. Use it
  sparingly; a screen should read as mostly neutral.
- **Type:** the native system UI stack (SF Pro, Segoe UI Variable, Roboto): no web-font
  download or layout shift. `--font-size-2xs` … `--font-size-4xl`. Controls and tables use `md` (14px),
  reading text `base` (15px). Weights stop at semibold (600) for headings; avoid bold
  walls. Numbers use `.numeric` (tabular figures).
- **Space:** 4px scale `--space-1` … `--space-20`. Page rhythm uses `--page-gutter`,
  `--page-block`, `--section-gap`, `--grid-gap` (fluid).
- **Radius:** `xs 4 · sm 6 · md 8 (controls) · lg 12 (cards) · xl 16 (dialogs) · full`.
- **Elevation:** borders carry structure; shadows only hint (`--shadow-xs` on cards,
  `--shadow-lg` on dialogs).
- **Sizing:** controls `sm 32 · md 40 · lg 44`px; coarse pointers get 44px minimum targets.
- **Widths:** `--content-narrow` (forms), `--content-default` (workspaces),
  `--content-wide` (dense reconciliation/reporting), `--measure` for prose.
- **Breakpoints** (mobile-first, min-width): `sm 40rem · md 48rem · lg 64rem · xl 80rem`.
  Tablet layouts begin at `md`; the persistent sidebar begins at `lg`.
- **Motion:** `--duration-fast 120 · base 180 · slow 260`ms with `--ease-standard` /
  `--ease-out`. Motion is functional only (state change, entry/exit, loading); no
  decorative animation. Reduced-motion users get instant changes.

`tokens.test.ts` enforces WCAG 2.2 AA contrast for every text/background pairing and
3:1 for focus rings, control borders, and status icons, in both themes, and keeps the
two dark-theme declarations identical. Run it after any colour change.

## Themes

Light and dark are both first-class. Default is the device preference. An explicit
override sets `<html data-theme="light|dark">`, persisted per device in localStorage
(`shanda-fuel:theme`); an inline script in the root layout applies it before first paint.
The Product Shell's `ThemeControl` uses `useThemePreference()` from `theme-runtime.tsx`.
Theme preference is presentation only and never sent to the server.

The current Content Security Policy allows inline scripts. If it is tightened, the inline
init script in `src/app/layout.tsx` (theme + shell preferences) needs a nonce or hash.

## Product Shell

Every product page renders inside `AppShell`; do not add per-page navigation markup.

- **Desktop (≥ 75rem):** persistent sidebar grouped as Today, Operations, Finance,
  Suppliers, Reports, Settings. Groups with several destinations collapse
  (`aria-expanded`); single-destination sections are plain links. The sidebar collapses to
  an icon rail whose labels become hover/focus tooltips. Rail and closed groups persist per
  device (`shell-preferences.ts`); the rail is applied before first paint.
- **Tablet (48–74.99rem):** a persistent icon rail with hover/focus labels. Phone (<48rem)
  gets a slim sticky top bar; the menu opens the same grouped navigation in a `Modal` drawer
  (`presentation="drawer"`). The theme control lives in the account menu only.
- **Current route:** `aria-current="page"` on the link, shown as a raised neutral surface
  with an accent icon; a closed group containing it is marked the same way.
- **Destinations:** only existing routes are linked. Planned areas open
  `WorkInProgressDialog`. Station-scoped areas open the shared `ContextSelector` when a
  station is missing. Navigation forwards `tenantId`, `legalEntityId` and `stationId` from
  the current URL; they are not grants and every page re-validates them server-side.
- **Context and attention:** the shell's `ContextSelector` consumes the single server-owned
  contract in `src/modules/context` and never reads localStorage or trusts client IDs. Its
  route policy makes `All stations` explicit. Pages may pass a synthetic `context` only as a
  display fallback while the server projection loads. `attention` is optional and must come
  from the server; the shell never invents items.

See [`src/modules/context/README.md`](../modules/context/README.md) for the consuming-agent
contract: current-context resolution, station/legal-entity requirements, explicit all-stations
semantics, validated navigation, and the server-owned files feature agents must not modify.

- **Route states:** `src/app/error.tsx`, `not-found.tsx` and segment `loading.tsx` files
  render `route-states.tsx` inside the shell, so navigation stays put.

## Patterns

- **Buttons:** one `primary` per region; `secondary` for alternatives; `quiet` for
  low-emphasis; `danger` only for destructive or irreversible commands. Labels are
  verb + object. `IconButton` requires `label`.
- **Forms:** persistent label above the control, hint below the label, error below the
  control with an icon. Mark required fields; label optional ones. Keep flows short;
  put secondary fields in `Disclosure` (never required ones). Wrap native controls in
  `Field`; use `Select`, `Checkbox`, `Radio`, `Fieldset` for structure.
- **Tables:** `.table` (or legacy `.data-table` / `.responsive-table`) inside
  `.table-wrap`. Hairline rows, no zebra stripes or vertical rules, quiet sentence-case
  headers, `.cell-numeric` for right-aligned tabular numbers, `.table-hover` for
  clickable rows, `.table-compact` for dense reporting. `.responsive-table` and
  `.data-table` collapse to labelled rows on phones: set `data-label` on each `td`, use a
  `th scope="row"` to title the row, and `.cell-action` for a cell that only holds
  buttons. Phones never scroll a table sideways. Put `.row-link` on a row's primary
  link to make the whole row the click target. Wrap wide tables in
  `TableScrollRegion` (named after the caption, or a nearby heading when no caption exists), never a bare scrolling `div`: while the
  table overflows it becomes a focusable, labelled region so keyboard users can scroll it.
- **Status:** `StatusBadge` tones are semantic, never the only carrier of meaning; the
  text always states the status.
- **Notices:** `Notice` for inline, region-level messages. Dismissal is presentation only.
- **Needs attention:** `NeedsAttention` is the action-first home pattern. It orders by
  priority, caps the list (`limit`), provides a text equivalent for priority, and never
  dominates the page. The server decides what needs attention; dismissal only hides.
  Give an item `href` and the whole item opens its work.
- **KPIs:** `MetricCard` is a label, a value and one line of context. KPIs never carry
  icons. Pass `href` when the number has a detail view (a page or an in-page section).
  Values size to the card so amounts stay on one line. In a `.metric-grid` KPIs become
  one list on phones; add `.metric-list` for that list at every width.
- **Clickable things:** anything clickable shows the pointer cursor and a hover state;
  unavailable controls show not-allowed. `base.css` applies the cursor to links, buttons,
  selects, checkboxes, radios and ARIA widgets, so new controls need nothing extra. Make
  the whole card, row or item the target (`MetricCard href`, `.row-link`, attention
  `href`) rather than a small button inside it.
- **Missing context:** `ContextRequiredState` when a page needs a tenant, legal entity or
  station before it can load. It is a normal starting point, not an error.
- **Dialogs:** `Modal` (controlled) or `DialogFrame` (trigger-owned). Centred on tablet
  and desktop, bottom-anchored on phones. Actions go in `footer`, primary last.
- **Confirmation:** `ConfirmDialog` only for financial, destructive, irreversible, or
  high-risk commands, never ordinary low-risk actions. State the consequence, show
  the context to verify (`details`), use a verb + object confirm label, and optionally
  require an `acknowledgement`. Warning/danger confirmations open focused on Cancel.
  The caller runs the server command and owns `pending`/`error`.
- **Work in progress:** keep unfinished areas visible. Wrap their triggers in
  `WorkInProgressTrigger` (or open `WorkInProgressDialog`); use `WorkInProgressPanel`
  for an unfinished region and `WipBadge` to mark navigation. Never use disabled dead
  buttons, hidden sections, or error states for unfinished features.
- **Loading / empty / error:** `Skeleton`/`SkeletonBlock` mirror the incoming layout;
  `LoadingState` for short waits. `EmptyState` and `ErrorState` take
  `layout="inline"` (within a region) or `layout="block"` (whole region/page). Errors say
  what happened, whether anything changed, and offer the next step.
- **Charts:** no chart library yet. When one is introduced: one question per chart,
  `--chart-1…5` in order (max five series), hairline `--chart-grid`, no borders, 3D, or
  gradients, direct labels where possible, `.chart`/`.chart-legend` frame, and always a
  table or text equivalent. Prefer a number or table when it is clearer.
- **Page composition:** `PageHeader` answers where am I / what can I do next;
  `PageContainer` sets width; `Section` groups with a quiet heading. In a
  `.content-grid`, `.content-span` gives a wide item (usually a table) the whole row.
- **Phone width:** nothing scrolls sideways. The shell clips the content column as a
  guard, but screens must adapt (stacked tables, KPI lists, wrapping labels);
  `tests/e2e/ui-polish.spec.ts` checks every screen at 320 and 390px.

## Contract assumptions

- Navigation permissions are an input projection from the authorization layer, not a
  browser-side grant.
- UI actions are presentation-only until a feature workstream connects them to a named
  server command.
- Money, litres, prices, balances, and posted state must be displayed from authoritative
  server responses and must not be calculated in these components.
- Offline language describes drafts only; it must never imply submitted, approved,
  posted, or locked state.
- `Modal`, `DialogFrame`, and `BottomSheet` move focus into the surface, contain Tab
  focus, close on Escape (unless not dismissible while pending), make the background
  inert, and restore focus to the trigger.
- Required `Field` and `NumericInput` controls apply native `required` plus
  `aria-required`; optional controls do not receive either required state.
