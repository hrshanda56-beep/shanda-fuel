# Shanda Fuel UI foundation

This directory owns the presentation foundation for Shanda Fuel. It is intentionally
domain-neutral: the examples in `/` use synthetic context and do not represent tenant,
station, financial, or product master data.

## AppShell

`AppShell` receives a server-authorized permission projection as a serializable array.
It filters navigation affordances for the current view, but it does not authorize
commands. Server-side authentication, tenant context, permission evaluation, and
authoritative command confirmation remain required for every product workflow.

The shell provides:

- desktop sidebar navigation and a mobile bottom navigation bar;
- visible organisation, station, business-date, role, and user context slots;
- a skip link and semantic landmarks;
- a stable place for truthful weak-connection/offline messaging.

## Shared patterns

Use the primitives in `primitives.tsx` for buttons, status badges, cards, fields,
loading, empty, error, conflict, and offline states. Keep persistent labels and
supporting help text on fields. Use `data-label` on table cells when a table must
collapse into a mobile card pattern.

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
