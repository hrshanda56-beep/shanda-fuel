# Progress log (Audit #2)

Newest at the bottom. The row-by-row account is `docs/AUDIT2.md`; what to do next is in `docs/HANDOVER.md`.

## 2026-10-29

- Created `docs/AUDIT2.md`. A2: the pure rule `missing-report-days.ts` and the query behind it.
- Checkpoint: full integration suite green after A4/A5.

## 2026-10-30

- **Section A:** A1 (the station named in the address is now saved; one legal entity is inferred), A2 (wired to the dashboard, gap days outside the period found), A3 (one profit calculation; the audit's 33.34 gap was exactly the staff fuel), A4 (own Tank dips step, last-shift guard, dashboard "measured" rule), A5 (lock guard and button reason), A6 (migration 0092), A7 (key check, plain message, docs).
- **Section B:** B1 (one period control, "As at" labels), B3 (go-live refuses unvalued stock), B4 (cash custody, five places that add up), B5 (migration 0093, bank date and difference reason), B6 (one fixed-cost rule, manual month step removed), B7 (with A3), B8 (standard categories at first go-live), B9 (cents on screen, in inputs and in Excel).
- **Section C:** C1 (partly: review wording and controls), C2, C3 (opening the first shift opens the day), C4 and G5 (copy check), C6 (status, charges, net, difference), C8.
- **Section D:** D2 (three new roles, migration 0094, docs/ROLES.md), D9.
- **Guardrails:** G3 invariants (`modules/invariants`, `zz-invariants`), G5 copy check, cross-screen profit test (part of G1), role parity and enforcement tests, the 76-case cross-company route sweep (F4), which also fixed a bare 500 on the two upload routes.
- **Measured:** F6 page speed is about 0.5 s warm on the TEI data; confirm on a preview deployment (see the audit row).
- **Not built:** E (TEI Oils seed and `reset-demo`), and so the full G1, G2, G4; D1, D3, D4, D6, D7, B2, C5, C7, C9, F2.
- Gates at the end: lint, format, typecheck and `db:check` clean; unit suite green except the UI-lock test, which fails by design until the manifest is rebaselined with owner sign-off; integration suite on a fresh database see HANDOVER.
- Nothing committed. The tree still holds earlier uncommitted work and local-only dev sign-in files that must not be committed.

- **Section E built:** `scripts/dev-demo-seed/tei-oils.seed.ts` and `scripts/demo/reset-demo.sh`. Ran clean from an empty database: 60 reconciliations over 30 days, 52 locked days, 58 cash collections, 18 deposits; second seed run changes nothing; invariants pass. Not yet done on top of it: G1 full suite, G2 crawl, G4 golden path, screenshots, TEI version of the demo script.
