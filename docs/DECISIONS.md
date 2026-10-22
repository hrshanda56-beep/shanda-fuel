# Shanda Fuel — Decision Log

## DEC-045 — Implementation choices made while building the v1 scope (for review)

Date: 2026-10-21. Made by the implementing agent inside DEC-044, without a separate human
answer. **Status:** PROPOSED. Each is small, reversible, and easy to change; confirm or correct.

- **Cash handover rules.** The person receiving cash must be a different person from the one who
  handed it over (nobody accepts their own handover). A count that differs from the expected
  amount needs a written reason and goes to review; only a person who can resolve handovers
  (administrator or owner) settles it, with a note. Accepting or settling moves the *counted*
  amount between the two cash locations. Anyone who can accept a handover may also withdraw one
  that is still open; otherwise only the sender may.
- **Tank charts.** A dipstick chart is versioned and insert-only. A new chart applies to new dips;
  old dips keep the litres they were recorded with. A reading outside the chart is refused, never
  extrapolated. Litres between two chart rows are worked out in a straight line.
- **Landed cost.** Fuel cost plus freight plus other direct costs, divided by the litres that
  actually arrived (not the delivery-note litres). Each tank receives its share of the litres.
- **Supplier credit limit.** A supplier may have a limit. 80% or more used is "near", above it is
  "over". It warns (supplier page and Action Center); it never blocks a purchase.
- **Reminder thresholds.** Stored per organisation, changeable by the owner or an administrator
  (Settings > Reminders). Starting values until the client chooses: invoices due soon 7 days,
  card/mobile payments late after 3 days, daily report late after 1 day, ignore cash shortages
  under 0.01. Supplier ageing buckets are 1-7, 8-14, 15-30 and over 30 days.
- **Stock signal.** A tank dip within its acceptable difference is green ("matches books"), up to
  twice that is yellow, beyond is red; a tank without a dip or a tolerance shows "not checked",
  never green.
- **Offline queue.** Only a daily-report save that fails for lack of connection is queued, per
  person, on the device (7 days). It is replayed with the same idempotency keys; if the record has
  changed meanwhile it is shown as a conflict and never overwrites anything. Cash counts and
  handovers are not queued until the client says they need it.
- **Activity log.** Readable only with the audit permission held at organisation level.
  Secret-looking fields are never displayed.
- **Documents.** Files (photo, PDF, DOCX; 10 MB) attach to a delivery, bank deposit, cash
  handover, daily report or expense at one station; stored privately under a random key; append
  only. Uploading needs the document-upload permission (supervisor, finance, administrator,
  owner); attendants cannot upload.
- **Offline drafts, stage 1.** Unsent entries on the daily operations screen are copied to the
  device (24 hours, tied to the saved record version, cleared after a successful save) and offered
  back, never applied silently. They are per station and shift, not per person, so on a shared
  device the next person could be offered them.

## DEC-044 — Deliver the client's full v1 on the Clerk-only integration branch

Date: 2026-10-21. Explicit human instruction. **Status:** ACCEPTED.

- **Scope.** The finish line is the client's full v1 list, not Phase 0 alone. This
  promotes the items listed in PRODUCT_SPEC §16.2 (cash custody and banking
  workflow, approved-fuel accounting, alerts, offline drafts, editable settings,
  richer exports and reports) into scope. **Deferred:** the ShandaHR link.
- **Branch.** All work lands on `codex/clerk-only-auth-20261017` (Clerk is the
  only authentication provider, DEC-043). Other branches are mined for finished
  work only. Nothing merges to `main` or deploys without a separate instruction.
- **Offline drafts.** In scope, staged: (1) local autosave and restore of unsent
  form input; (2) queued entry and sync with conflict handling, scoped after
  stage 1 is proven.
- **Alerts.** Email only for now (Resend). In-app feed and dashboard tiles are
  also in scope; SMS/WhatsApp/push are not.
- **Supervisor.** The person responsible for a station. A station has a
  responsible-supervisor assignment used for sign-off and cash handover. This
  extends, and does not replace, the approver meaning in PRODUCT_SPEC §8.1.
- **Account sale reference.** The customer. An account sale must carry a
  customer account and is checked against that account's limit at entry.
- **Approved fuel.** Accounted exactly like fuel sold: litres leave stock, cost
  of fuel sold is recognised, a named beneficiary is recorded, and it is
  included in expected-versus-accounted totals and in profit reporting as a
  benefit cost.
- **Cash handover.** No minimum amounts. The attendant surrenders cash to the
  supervisor; an administrator or owner collects it from the supervisor. Every
  hand-off records who held the cash, and the held, in-transit and banked states
  are visible. A bank deposit still requires a bank/deposit reference
  (PRODUCT_SPEC §8.4).
- **Setup screens.** Designed for non-technical users: guided, plain language,
  one task per screen, no identifiers shown, phone-friendly.

Still open: default tank-variance tolerances and reminder windows (the client
brief suggests 7, 14 and 30 days). Until decided they are configurable settings
with no hard-coded production default beyond the brief.

## Activation security clarification — 2026-10-18

Explicit human instruction: after five incorrect activation codes the code is
permanently invalid, not temporarily locked. A manager must generate a new code.
The database persists failure counts, serializes concurrent attempts and burns
the old hash. Replacement resets the budget; time alone does not. Keep one-time
acceptance, 72-hour expiry and independent client throttling.

## DEC-043 — Use Clerk alone; simplify the development authentication cutover

Date: 2026-10-18. Explicit human instruction supersedes historical provider choices.
Clerk owns credentials, recovery, MFA and authentication sessions. Shanda Fuel
owns internal UUIDs, tenant memberships, scoped permissions and audit. Remove
provider switching and Better Auth runtime/dependencies. The target development
authentication data is disposable: drop obsolete credential/session tables and
legacy mappings rather than archive them. Preserve business foreign keys and do
not reset financial/operational data. Remove the hard-coded production Owner CLI;
provide a configurable development seed with preview and explicit apply. Review
the exact migration and test evidence before applying to the confirmed Neon dev
database. This is not production migration or deployment authorization.

This file records meaningful product, architecture, security, and delivery decisions that have already been made. It exists so future agents do not casually reverse established choices without understanding the context.

Status values:

- **ACCEPTED** — current decision.
- **SUPERSEDED** — retained for history; replaced by a later decision.
- **TEMPORARY EXCEPTION** — explicitly accepted short-term constraint, not a permanent architecture choice.
- **PENDING REVIEW** — direction is known but not yet approved as final.

---

## DEC-001 — Use a tenant → legal entity → station organisational model

**Status:** ACCEPTED

**Context:** The product must support a fuel-station business with organisation-level separation and station-specific operations.

**Chosen approach:** Model authorised operational scope around tenant/organisation, legal entity, and station.

**Rationale:** This matches the business hierarchy used by Daily Operations, Customers, and access-control flows and provides a clear basis for tenant/station isolation.

**Alternatives discussed:** No confirmed competing hierarchy was selected.

**Consequences:** APIs, RLS, scope selection, tests, and UI context must preserve these boundaries. Scope IDs must not be guessed.

---

## DEC-002 — Treat PostgreSQL RLS as part of the security boundary

**Status:** ACCEPTED

**Context:** UI filtering alone is insufficient for multi-tenant data protection.

**Chosen approach:** Use PostgreSQL Row-Level Security, including Force RLS where required, alongside application authorisation.

**Rationale:** Tenant isolation remains enforced even when identifiers are manipulated outside normal UI flows.

**Consequences:** RLS/policy changes are security-sensitive. Integration tests must verify positive and cross-tenant negative cases.

---

## DEC-003 — Host the web application on Vercel and production PostgreSQL on Neon

**Status:** ACCEPTED

**Context:** The project established a production deployment platform and database provider.

**Chosen approach:** Vercel for the web application, Neon PostgreSQL for the production database, and Cloudflare R2 for private/recovery object storage.

**Rationale:** This is the deployed architecture already in use and hardened by current release work.

**Consequences:** Provider-specific PostgreSQL role behavior and hosting-plan limits must be treated as real operational constraints.

---

## DEC-004 — Production migrations are explicit release operations

**Status:** ACCEPTED

**Context:** A web deployment does not guarantee that a database migration has run safely or under the correct owner.

**Chosen approach:** Run/verify production migrations as a separate controlled operation rather than assuming automatic execution during Vercel deploy.

**Rationale:** Security-critical migrations require exact ownership, hash, and state evidence.

**Consequences:** Release procedures must separately verify deployment SHA and migration state. Already-applied migrations must not be casually re-run.

---

## DEC-005 — First-user production provisioning uses a dedicated one-time bootstrap path

**Status:** ACCEPTED

**Context:** Production initially has no normal application user, but bootstrap must not require broad permanent privileges.

**Chosen approach:** Migration 0021 provides a dedicated `first_user_provisioner`, security-definer functions, a one-time sentinel, fixed permission behavior, legitimate scope discovery, dry-run, and real provision operation.

**Rationale:** It separates bootstrap authority from normal runtime authority and makes the release evidence explicit.

**Consequences:** The real provision step must remain outside the dry-run scripts and requires explicit human approval.

---

## DEC-006 — First-user dry run is read-only and must prove zero writes

**Status:** ACCEPTED

**Context:** A production dry run should verify scope and permissions without consuming the one-time bootstrap or creating a user.

**Chosen approach:** Run dry-run inside read-only semantics, assert the exact 12 reviewed read-only permissions, verify zero writes, and verify the bootstrap sentinel remains unchanged.

**Rationale:** It makes approval evidence meaningful and prevents accidental provisioning while validating the path.

**Consequences:** Any dry-run code that can provision, mutate the sentinel, or weaken the fixed permission assertion is a release blocker.

---

## DEC-007 — No application role assignment during first-user bootstrap dry run

**Status:** ACCEPTED

**Context:** Bootstrap access needs the smallest possible permission surface.

**Chosen approach:** The reviewed bootstrap expects exactly 12 read-only permission grants and zero application role assignments.

**Rationale:** Least privilege and easier evidence review.

**Consequences:** Future role assignment behavior must not be smuggled into the bootstrap without an explicit product/security decision.

---

## DEC-008 — Accept only the exact Neon/PostgreSQL 18 provider membership shape

**Status:** ACCEPTED

**Context:** PostgreSQL 18/Neon provider behavior produced an unavoidable membership relationship between `first_user_provisioner` and `migration_owner`. Attempts to self-revoke or avoid it were unsafe or operationally unavailable.

**Chosen approach:** Fail closed unless the exact reviewed provider membership/options are present. Do not attempt to remove the provider-managed relationship in production.

**Rationale:** The exact relationship was reproduced locally and preflighted; workarounds would require unsupported/provider-admin behavior or new risk.

**Alternatives discussed:** Self-revoke, provider-admin revoke, delegated helper repair, role recreation, elevated-provider shortcuts.

**Consequences:** Drift from the reviewed membership shape is a hard stop. The relationship itself is not treated as an error.

---

## DEC-009 — Use an ephemeral provisioner password rather than a persistent credential

**Status:** ACCEPTED

**Context:** The SQL-created provisioner role is LOGIN-capable but has no usable password by default, and Neon did not provide a managed credential for it.

**Chosen approach:** `migration_owner` temporarily assigns a generated password, the operator connects directly as `first_user_provisioner`, then cleanup restores `PASSWORD NULL`.

**Rationale:** It enables the required direct session without creating a persistent bootstrap credential.

**Consequences:** Cleanup is mandatory on normal completion and every abnormal exit. Post-cleanup authentication failure must be verified.

---

## DEC-010 — Keep production secrets out of argv, files, chat, and logs

**Status:** ACCEPTED

**Context:** Database URLs/passwords are sensitive and process argument lists or persistent files can expose them.

**Chosen approach:** Human operator loads secrets through hidden terminal input; scripts use process-local environment variables; no `.env`, pgpass/service file, secret echo, or credential literal is created.

**Rationale:** Minimizes secret exposure while still allowing controlled human-run production operations.

**Consequences:** Convenience mechanisms that put credentials in command arguments or generated files are not acceptable substitutes.

---

## DEC-011 — Parse production database URIs into process-local libpq variables for psql 16

**Status:** ACCEPTED

**Context:** Homebrew `psql` 16 did not interpret a URI placed in `PGDATABASE`; it fell back to the local socket.

**Chosen approach:** Parse the URL with a standard URL parser and populate approved process-local libpq environment variables, with strict fail-closed query validation.

**Rationale:** Preserves secret-handling constraints while making the procedure compatible with the actual operator client.

**Consequences:** Duplicate/unsupported query parameters, conflicting `ssl`/`sslmode`, and malformed ports must fail closed. URL/password must remain out of argv/files/logs.

---

## DEC-012 — Split security evidence across principals instead of broadening diagnostics access

**Status:** ACCEPTED

**Context:** `diagnostics_readonly` intentionally cannot read auth secrets or bootstrap sentinel internals.

**Chosen approach:** Use `migration_owner` for catalog/ownership/ACL/sentinel evidence, `first_user_provisioner` for legitimate scope/identity/permission/dry-run behavior, normal runtime principals for negative checks, and diagnostics only as supplemental evidence.

**Rationale:** Evidence collection should not weaken protection of password hashes, sessions, verification data, or bootstrap internals.

**Consequences:** Do not grant diagnostics new auth/sentinel privileges simply to make an audit script easier.

---

## DEC-013 — Do not use cloud_admin, neon_superuser, role recreation, or persistent API credentials as bootstrap shortcuts

**Status:** ACCEPTED

**Context:** Several recovery/bypass ideas would require provider-managed or broad privileges.

**Chosen approach:** Use the reviewed customer-controlled role path only.

**Rationale:** Keeps bootstrap within least-privilege customer-managed boundaries and avoids dependence on non-connectable/provider-managed roles.

**Consequences:** If preflight fails, stop and fix/review the designed path rather than escalating around it.

---

## DEC-040 — Keep ephemeral provisioner password assignment at the existing deployment-admin boundary

**Status:** PROPOSED — HUMAN AUTHORITY REVIEW REQUIRED

**Context:** The accepted DEC-009 procedure assigns a temporary password to
`first_user_provisioner` through `migration_owner`. The repository bootstrap
and migration contract intentionally keep `migration_owner` as
`NOCREATEROLE`; PostgreSQL 18.6 therefore rejects that `ALTER ROLE` operation
even when the reviewed `ADMIN` membership relationship exists. This is a
credential-assignment authority defect, not permission to weaken the role
contract.

**Recommended approach:** Keep `migration_owner` `NOCREATEROLE` and use the
already documented Neon/provider-owner or deployment-admin boundary from the
deployment runbook for the single human-controlled temporary password
assignment and the matching `PASSWORD NULL` cleanup. Keep all Stage 1
catalog/security checks and all first-user operations on their existing
reviewed principals. The privileged connection is not stored, passed in
argv, committed, or made a durable application/runtime credential.

**Why this is the least-risk available option:** It reuses the existing
bootstrap authority that is already documented for role credential and
ownership operations, changes no production role attributes, adds no
`SECURITY DEFINER` surface, and leaves the temporary credential reversible by
clearing it immediately after the human-controlled operation. The external
Stage 1 helper must be separately reviewed before it can invoke this boundary;
the current helper still attempts the assignment as `migration_owner` and is
not ready for another production run.

**Rejected alternatives:** Granting `CREATEROLE` to `migration_owner` would
weaken its locked least-privilege contract. A provider-managed
`cloud_admin`/`neon_superuser` database session, persistent elevated
credential, or a new SECURITY DEFINER function would create a broader or
durable privileged surface and conflict with DEC-008, DEC-013, and the
security-definer restrictions. A second ad-hoc parser or secret path is
forbidden by DEC-010 and DEC-011.

**Consequence:** M0-T03 remains blocked until the human approves this
authority boundary and the actual Stage 1 operator helper is changed or
replaced by a separately reviewed procedure that uses it without exposing
credentials. No production rerun is authorized by this proposal.

---

## DEC-014 — Owner handoff uses one production URL, not preview links

**Status:** ACCEPTED

**Context:** The owner needs a stable real product location rather than deployment-specific previews.

**Chosen approach:** Handoff uses only `https://fuel.shandahr.com`.

**Rationale:** Avoids confusion over which build is authoritative.

**Consequences:** Preview URLs may be used internally but are not owner handoff links.

---

## DEC-015 — Do not use synthetic production figures

**Status:** ACCEPTED

**Context:** Placeholder dashboard/management numbers can be mistaken for real operational data.

**Chosen approach:** Show real values when supported; otherwise show truthful empty/unavailable/context-required states.

**Rationale:** Owner trust is more important than visual completeness.

**Consequences:** Agents must not fabricate metrics to make a screen look finished.

---

## DEC-016 — Use the shared shell as the canonical page heading/navigation composition

**Status:** ACCEPTED

**Context:** Duplicate local page titles and inconsistent navigation reduced UI clarity.

**Chosen approach:** Shared-shell headings/metadata own the page-level title; feature pages avoid duplicate body headings where the shell already provides one.

**Rationale:** Consistent responsive composition and reduced duplication.

**Consequences:** UI work should follow existing shell patterns rather than invent page-specific navigation/header structures.

---

## DEC-017 — Keep navigation groups closed by default and hidden children inert

**Status:** ACCEPTED

**Context:** Automatically expanded groups and interactive hidden items created clutter and inconsistent behavior.

**Chosen approach:** Dashboard/navigation groups are closed by default; only the relevant operation group opens when appropriate; hidden children are not interactive.

**Rationale:** Clearer hierarchy and predictable responsive navigation.

**Consequences:** Regression tests should preserve these shell behaviors.

---

## DEC-018 — Customers Phase 0 is tenant-authorised and read-oriented

**Status:** ACCEPTED

**Context:** The owner needs customer visibility in Phase 0, but a full customer lifecycle would expand scope materially.

**Chosen approach:** Provide navigation/search, list/detail, balances/status/types, prepaid litres, reservations, and recent ledger/activity using tenant-authorised reads. Do not add new write semantics, migrations, RLS, or auth behavior for Phase 0.

**Rationale:** Delivers owner-visible value without destabilizing the data/security model.

**Consequences:** Full customer lifecycle policies and write workflows remain Phase 1/later work.

---

## DEC-019 — Preserve four-decimal money serialization for NUMERIC(20,4) customer balances

**Status:** ACCEPTED

**Context:** A Customers summary integration test exposed `125.375` versus the established four-decimal monetary contract.

**Chosen approach:** Quantize derived money balances using the existing money policy and return values such as `125.3750`.

**Rationale:** Existing schema/test fixtures define four-decimal monetary precision; dropping scale changes the API contract.

**Consequences:** Tests and APIs should preserve exact decimal strings and avoid lossy number conversion.

---

## DEC-020 — Daily Operations Phase 0 is composition/alignment, not a new accounting engine

**Status:** ACCEPTED

**Context:** The owner workflow includes many paper/Excel concepts, but the release must not invent unreviewed accounting/ledger behavior.

**Chosen approach:** Align existing supported data and UI composition to the owner workflow, validate terminology/order/summary/mobile behavior, and defer unsupported adjacent-domain workflows.

**Rationale:** Keeps Phase 0 safe and owner-reviewable while avoiding schema/business-rule expansion.

**Consequences:** Genuine correctness issues can be fixed, but new approval/accounting semantics need explicit scope/decisions.

---

## DEC-021 — Station operational time must come from station timezone metadata

**Status:** ACCEPTED

**Context:** Daily Operations shift times were using browser-local formatting.

**Chosen approach:** Format station operational times using the authoritative station timezone already present in station data. If missing/invalid, show a truthful unavailable value.

**Rationale:** Browser timezone can differ from station timezone and would make operational records misleading.

**Alternatives discussed:** Browser-local fallback or guessed/hard-coded timezone; rejected.

**Consequences:** Adjacent station-time displays should use the same canonical timezone source.

---

## DEC-022 — Distinguish test-harness failures from product defects before changing code

**Status:** ACCEPTED

**Context:** A3 meter-exception tests initially returned HTTP 500 because migrations were applied under the wrong local owner. Candidate and exact main both passed when the expected PostgreSQL 18/UTC/role setup was restored.

**Chosen approach:** Reproduce failures against exact main under equivalent environment prerequisites before classifying them as candidate regressions.

**Rationale:** Security-definer and ownership-sensitive tests can fail for harness reasons.

**Consequences:** Agents should not patch product code to compensate for an incorrectly configured integration environment.

---

## DEC-023 — Use isolated worktrees/branches for parallel agents

**Status:** ACCEPTED

**Context:** Multiple implementation/review streams run concurrently, and the primary repository may contain unrelated work.

**Chosen approach:** Feature agents use isolated worktrees/branches, avoid direct changes to `main`, and avoid stashing/resetting/deleting unrelated work.

**Rationale:** Prevents agents from overwriting one another and makes review/integration attributable.

**Consequences:** Integration must be revalidated after combining parallel changes.

---

## DEC-024 — Separate implementation and review responsibilities

**Status:** ACCEPTED

**Context:** Security/release work benefits from independent verification.

**Chosen approach:** Implementation agents produce scoped changes; independent review agents inspect actual files/diffs and do not merely trust implementation reports.

**Rationale:** Catches composition, shell, security, and source-fidelity issues that implementation self-checks missed.

**Consequences:** A green implementer report is not equivalent to an approved release gate when independent review is required.

---

## DEC-025 — Treat observability plan limits as a launch exception, not a pass

**Status:** TEMPORARY EXCEPTION

**Context:** Local observability definitions/panels/tests are green, but desired native production semantics are limited by the current Vercel plan. A paid alternative was declined.

**Chosen approach:** Launch under a documented exception while retaining the technical status as blocked/exception.

**Rationale:** Avoids falsely reporting unavailable production semantics as complete.

**Consequences:** Future status reporting must preserve the exception until the limitation is resolved or requirements change.

---

## DEC-026 — Treat the rate-limit staging E2E gap as an evidence exception

**Status:** TEMPORARY EXCEPTION

**Context:** Rate-limit implementation passes, but an upstream provider intercepts the request before the application’s target threshold behavior can be observed in staging.

**Chosen approach:** Preserve the implementation result and explicitly record the staging evidence limitation.

**Rationale:** The missing observation is provider/environment behavior, not proof that the implementation failed or passed end-to-end.

**Consequences:** Do not relabel this as a full E2E PASS.

---

## DEC-027 — Keep the dev-only transitive dependency advisory under a narrow time-bounded exception

**Status:** TEMPORARY EXCEPTION

**Context:** A reported advisory affects a dev-only transitive `braces` version with no available fixed upstream release at the documented snapshot.

**Chosen approach:** Use a narrow CI exception with a review date while keeping production-only high/critical audit clean.

**Rationale:** Avoids blocking release indefinitely on an unfixable dev-only transitive while preserving review pressure.

**Consequences:** The exception must not be generalized to unrelated advisories and should be re-evaluated when an upstream fix becomes available.

---

## DEC-028 — Do not create a production role solely to satisfy an audit spot check

**Status:** ACCEPTED

**Context:** Production role discovery found zero existing roles matching the proposed unrelated-role negative-probe criteria.

**Chosen approach:** Do not invent/create a production principal merely for testing. Preserve or strengthen the security evidence instead.

**Rationale:** Production access control should reflect application/runtime needs, not the convenience of one diagnostic assertion.

**Consequences:** The former single-role probe must be replaced by stronger
exhaustive evidence before the production flow relies on the revised check.

---

## DEC-029 — Replace unrelated-role spot-check ACL evidence with exhaustive grantee evidence

**Status:** ACCEPTED

**Context:** A review proved that the former function ACL checks covered
PUBLIC, app_runtime, first_user_provisioner, and one supplied unrelated role
but did not exhaustively reject every possible unexpected grantee.

**Chosen approach:** Use exhaustive `pg_proc` ACL inspection to reject any
explicit unexpected `EXECUTE` grantee and remove the arbitrary unrelated-role
prerequisite.

**Rationale:** This is strictly stronger than checking one unrelated role and
avoids creating a meaningless production role.

**Consequences:** The exhaustive validation and independent Access Review are
GREEN. The separate Stage 1 blocker is now diagnosed: its historical policy
assertion compared normalized `pg_policies.cmd` with raw `pg_policy.polcmd`.
The repository-local diagnostic is corrected; the external helper still
requires owner-applied correction and human retry.

---

## DEC-030 — Final owner handoff is blocked by any unresolved P0/P1 finding

**Status:** ACCEPTED

**Context:** Phase 0 aims for an owner-ready first version, not merely a deployable build.

**Chosen approach:** Final owner review occurs after access, integration, deployment, and production verification; any confirmed P0/P1 is remediated before handoff.

**Rationale:** Owner handoff should represent a trustworthy, usable product state.

**Consequences:** Phase 1 work remains deferred, but P0/P1 correctness/usability issues found in final QA are not deferred merely to hit a date.

---

## DEC-031 — Use the authenticated Neon production endpoint as the Stage 1 target invariant

**Status:** ACCEPTED

**Context:** The Stage 1 RLS/policy diagnostic could not previously prove that
the connection was the approved production database. Connection-supplied
`PGHOST`, `PGDATABASE`, `PGPORT`, `APP_ENV`, migration fingerprints, role
membership, and server version were not independent production identity
evidence. The human authenticated to the Neon control plane and established
the approved production project, branch, endpoint, and region metadata.

**Chosen approach:** Before `psql` executes, the diagnostic compares the
decoded process-local `PGHOST` from the existing DEC-011 bootstrap against the
exact approved endpoint host:
`ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech`.

Approved non-secret provider provenance:

- project: `shanda-fuel-production` (`plain-paper-48449309`)
- branch: `main` (`br-morning-dust-b270y3ry`)
- endpoint: `ep-polished-haze-b29kd207`
- region: `aws-eu-central-1`

**Rationale:** The exact endpoint host is the smallest independent invariant
that fits the reviewed process-local DEC-011 libpq bootstrap without adding a
second credential path, URI in argv, service indirection, or secret storage.

**Consequences:** A missing or different `PGHOST` is a pre-connect nonzero
failure and cannot reach catalog diagnostics. Endpoint replacement, project or
branch migration, or provider-region change requires a new reviewed canonical
decision before any future production diagnostic. These identifiers are
non-secret metadata; no API token, password, or connection string is recorded.

---

## DEC-032 — Fix Daily Operations accountability and close workflow semantics

**Status:** ACCEPTED

**Context:** “Supervisor” had been ambiguous between assigned shift personnel,
the person submitting records, and the person approving a close.

**Chosen approach:** The fixed workflow is Open Shift, Record Activity,
Reconcile, Supervisor Review, and Close Shift. The operator/cashier records
activity and submits the initial reconciliation. The Supervisor reviews,
investigates or resolves ordinary discrepancies where authorised, and approves
the shift/day close. Manager/admin users handle authorised exceptions and
overrides. Submitter/operator and approving Supervisor are distinct actors.

**Rationale:** Close accountability and audit evidence require the person who
entered or submitted operational data to remain distinguishable from the
person who approved the close.

**Consequences:** “Supervisor” has this fixed meaning and is not a generic
configurable role label. A future organisation/station policy may control
whether Supervisor approval is required before close, without changing the
meaning of the actor or weakening approval evidence.

---

## DEC-033 — Require customer identity before finalizing account sales

**Status:** ACCEPTED

**Context:** Account-sale customer identity and external references were not
previously fixed.

**Chosen approach:** A customer/account must be selected before an account sale
is finalized. An external/customer reference is optional by default and must be
captured before finalization when policy requires it. The customer/account
relationship is never optional.

**Rationale:** Account sales must remain attributable to an account while
allowing organisations to introduce reference requirements without rewriting
finalized records.

**Consequences:** Reference-required policy is configurable at bounded
organisation, station, customer, or account scope as supported by the domain.
Detailed accounting, credit-control, and tax treatment remain separate
decisions.

---

## DEC-034 — Preserve auditable approved-fuel authorization attribution

**Status:** ACCEPTED

**Context:** Approved-fuel transactions need a clear, reviewable reason and
authorization trail without freezing business category wording prematurely.

**Chosen approach:** Capture recipient, authorizer, reason/category, and
authorization/reference where applicable. Support bounded categories such as
staff benefit, customer authorization, company/internal use, and other
authorized use. Category labels may be administrator-configurable.

**Rationale:** Configurable categories support future business terminology, but
recipient and authorizer attribution are core audit facts and must not disappear.

**Consequences:** Authorization evidence is mandatory where the workflow
requires it. Detailed benefit, accounting, and tax policy remains unresolved
until separately specified.

---

## DEC-035 — Require core cash custody and bank-deposit evidence

**Status:** ACCEPTED

**Context:** Cash handover and bank deposit workflows lacked a fixed minimum
audit record.

**Chosen approach:** Record amount, handing-over/depositing person,
receiving/verifying person where applicable, date/time, and reference. A bank
deposit requires a bank/deposit reference. Supporting proof or attachment is
optional by default.

**Rationale:** These facts provide the minimum useful custody trail without
making optional evidence a prerequisite for every handover.

**Consequences:** An administrator may later require supporting proof or add
bounded reference fields, but core amount, actor attribution, timestamp, and
bank reference controls cannot be disabled where required by the workflow.

---

## DEC-036 — Sequence Phase 1 customer-account capability by owner priority

**Status:** ACCEPTED

**Context:** Phase 1 customer-account capability needed an explicit delivery
order.

**Chosen approach:** Prioritize credit and enforceable limits, prepaid monetary
value, statements, vehicles/drivers, prepaid litres, and benefits, in that
order.

**Rationale:** The sequence establishes the core monetary account model before
dependent quantity, relationship, and benefit features.

**Consequences:** This is implementation sequencing, not a complete accounting,
ledger, tax, credit-control, or authorization policy. Those details must still
be specified before write behavior is implemented.

---

## DEC-037 — Use fixed semantics with bounded configurable policy

**Status:** ACCEPTED

**Context:** The owner approved limited configurability while rejecting a
generic arbitrary workflow engine.

**Chosen approach:** Keep workflow semantics, tenant isolation, security,
audit integrity, accounting integrity, reconciliation evidence, and actor
attribution fixed. Allow only explicit bounded settings such as approval
requiredness, account-reference requiredness, approved-fuel categories, deposit
proof requiredness, variance thresholds, and optional close-summary sections.

**Rationale:** Small explicit settings preserve control integrity while allowing
station and organisation policy differences.

**Consequences:** Configuration must never weaken authorization, RLS, audit,
accounting, reconciliation, or core actor attribution. Do not add a generic
rules/workflow engine merely for configurability.

---

## DEC-038 — Make the close summary exception-first and approval-aware

**Status:** ACCEPTED

**Context:** The close summary should help an operator determine whether a
shift is clean rather than become an unprioritized reporting dashboard.

**Chosen approach:** Surface total sales, payment-method sales, account/credit
sales, expected and actual cash, cash variance, expenses, fuel/stock variance,
unresolved exceptions, and Supervisor approval/sign-off state where applicable.

**Rationale:** The summary should make balance, variance, unresolved work, and
approval state immediately understandable.

**Consequences:** Required reconciliation and audit sections cannot be hidden
by configuration. Optional sections and variance thresholds may be bounded
policy settings.

---

## DEC-039 — Make the default home dashboard operational-control and exception-first

**Status:** ACCEPTED

**Context:** The home dashboard needed a fixed purpose and audience without
turning it into a broad accounting/reporting surface or inventing unsupported
financial calculations.

**Chosen approach:** The default owner/supervisor home dashboard answers “How is
the operation performing today, and what needs my attention?” Its primary
headline metrics/status areas are today’s total sales, expected cash, actual
cash, cash variance, fuel/stock variance, account/credit sales, unresolved
exceptions, and shift approval/close status. The primary audience is the
owner, manager, and Supervisor subject to existing permissions.

The dashboard uses the user’s authorized/current operational scope under the
existing tenant, legal-entity, station, and navigation conventions. It must
not introduce a new authorization model or expose cross-tenant or unauthorized
data. Existing A10 reporting metrics and contracts are reused where they
support the bounded first slice. Missing source facts remain truthful
unavailable states until a reviewed read-model contract exists; no new tax,
GL, profitability, or other accounting calculation is created solely for the
dashboard.

**Rationale:** The owner needs operational control and visible exceptions first,
while the existing reporting model already provides supported read-only facts
for sales, cash evidence/variance, account-credit evidence, and inventory
variance. Approval/close and unresolved-exception presentation must remain
grounded in authoritative source state rather than inferred from presentation
data.

**Consequences:** M4-T02 may proceed with a bounded first read-only slice using
existing supported reporting contracts. A future administrator may configure
optional dashboard sections, display ordering, relevant station-specific cards,
and variance thresholds, but required security, reconciliation, exception, and
authorization behavior cannot be disabled. A generic workflow/rules engine is
not introduced for dashboard configuration.

## DEC-041 — Lock the Phase 1 customer lifecycle semantics

**Status:** ACCEPTED

**Context:** Phase 1 customer lifecycle work needed explicit product
semantics before bounded implementation could proceed. The owner resolved the
customer policy questions without selecting new accounting, tax, or FX rules.

**Chosen approach:**

- Credit is disabled unless a positive credit limit is explicitly configured;
  the limit is a hard cap by default and over-limit transactions are blocked.
  Any future manager/admin over-limit override must be explicit, authorized,
  and audited. Operators and Supervisors cannot silently change credit policy
  or limits.
- Money-value prepaid is the first prepaid model. Prepaid litres are a later,
  separate balance model, with no automatic conversion between them.
- Statements default to monthly calendar periods in the applicable
  tenant/station timezone. They are reporting artifacts and do not create
  postings, payments, or balance mutations.
- Customer transactions use the normal applicable station selling price.
  Customer-specific pricing is a later bounded contract; no margin, tax,
  discount, profitability, or new accounting calculation is invented here.
- Vehicle/driver restrictions are optional and disabled by default. When
  configured, eligibility is required before finalization; exceptions require
  manager/admin authorization and audit.
- Benefits are disabled by default, are the lowest lifecycle priority, and do
  not block the other customer capabilities. Any later benefit must have
  explicit eligibility/caps and cannot be redeemed as cash.
- Customer records may hold invoicing/contact/reference metadata, while
  existing approved tax behavior remains authoritative. Unresolved tax/
  accounting behavior stays a separate gate.
- Phase 1 uses one operational currency per tenant. Currency identifiers are
  persisted where durable monetary records require them; FX, exchange-rate
  management, and mixed-currency balances are out of scope.
- Customer lifecycle states are `ACTIVE`, `SUSPENDED`, and `CLOSED`.
  Customers with operational history are never hard-deleted. Suspended and
  closed customers remain readable but cannot initiate new account
  transactions.
- Owner/Admin manage customer configuration, credit limits, prepaid
  configuration, and lifecycle transitions subject to audit. Supervisors may
  review/use accounts but cannot alter credit/prepaid policy without a later
  explicit permission. Operators may select/use eligible customers in
  authorized operational workflows but cannot modify financial/account
  configuration. Every security-sensitive mutation has actor attribution and
  auditability.

**Rationale:** These rules establish fixed safety and lifecycle meaning while
leaving accounting/ledger details, tax treatment, FX, and later bounded
pricing/benefit contracts to their own reviewed scopes.

**Consequences:** M5-T01 is accepted for these bounded sub-contracts. The
existing A8 exact-decimal ledger and reservation boundary is reused. M5-T02
may proceed with positive credit-limit enforcement and active-customer/account
guards. Role-permission migration alignment, lifecycle transition commands,
monthly statement read-model details, and the explicitly deferred pricing,
vehicle/driver, benefits, tax, and FX contracts remain separately scoped.

## DEC-042 — Keep the non-runtime esbuild advisory under a narrow pre-production exception

**Status:** TEMPORARY EXCEPTION

**Context:** `pnpm audit --prod` reports the moderate `GHSA-67mh-4wv8-2f99`
advisory for `esbuild@0.18.20` through the transitive path
`.>better-auth>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild`.
The package is present through Better Auth's optional Drizzle Kit peer
resolution, but the vulnerable component is deprecated build/development
tooling and is not imported by the deployed application runtime. The existing
CI dependency gate blocks unexcepted high and critical advisories; it does not
block this moderate, non-runtime finding.

**Chosen approach:** Accept this advisory for the pre-production release
candidate only, with review by 2026-11-10. Do not add a broad audit suppression
or force an override across the deprecated loader chain. Reassess when the
upstream chain provides a safe `esbuild >=0.25.0` path.

**Rationale:** A patched esbuild release exists, but forcing it beneath the
deprecated `@esbuild-kit/core-utils` chain is a larger compatibility change
than this release requires. The advisory concerns an esbuild development
server capability, and the affected package is not reachable from the
deployed application runtime.

**Consequences:** The production-only high/critical audit remains clean and
the existing scoped high-advisory exception remains unchanged. This exception
must not be generalized to runtime dependencies or unrelated advisories, and
must be revisited before production promotion if the dependency path changes.


## 2026-10-18 — Separate cross-station viewing from station actions

At Jordan's request, an explicit All stations selection survives management navigation and remains reachable after selecting an individual station. Management overview routes may show authorized stations side by side. Individual station records and commands keep their existing station authorization and assurance requirements. Switching from a station record to All returns to that area's overview and drops record-specific URL filters. Opening a record supplies its station in the URL without changing the persisted viewing preference.

Cross-station presentation reuses existing server read services and streaming. Financial values retain exact decimal strings and currency; no new cross-currency totals or averaging rules are introduced. Supplier balances are presented once per legal entity. Route support is explicitly allowed, rather than changing the default policy for unknown routes.
