# Shanda Fuel UI/UX constitution (Phase 0.5)

Status: authoritative for Phase 0.5 UI/UX hardening. Baseline: `402e988` (Phase 0 complete, PR #99).
Scope: presentation, navigation, copy, loading behaviour. Not in scope: business rules, RBAC, RLS, audit,
MFA/step-up, API semantics, migrations, Phase 1 work. Where a UX fix needs a backend change, record it in
`docs/decisions/` and keep it minimal and covered by a regression test.

Shanda Fuel feels like premium industrial operations, financial-software precision and quiet luxury. It is
one product for attendants, managers, finance users, administrators and owners. Roles change priorities and
permissions, never the visual system.

Decision order when a choice is unspecified: **clarity > consistency > speed > restraint > decoration.**

## 1. Principles

1. **Clarity.** A user always knows where they are, what is happening, what needs attention, and what to do next.
2. **Consistency.** One spacing logic, type scale, control set, state model, dialog, table, status language.
   No one-off UI. Page CSS never redefines a shared component.
3. **Speed is UX.** No screen takes seconds to become understandable. Remove request waterfalls, parallelise
   independent reads, reuse authenticated work context. Never trade data correctness for speed.
4. **Restraint.** Every element earns its place. Avoid extra cards and borders, glass effects, large radii,
   decorative gradients, rainbow badges, decorative icons, KPI icons, charts without operational value, repeated branding.
5. **Operational language.** Write for station users (section 9).
6. **Data entry excellence.** Ask only for what the system cannot know or derive (section 8).

## 2. Terminology (user-facing)

| Internal name        | User-facing                                           |
| -------------------- | ----------------------------------------------------- |
| Dashboard            | **Today**                                             |
| Daily operations     | **Shift**                                             |
| Inventory            | **Stock**                                             |

Routes, modules and component names may keep internal names. The user-facing word is identical in navigation,
page titles, breadcrumbs, search results, buttons, dialogs and empty states. Other destinations keep their
names: Reconciliations, Cash, Settlements, Customers, Suppliers, Reports, Settings.

## 3. Navigation

- **Desktop (≥ 64rem):** persistent sidebar with full navigation, collapsible to an icon rail. One implementation
  of the layout (a single grid), one collapse attribute read by both CSS and JS. Between 48rem and 64rem the
  sidebar is a drawer, never a squeezed column.
- **Mobile (< 64rem):** compact header plus a **bottom bar hard-limited to four items: Today, Shift, Stock, More.**
  A fifth permanent item is never added.
- **More** is a full-screen hub (a route-like sheet that fills the viewport), listing lower-frequency destinations
  the user is permitted to see: Reports, Customers, Suppliers, Finance (Cash, Settlements, Reconciliations),
  Settings, Account, Appearance, Sign out. It is not a cramped bottom sheet.
- A miniature desktop sidebar never appears on mobile.
- Visibility comes from the existing authorization projection; the server stays authoritative.
- Search (command palette) is preserved. Only labels and styling change to follow this constitution.

## 4. Work context

- Context is Tenant → Legal entity → Station. It is part of the application shell, not a per-page control.
- A valid selection persists across navigation (carried in the URL contract already used for work context, with
  a per-device remembered last valid selection as fallback). Navigating never silently drops the station.
- One valid station: auto-select, show it as plain text, no picker.
- Several choices: an intentional context control (name on line one, `Entity · Tenant` beneath, a chevron),
  opening a menu/sheet. Never a text-field-looking select.
- The context list is fetched once per session and shared (no per-page refetch, no sequential station fetches).
- The global header does not carry date or shift. Business date and shift belong to the Shift workflow.
- While context is loading, show a content-shaped skeleton. Never "Choose organisation" or "0 records".

## 5. Visual system

All colour comes from semantic tokens. Components never use palette tokens or colour literals. Light and dark
share one layout and component architecture; **only token values differ**. No `[data-theme=dark] .component`
structural overrides.

### 5.1 Colour tokens

`background`, `surface`, `surface-raised`, `text-primary`, `text-secondary`, `border`, `accent`, `success`,
`info`, `warning`, `danger` (existing `--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--tone-*` families map
to these; no parallel set is introduced).

- Light: warm ivory background, white surfaces, graphite text, deep petrol-green accent.
- Dark: graphite / near-black surfaces, restrained elevation, same hierarchy and geometry.
- WCAG AA contrast for text, 3:1 for focus rings, control borders and status icons, in both themes
  (enforced by `src/design-system/tokens.test.ts`).

### 5.2 Typography

Native system UI stack (no web-font download). Tabular numerals for all money, litres, and aligned numeric columns.

| Role                              | Mobile | Desktop |
| --------------------------------- | ------ | ------- |
| Body                              | 16px   | 14–15px |
| Labels, supporting text           | 13px   | 12–13px |
| Section heading                   | 17–18  | 18–20   |
| Page title                        | 24     | 24–30   |
| Primary financial/operational fig | 28–32  | 32–40   |

Minimum text size anywhere is 12px. 11px operational text is removed.

### 5.3 Space, radius, elevation

- Space: 4px scale (existing `--space-*`). Page rhythm via `--page-gutter`, `--page-block`, `--section-gap`.
- Radius: controls 8px, cards/panels 12px, dialogs and sheets 16px. Nothing larger except pills (status, chips).
- Elevation: borders carry structure; shadows only on menus, dialogs, sheets, and the sticky mobile action bar.
- Separation prefers whitespace and hairlines to nested cards. No card inside a card.

### 5.4 Breakpoints (mobile-first, min-width)

`sm 40rem · md 48rem · lg 64rem · xl 80rem`. Verified widths: 360, 390, 430, 768 (tablet), 1440.

### 5.5 Motion

120–180ms for state transitions, 180–260ms for menus, dialogs, sheets. Pressed state is immediate (no delay).
No bounce, parallax, or page theatrics. `prefers-reduced-motion` removes all transitions and skeleton shimmer.

## 6. Status language

One mapping everywhere (badges, table cells, timeline steps, Today tiles). Colour is never the only signal: every
status has a text label and, where space allows, a distinct glyph.

| Tone    | Means                                                | Examples                           |
| ------- | ---------------------------------------------------- | ---------------------------------- |
| Neutral | not started, inactive, unavailable                   | Not started, Inactive, Closed out  |
| Info    | in progress, informational                           | In progress, Awaiting review       |
| Warning | needs attention, incomplete exception                | Needs attention, Low stock         |
| Success | completed, healthy, reconciled                       | Completed, Reconciled, Healthy     |
| Danger  | failed, blocked, serious problem                     | Failed, Blocked, Variance too high |

"Not started" is never green. Status chips are used for row/record state, not in every table cell; prefer plain
text with a small dot for repeated states.

**Needs attention** is a product-wide pattern: a list of exceptions (what, where, how to resolve) that rises to
the top of Today and appears wherever a workflow has an unresolved exception. Users never hunt for problems.

## 7. Data states

Every data surface supports: **loading, populated, genuinely empty, error, stale/refreshing.**

- Loading uses content-shaped skeletons. No full-screen spinners. Loading never shows counts, zeros, or empty copy.
- Empty states say what is absent and the next action. They are only shown after a successful load.
- Errors say what happened in plain words and offer retry; entered form data survives transient failures.
- Stale/refreshing keeps existing data visible and shows a quiet "Updating…" affordance.

## 8. Data entry rules

- Do not ask for known data: tenant, entity, station, user, product (where known), currency, shift and date
  (when context makes them safe). Show them as read-only context lines instead.
- Mobile: correct `inputMode` (`decimal` for money and litres, `numeric` for integers), `autocomplete` and
  `enterkeyhint`, 16px minimum input text (no iOS zoom), 44px minimum targets, large numeric inputs, primary
  action reachable by thumb (sticky bottom action bar with safe-area padding).
- Desktop: logical Tab order, Enter advances in numeric entry runs and submits on the last field, visible focus.
- Format as the user types (thousands separators, fixed decimals on blur) while preserving exact decimal strings;
  never use binary floating point for authoritative values.
- Validate inline, next to the field, on blur and on submit; errors state the fix ("Enter a closing reading above 12,340.5").
- Preserve unsaved values through transient network failure (in-memory, per-form; sensitive values never to storage).
- Significant actions (close shift, approve, post, financial adjustment) have a **review step** that summarises
  what will happen, then a single primary confirm. Routine actions do not use confirmation dialogs.
- One form system: label above field, optional help text, error text, required marker, unit suffix, read-only and
  disabled treatments identical everywhere.

## 9. Language

Plain operational language. Replace developer or domain-internal phrasing, e.g. "server-backed", "canonical
evidence", "persisted cost projections", "authoritative browser date", "Phase 0 surface". Keep precise meaning:
what is shown, what can be done, what is blocked and why. Sentences are short. Buttons are verbs ("Close shift",
"Save readings"). Sentence case everywhere.

## 10. Page hierarchy

### Today (flagship)

Answers: what is happening, what needs attention, what to do next.
Order: title and date → work context → headline status → primary figures (sales, litres, cash expected/counted,
variance) → current shift and next action → stock condition → **Needs attention** → recent activity.
Few containers, strong hierarchy, no wall of KPI cards, no KPI icons. Role-aware priority (attendant: shift,
next action, readings, cash; manager: station position, shift progress, stock, reconciliations; owner/admin:
multi-station performance, exceptions, cash, stock, trends) using the same layout and components.

### Shift

Guided stages: **Open → Readings → Sales and cash → Review → Close.** Always show current stage, completed
stages, and next action. Unrelated forms are not offered as equals. Close requires a review step.

### Stock

Leads with physical reality: product, current litres, capacity, level, warning/reorder state, deliveries,
variance. Valuation and cost detail sit deeper and only for authorised users. Tank graphics are simple fills.

### Other surfaces

Customers, Suppliers, Finance (Cash, Settlements, Reconciliations), Reports, Settings use the same page
header, section, table, form and state patterns.

## 11. Components

- **Buttons:** primary (one per view region), secondary, quiet, destructive. 40px desktop, 44px minimum coarse
  pointer. Immediate pressed state. Loading buttons keep width and show progress text.
- **Inputs/selects:** 44px on touch, 40px desktop, 16px text on mobile, shared focus ring.
- **Tables:** one table component. Row rhythm, sticky header where it helps, tabular right-aligned numeric
  columns, hover/focus/selection, sort and filter affordances, loading skeleton rows, empty and error rows,
  row actions in a consistent trailing position. On mobile each table picks its clearest representation
  (key/value rows, grouped list, or horizontally contained table only where comparison across columns is the
  point); the page itself never scrolls sideways.
- **Dialogs/sheets:** one frame; focus trap and restore; Escape closes; sheets on mobile, centred dialogs on desktop.
- **Menus:** keyboard operable; arrow keys, Home/End, Escape; consistent item height.
- **Toasts:** small, bottom (mobile above nav) or top-right (desktop), auto-dismiss for success, persistent for errors.
- **Account menu:** name, email, role, current tenant; then Account, Appearance (labelled System/Light/Dark),
  Keyboard shortcuts, Sign out. Sign out is reachable here on every screen.

## 12. Mobile rules

Support 360, 390, 430 px and tablet. 16px body, 44px targets, safe-area insets on header, bottom nav and sticky
action bars, no horizontal page scroll, readable in bright light (AA contrast minimum, no light-grey-on-white
for essential data), numeric entry as in section 8.

## 13. Desktop rules

Information-rich but calm: aligned columns, controlled whitespace, restrained separators, comfortable density.
Not a scaled-up phone layout. Content widths from `--content-narrow/default/wide`.

## 14. Accessibility (acceptance criteria)

WCAG 2.2 AA contrast; visible focus on every interactive element; full keyboard operation; semantic landmarks
and labels; screen-reader-understandable actions and live regions for async results; reduced motion; 44px mobile
targets; no meaning by colour alone. The Playwright accessibility suite (`test:a11y`) must pass.

## 15. Known defects this phase removes

Sidebar layout break at 768–1200px; collapse-state selector mismatch; context lost across pages; sequential
context loads and request waterfalls; false empty states while loading; light/dark structural differences;
overlapping sidebar CSS; developer wording; wrong status colours; clumsy station picker; inconsistent
Today/Dashboard and Daily operations naming; thin account menu; Settings alignment/overflow; undersized text;
weak interaction feedback.

Rule: replace broken layout logic with one implementation and delete the superseded rules. Do not add another
override layer.

## 16. Verification matrix

Every major screen is checked in light and dark at 360, 390, 430, 768 and 1440 widths, with keyboard-only
desktop use and mobile numeric entry. Gates: typecheck, lint, format, build, unit, relevant PostgreSQL
integration, E2E, security review.
