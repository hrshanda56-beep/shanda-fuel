# ADR-020 — Emailing alert digests (PROPOSED, needs security review)

Status: PROPOSED. Not implemented beyond the pure parts. **Do not apply until reviewed.**
Source requirement: DEC-044 (alerts by email only; no SMS or push in v1).

## Context

The alert rules already run inside the app (Action Center). Emailing them means a scheduled job
has to act for many people across many organisations with nobody signed in. The database is built
so that this is hard on purpose: every table is row-level-secured by `app.current_tenant_id()`
plus an active-membership check that must match the actor, the membership and the identity
together (`app.has_active_membership()`), and there is no cross-organisation read for the
application role. Two things a job needs are therefore not available today:

1. A list of who to email (organisation, station, membership, address) across organisations.
2. A way to read each person's alerts with that person's own permissions.

## What is already built (safe, no database change)

- `src/modules/alerts/digest.ts` — builds the email (plain text and HTML, escaped, links to the
  signed-in address) and decides whether to send: only items that need action, and only when one
  is new since the last email for that person and station.
- `src/modules/alerts/run-digests.ts` — the run itself, with the database, the person's access and
  the email provider passed in. One person's failure never stops the others. Fully unit-tested.
- `src/platform/email` — the existing Resend sender.

## Proposal (the part that needs review)

1. **Recipient list through one narrow SECURITY DEFINER function**, owned by the migration
   owner, with a fixed `search_path`, returning only `(tenant_id, station_id, station_name,
   membership_id, identity_id, email, display_name)` for **active** memberships that hold
   organisation-level or station-level access to a station and have opted in. No other
   cross-organisation read. Execute is granted to the job role only.
2. **Read each person's alerts as that person.** For each listed row the job opens a tenant
   transaction for exactly that tenant, membership and identity (the same trusted-context builder
   the web requests use) and loads the alerts with the existing permission-filtered loaders.
   Nobody is emailed anything they could not see in the app. The job never runs a broader query.
3. **Remember what was sent** in a new tenant-secured table `alert_deliveries`
   (tenant, membership, station, alert ids, message id, sent at), written inside that same
   per-person transaction. This is what stops repeat emails.
4. **Opt-in and unsubscribe.** A per-membership switch (default off until the owner turns it on)
   shown under Settings > Reminders; every email says how to turn it off.
5. **Trigger.** A Vercel cron calling a route protected by a long random `CRON_SECRET` header
   (compared in constant time), idempotent per day, with a hard cap on recipients per run.
6. **Failure handling.** Provider or database failures are logged without addresses or alert
   text; a failure for one person never blocks the rest; a failed record after a sent email is
   logged, and the next run may repeat that one email.

## Why this shape

- It keeps the blast radius small: one function that lists recipients, and per-person reads that
  use the normal row-level security. There is no "read everything" path to misuse.
- It reuses the existing alert rules, so the email and the app can never disagree.

## Risks to weigh

- **Impersonation capability.** The job mints a database context for a membership it did not
  authenticate. That is acceptable only because the context is built from the database's own
  list, for active memberships, inside a role that has no other access. This is the part to review.
- **Email content.** Alert text can include amounts and station names. Email is not a secure
  channel; the proposal sends titles and links, never account numbers or customer names.
- **Provider.** Resend is already in use; its production sending domain and daily limits need
  confirming before go-live.
- **`job_runtime`.** Current status says this role is quarantined and unbound. Either it is
  restored with permanent hardening for this job, or the job runs as `app_runtime` with the
  SECURITY DEFINER function granted to it. This choice belongs to whoever owns the provider-level
  hardening work.

## Decisions needed from the owner

1. Approve (or change) the shape above, including who may receive digests (owner, administrator,
   finance, supervisor for their own stations).
2. Choose the schedule (suggestion: once each morning at 07:00 station time, not per station
   timezone — one run for all, using each station's own date for the alert rules).
3. Confirm the sending address/domain.
