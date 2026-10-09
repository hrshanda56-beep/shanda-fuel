# ADR-015: Owner-approved visual redesign of the design system and Product Shell

- Status: Superseded
- Date: 2026-09-29
- Owner: Product owner (sign-off 2026-09-29); implementation by Track B

> **Historical record:** This decision is retained for traceability but is no
> longer the current product or visual direction. The glass / blurred-surface
> treatment, DM Sans requirement, and KPI-first Owner/Finance Overview were
> superseded by the neutral, action-first, operationally focused Product Shell
> and Today workflow on the current `main` branch.

## Context

`docs/release-readiness.md` locks the brand, navigation, and Overview direction.
The product owner reviewed a new visual direction in a design canvas
(<https://claude.ai/artifact/BL4epBMVHsruU5kB5mwj2v>), modelled on a reference
dashboard (grouped Cloudflare-style sidebar, large page title, KPI cards,
a chart row, and a "Needs attention" table). On 2026-09-29 the owner signed it
off, including decisions that change locked text. This ADR records those changes
so the locked section and the implementation do not silently diverge.

## Decision

The following changes apply. Everything in `release-readiness.md` that is not
listed here stays locked.

1. **Visual language.**
   - Dark theme: a mid-tone slate canvas with translucent ("glass") cards on desktop.
   - Light theme: a pale grey-green canvas with white translucent cards.
   - Mobile uses solid surfaces with no backdrop blur, for performance and legibility.
   - The Shanda Fuel green `#0d6b58` stays the only brand accent. The dark theme uses a
     lighter tint of the same green for contrast.
2. **Typography.**
   - DM Sans replaces Inter, with tabular figures for numbers.
   - Page titles are large (about 44px on desktop).
   - Section headings are plain sentence case, with no uppercase eyebrow labels.
3. **Shell.**
   - The grouped, collapsible sidebar contains:
     - the tenant logo in an organisation switcher;
     - "My open tasks" at the top;
     - groups for Operations, Finance, Partners, Insights, and Settings;
     - a collapse toggle.
   - The sidebar has **no search box**.
   - The header holds:
     - a context line (station · business date · CAT);
     - one global search (⌘K);
     - a floating account pill with theme, help, and notifications.
   - Filters belong to each list's own toolbar.
4. **Home by role.**
   - Owner and Finance land on a **KPI-first** Overview: KPIs for today, then charts
     for a chosen period, then "Needs attention".
   - Operations roles stay action-first.
   - This amends "Overview must be action-first, not KPI-first" for those two roles only.
5. **Honest figures.**
   - Gross margin shows the label "Provisional" until the period is locked.
   - V1 displays USD only.
6. **Tables and priority.**
   - Show priority and status as coloured text, not badges. The text always states
     the meaning.
   - Row actions are text links.
   - Rows are taller on the Overview. Dense tables (`.table-compact`) are unchanged for
     reconciliation and reporting.
7. **List template.** The standard list layout has four parts:
   - a selected-record summary;
   - a toolbar with a filter input and filter pills;
   - the table;
   - a summary card beside it.
8. **Contrast.** WCAG 2.2 AA stays mandatory and `tokens.test.ts` enforces it.
   Where the reference fails AA, for example with grey or red text on slate, the
   tokens are lightened rather than copied.

## Alternatives considered

- **Keep the existing neutral foundation.** The owner rejected it as not matching
  the desired look.
- **First canvas iteration (near-black with neon accents).** The owner rejected it as
  "too vibe coded".
- **A sidebar search in addition to ⌘K.** Rejected as duplicate search.

## Consequences

- Tokens change colour values. Token names do not change, so module CSS keeps
  working through the semantic tokens and legacy aliases.
- Backdrop blur costs GPU time. It is limited to desktop and disabled under
  `prefers-reduced-transparency`.
- The old foundation showcase moves from `/` to `/foundation` until the golden-path
  screens replace it. `/` becomes the Overview.
- The Overview renders **synthetic, clearly labelled sample data** until the
  reporting projection for it exists. It must not be mistaken for client data.

## Affected modules

- `src/design-system`: tokens, base, components, shell, navigation.
- `src/app`: root layout, `/`, and `/foundation`.
- The E2E smoke and accessibility suites.

Domain modules are not affected.

## Specification impact

This is an explicit, owner-approved deviation from the locked
"Brand and visual direction", "Navigation" and "Overview and home experience"
sections of `docs/release-readiness.md`. Those sections are amended to point to
this ADR.

## Migration/backward compatibility

- Pages still using the older layout helpers keep rendering through the unchanged
  token names.
- Screens migrate to the new patterns in golden-path order.
- Rollback means reverting the token and shell commits. No data or schema is
  involved.
