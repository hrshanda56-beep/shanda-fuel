# Shanda Fuel UI foundation

This directory owns the presentation foundation for Shanda Fuel. It is intentionally
domain-neutral: the examples in `/` use synthetic context and do not represent tenant,
station, financial, or product master data.

## AppShell

`AppShell` receives a server-authorized, serializable `NavigationProjection[]`.
It renders stable UI navigation keys and enabled/visible state, but it does not
interpret permission identifiers or authorize commands. A1/platform authorization
maps canonical permissions to this presentation projection. Server-side
authentication, tenant context, permission evaluation, and authoritative command
confirmation remain required for every product workflow.

The shell provides:

- desktop sidebar navigation and a mobile bottom navigation bar;
- visible organisation, station, business-date, role, and user context slots;
- a compact mobile operating-context region with an optional shift slot;
- a skip link and semantic landmarks;
- a stable place for truthful weak-connection/offline messaging.

## Shared patterns

Use the primitives in `primitives.tsx` for buttons, status badges, cards, fields,
numeric inputs, loading/skeleton, empty, error, access-denied, not-found,
conflict, offline, risk-confirmation, and evidence states. Keep persistent labels
and supporting help text on fields. Use `data-label` on table cells when a table
must collapse into a mobile card pattern; the shared CSS turns those rows into
labelled cards on phone widths.

Use `formatters.ts` for presentation-only money, litre, ratio, percentage, date,
business-date, and status labels. These helpers preserve decimal text and never
become a source of financial truth.

The status tones are semantic, not the sole carrier of meaning: each important
state also includes readable text. Focus styles and reduced-motion behavior are
part of the global token layer in `src/app/globals.css`.

## Contract assumptions

- Navigation permissions are an input projection from the authorization layer, not a
  browser-side grant.
- UI actions are presentation-only until a feature workstream connects them to a
  named server command.
- Money, litres, prices, balances, and posted state must be displayed from
  authoritative server responses and must not be calculated in these components.
- Offline language describes drafts only; it must never imply submitted, approved,
  posted, or locked state.
- Theme tokens support light, explicit dark (`data-theme="dark"`), explicit light,
  and system preference. Prefer semantic tokens over new raw color literals.
- `DialogFrame` and `BottomSheet` are accessible modal primitives: they move focus
  into the surface, contain Tab focus, close on Escape, make the background inert,
  and restore focus to the trigger.
- Required `Field` and `NumericInput` controls apply native `required` plus
  `aria-required`; optional controls do not receive either required state.
