# Fixes

## 2026-10-26

- Add explicit server-side Playwright role-boundary coverage for Attendant,
  Supervisor, and Finance denial cases.
- Add an opt-in, transport-free ShandaHR adapter boundary consistent with
  DEC-044; it is disabled by default and contains no credentials.
- Add a disposable zero-to-setup Playwright contract harness that skips only
  when its PostgreSQL or Clerk development fixtures are unavailable.
- Make the backup runbook operationally actionable with a nightly systemd
  example and add the root `RESTORE.md` compatibility entry point. No
  scheduler, restore, staging operation, or production operation was run.
- Complete the local alert email delivery boundary with role/station-scoped
  recipients, opt-in defaults, durable claim/sent records, Resend fail-closed
  behavior, a CRON_SECRET-protected route, and focused tests. Migration 0069
  remains unapplied; no staging or production operation was run.
- Add the go-live opening-balance CSV preview, validation, approval, posting and
  lock workflow for supplier, customer, cash, bank and tank-opening facts.
  Migration 0068 remains unapplied.
- Add private supplier-payment proof documents with tenant/legal-entity checks,
  type and 10 MB limits, short-lived downloads and append-only audit behavior.
  Migration 0066 remains unapplied.
- Enforce non-empty attendant declarations, shift-bound reconciliation evidence,
  authoritative meter attribution and exact declared-litres shared-shift sales
  reporting.
- Add company- and station-scoped recurring costs with idempotent daily
  recognition through the existing cron boundary. Migration 0067 remains
  unapplied.
- Add approved transporter/other-liability entries and bank-opening-balance
  reporting to financial position, plus consolidated all-stations reconciliation
  totals. Migration 0070 remains unapplied.
