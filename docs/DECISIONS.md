# Shanda Fuel — Decision Log

## DEC-051 — A delivery needs a purchase order or a reason

Date: 2026-10-26. **Status:** ACCEPTED, on the explicit instruction of the project lead (reason
required "for audit purposes"). A fuel delivery cannot be confirmed unless it is linked to a purchase
order or carries a recorded no-PO reason (emergency purchase, bought for cash, supplier delivered
without an order, order not raised in time, or another reason with a note).

## DEC-050 — A price change takes effect at the first pump-meter reading

Date: 2026-10-26. **Status:** ACCEPTED, on the explicit instruction of the project lead
("go", with the earliest-reading rule stated). A new price starts, and the price it replaces ends, at
the earliest `PRICE_CHANGE` meter reading recorded for that change. All pumps are read for the old
price first, then for the new one; activation is refused if any pump was read after that instant.
Per-pump meter segments keep each pump's litres exact. Finance at TEI Oils has not yet confirmed this.

## DEC-049 — A price's requester may approve it when no one else could

Date: 2026-10-26. **Status:** ACCEPTED, on the explicit instruction of the project lead.
The person who asks for a price change may not approve it, unless nobody else at the station could:
no other active member holds `price.change.approve` there. Attendants do not hold that permission,
so a station with an owner and one attendant counts as a one-person station and the owner may
approve their own price. The moment a second approver exists the block applies again. This is the
same solo-operator rule already used for purchase orders, expenses, revaluations and reconciliations
(`src/platform/security/separation-of-duties.ts`). Step-up is still required.

## DEC-048 — Go-live housekeeping answers (ACCEPTED by the project lead in chat, 2026-10-24)

**Date:** 2026-10-24. **Status:** accepted. Recorded from the project lead's chat answers (24 Oct, 14:23 and later).

- **Byline:** keep "by ShandaHR".
- **Owner sign-off name and date:** not important for v1. The signature line in
  `docs/v1-owner-decisions-proposed.md` stays blank. The one fact to record is that the company is
  Triumph Energy, trading as T.E.I Oils (a customer of the platform, not its owner).
- **Alert emails:** leave for now. They stay switched off at go-live (ADR-020 still proposed).
- **Backup credential location:** a dedicated Cloudflare R2 bucket, separate from the app's file
  bucket. The backup job gets a write-only API key. The restore key is kept offline by the owner of
  the credential, not in Vercel. A stolen app key must not be able to read or delete backups.
- **Staff credit balance:** keep the rule already recorded under "Staff fuel benefit accounts": a
  monthly USD cap per staff member, no carry-over, and the month's cost entered as one expense.
- **Unused secrets:** may be deleted. Each one is listed and confirmed with the project lead before
  it is removed.

**Not decided:** the rates for the estimate.

## DEC-047 — Run v1 without paid multi-factor sign-in (ACCEPTED by the project lead in chat, 2026-10-24)

**Date:** 2026-10-24. **Status:** accepted, including the export fix below (approved in chat 2026-10-24). The fix is built on its own branch and is not merged.

**Decision (project lead, in chat):** Clerk charges for multi-factor sign-in. Do not pay for it for
now, and do not add a second sign-in provider. Switch MFA off (`REQUIRE_LOGIN_MFA=false`).

**What this changes:** DEC-043 and the earlier security plan assumed MFA for privileged actions. With
the switch off, sign-in is password only. The Owner's password re-check covers closing a business day
and deactivating staff (existing behaviour). Report exports and report-table runs still require a
second factor today, so they would be refused for everyone; the proposed fix is a small tested code
change letting the Owner's password re-check satisfy that check while the switch is off.

**Risk accepted:** a stolen password is enough to sign in. Mitigations: strong unique passwords,
Clerk password-breach check and rate limits, short sessions, the signed audit trail, few Owner and
Administrator accounts. Turning MFA on later needs only `REQUIRE_LOGIN_MFA=true` and a paid Clerk plan.

**Affected:** `docs/runbooks/v1-migration-and-release.md` section 3a, the skipped step-up browser
tests (they stay skipped until MFA or a test phone number exists), `src/modules/identity/step-up.ts`
(only if the export fix is approved).

## DEC-046 — The approved screens are locked (proposed as DEC-045 wording)

Date: 2026-10-23. **Status:** ACCEPTED on the owner's behalf, on the explicit instruction of the
project lead; owner sign-off reported by the project lead on 2026-10-23 (signed copy not yet filed; see `docs/v1-owner-decisions-proposed.md`). The screens
owner-approved on 2026-10-22 are locked. A file listed in `docs/ui-lock/manifest.json` may change
only with the owner's approval, recorded in the same change by regenerating the manifest. New
screens must be written for non-technical users. Guard: `src/platform/ui-lock/ui-lock.test.ts`.

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


### Unified expense integration — 2026-10-19

Jordan approved using incoming PR #146 expenses as the base and adding operational fact versions and shift links. Keep finance lifecycle and postings. No second editable shift-expense authority. Applied migration streams require explicit conversion, not checksum rewriting or blind renumbering. Existing posted corrections retain reversals.

## Staff fuel benefit accounts (S13, TEI Oils brief) — 2026-10-23

Status: ACCEPTED. The project lead reported on 2026-10-23 that the owner has signed off the v1 answers (docs/v1-owner-decisions-proposed.md, item 8). The signed copy is not in the repository; attach it or record the signer's name and date there.

Proposed default: a staff fuel benefit is a normal credit account (same ledger, statement and ageing) marked as a staff member's benefit in `app.customer_staff_benefit_terms` (migration 0070). The limit is monthly and in USD, set when the account is opened. The calendar month follows the station business date (station timezone). Payments do not give the month's allowance back; a reversed charge does. The limit is the account's credit limit, so it changes only through the existing credit-limit override approval (owner or administrator, not self-approved). Requests that would take the staff member past the month's limit are refused at fuel approval.

Not built, and not decided: a litre-based limit; posting the cost to expenses rather than sales (item 8 says "the cost goes to expenses"); any payroll deduction. Customer overdue alerts use a working default of 30 days since the oldest unpaid charge (`customerOverdueDays`); the owner's sign-off did not name a different figure as far as the project lead reported; customers have no per-customer credit period.

## Business structure, bank balance and audit fixes — 2026-10-25

Status: ACCEPTED by the project lead on 2026-10-25 (starting values and the points below, on the developer's recommendation). Made in response to the external platform audit of 2026-10-25 (audited on the live site, not on this branch). The project lead asked for everything fixable to be fixed and approved changes to the locked screens for customers, suppliers, expenses, settings, financial position, payouts, activity log, the reports menu and the daily-close button. The client owner has not yet seen these; every starting value can be changed in Settings.

- **Companies and stations can be added and edited by an owner or administrator** (Settings > Companies / Stations). DEC-044 did not cover this. A new station starts in setup (ONBOARDING) and is switched on through the existing station activation. The station code never changes; name and time zone can. Both commands need the permission (`legal_entity.manage`, `station.manage`) and a fresh identity check, and write a signed audit event. Companies cannot be removed.
- **Setup forms are shown to anyone who holds the permission**, not only to someone who has just re-verified. Station setup (fuel types, pumps) was hidden from owners who had not re-verified, with an untrue "no permission" message. The commands still require the fresh check, and the screen asks for it when saving.
- **The financial position uses a recorded bank balance**, not the cash deposited in the chosen dates (a movement). A bank balance is the closing balance copied from the bank statement, with its date, recorded under Settings > Payments; the latest one per account counts, history is kept and cannot be changed. If an active account has no balance the position shows no net and says why.
- **Fuel received but not yet invoiced is a liability line** in the financial position (at landed cost, from the existing purchasing exposure). If some of it has no cost recorded the net is not shown, as for stock.
- **A business day with no shifts cannot be closed.** A day on which nothing was recorded is closed by recording or marking its shifts not operated. A day with shifts still needs them completed, as before.
- **A supplier has a contact person, phone, email and a usual credit period (0 to 365 days)**, and a credit limit can be set when the supplier is added. Choosing credit on an invoice fills in that supplier's usual period, which can be changed; invoices still say cash or credit. A credit customer has an optional usual days to pay (0 to 365), set when the account is opened; it is a note and never blocks a sale.
- **Starting values changed to the audit's suggestions.** A daily report is late from the next day (0 days grace; was 1). Until an organisation saves its own purchasing policy, 0.5% is allowed on litres and nothing on price (was zero on both, which flagged every delivery). Organisations that already saved their own numbers keep them. Tank-variance tolerances are unchanged: the client sets them after about a month of real readings.
- **Closing a day with no approved reconciliation needs a reason.** Anyone allowed to close the day may do so, but must type why (at least 5 characters); the reason is written to the activity log, and the existing "report not submitted" reminder keeps showing until it is reconciled. The no-shifts block stays.
- **Not built, by decision: a vehicle and driver registry.** Credit fuel keeps vehicle and voucher as typed text. Revisit if the client's real use shows repeated typing errors.
- **Offline.** The app can be installed on a phone and shows a plain offline page when the connection drops. The service worker caches no pages or data, because a phone can be shared between staff. Unsent entries and the narrow daily-report queue are unchanged (DEC on offline queue still stands); queuing other screens, and moving drafts to IndexedDB, are not done.

## Getting a station to its first sale — 2026-10-26

Status: PROPOSED. The two rules below were chosen by the project lead in the working session of 2026-10-26 in answer to the audit retest (prices could not be approved and no shift could be opened); they are not yet in the owner's signed answers. The wording of the screens is the developer's.

- **The first price for a fuel at a station is activated without meter readings.** A meter boundary pins the old price to litres already sold when a price *changes*. A first price has nothing to pin, so approving and activating it needs no readings. "First" means no other price for that fuel at that station has ever been in use (state ACTIVE or SUPERSEDED, or an activation time). Every later price is a change and still needs every active nozzle of that fuel sealed. Before this, a first price could never go live, because activation refused when no boundaries existed.
- **The person who asked for a price may approve it only if nobody else could.** Same rule as purchase orders (DEC-045): the block applies while another active member holds price-approval rights at the station, and a sole owner is not locked out. The check is made on the server (`platform/security/separation-of-duties`), never from the screen. Approval, preparing and activating still need a fresh identity check.
- **Supplier amounts are counted from posted documents only.** "Not yet due", overdue, due-soon and the ageing used to include invoices that had been entered but not posted, while "Owed in total" (the ledger) did not, so the two disagreed. All now use posted documents; entered-but-unposted invoices and credit notes are listed on the supplier page as "Waiting to be posted" with a Post button. There is still no way to send one back: only posting and, once posted, reversing exist. Whether an entered invoice can be returned or deleted is not decided.
- **Opening the first shift.** The control room offers an active shift template (Day, Night) to open the day's first shift when none exists. Opening is refused by the server when the station's clock schedule needs a template start time that does not match the moment, which is shown as it is.
- **Screens changed under DEC-046** (owner approval given by the project lead in the same session, manifest re-baselined): the guided setup panel, the operations control room and the supplier detail page.


## Answers to the open TEI questions — 2026-10-26

Status: ACCEPTED by the project lead on 2026-10-26, on the developer's recommendations. They are starting values and rules; TEI can still correct them. Not yet in the owner's signed answers.

- **Sales by Attendant.** A shift worked by one attendant is credited to them; a shift worked by several is shown as a shared shift and never split; a shift with nobody recorded is listed apart. Already built (`reporting/sales-by-attendant.ts`); nothing to change.
- **Customer ageing and credit days.** Credit days are set per customer (default 30). Overdue counts from the charge date plus those days. The customer ageing keeps its existing buckets (current, 1-30, 31-60, 61-90, over 90 days), which the client set; they are counted past the credit days, so "current" means not yet due. Built: the account's credit days (30 when none is set) now drive both the ageing report and the overdue alert; a customer is overdue once the oldest unpaid charge is older than their days.
- **Tank tolerances and reminders.** Starting values: warning at 0.5% and exception at 1% of litres sold; dip readings at shift open and close; reminder 30 minutes before the shift ends. Built: a tank with no tolerance of its own is judged against 0.5% of the litres sold since the previous dip (watch beyond it, alert beyond 1%); a tank's own litres limit still wins. Built: a reminder alert for an open shift with no dip on a tank, 30 minutes after it opens and from 30 minutes before it ends. Not changed: the tank cards on the Inventory screen still show "Not checked" for a tank with no limit of its own.
- **Staff fuel and expenses.** Staff fuel is only a staff-benefit account (DEC above), never an expense. No staff-fuel expense category exists in the code.
- **ShandaHR link** stays deferred (DEC-044). **Offline** stays at daily-report drafts (DEC-045).
- **Expenses paid from till or EcoCash.** Accepted in principle: an expense records where it was paid from (till cash, EcoCash or bank), and till payments reduce expected cash at shift close. Built (migration 0076): an expense can be paid by EcoCash (source MOBILE_MONEY, transaction code required), beside bank and paid-back-to-staff. Not built: paying from the till. The cash disbursement exists only in the database; it has no screen or shift-close effect, so that needs its own design (how the payment enters the shift's expected cash).
- **Dashboard tiles:** today's sales, cash expected against counted, fuel in each tank, customers owing, suppliers owed, net position. Built: a Net position tile (the Financial Position figure, "Not available" with a reason when not every figure is known). The others were already there except fuel in each tank, which stays on the Inventory screen.
- **Valuation and purchasing.** Stock is valued at cost. A delivery shortage over 0.5% of delivered litres is flagged (the 0.5% starting value is already in place). Purchase orders stay optional. EcoCash and POS fees are recorded as an expense when the settlement arrives, against the net amount (not built).

Month-end expense entry (PROPOSED, 2026-10-23, pending owner sign-off; chosen by the project lead from three options, item 8 "the cost goes to expenses"): after a calendar month has ended at the station, an owner or administrator enters ONE expense per staff benefit account and station for the fuel taken that month, on `/customers/staff-benefit/expense`. The figure is the litres taken (fuel approvals dated in the station's own month) valued at the restated weighted-average cost per litre of that station's costed sales for the same month, not at the pump price. It is shown for confirmation, recomputed on the server when posted, and refused if it changed. The expense is dated on the month's last day, uses the operating category `STAFF_FUEL_BENEFIT` ("Staff fuel benefit", created on first use) and goes through the ordinary expense workflow (approval, posting, correction, reversal, audit `EXPENSE.STAFF_BENEFIT_SUBMITTED`). Nothing posts automatically. The same account, station and month cannot be entered twice while an earlier entry is active (the expense reference `STAFF-BENEFIT:<account>:<month>` is unique among active expenses at a station); reversing or rejecting it frees the month. No migration. Open points for the owner: (1) the benefit sale itself is still recorded as a credit sale at the pump price, so the account keeps showing what the staff member "owes"; how that balance is cleared (written off against this expense, deducted from pay, or left) is not decided and nothing here clears it; (2) a staff member who fuels at two stations gets one entry per station.

Not built, and not decided: a litre-based limit; automatic posting of the expense at each sale; any payroll deduction. Customer overdue alerts use a working default of 30 days since the oldest unpaid charge (`customerOverdueDays`); the owner's sign-off did not name a different figure as far as the project lead reported; customers have no per-customer credit period.

## Brief-gap decisions (TEI Oils audit) — 2026-10-25

Status: ACCEPTED. Given in chat by the project lead on 2026-10-25 while the brief-gap work (docs/audits/brief-gap-audit-2026-10-25.md) was built.

- **Bank balance — both sources.** The money in the bank can be typed in from the bank statement (append-only `app.bank_balance_statements`, migration 0072) and is also derivable from recorded deposits. The financial position uses the typed balance only when every active account has one, otherwise the deposit-based "Cash banked"; it never counts both and says which it used.
- **Corrections use revisions.** No command reverses an approved reconciliation or a bank deposit.
- **Staff-benefit cost** stays as already built (month-end expense entry, above). Nothing further now.
- **Tank tolerance.** The 20 L allowed difference is an accepted placeholder. Every active tank is always shown on the daily sheet and in the Stock Variances report, including a tank with no dip or no allowed difference set yet.
- **Supplier credit limit** stays warn-only and below-price sales stay flagged, not blocked (DEC-045; the brief says "prevent or flag").
- **Transporters** are recorded as suppliers (no new schema); a transporter set up as a supplier is counted under "Owed to suppliers". "Other liabilities" stay unrecorded until the owner supplies a real example.
- **Alert emails** are deferred for now (ADR-020 review, DNS and owner go-ahead still outstanding).
- **Stock variance** is computed against books that already include approved sales; approved sales are not subtracted again (fix in `production-reconciliation.ts`).

## Supervisor permissions — 2026-10-27

Status: ACCEPTED. Given in chat by the project lead on 2026-10-27. Implemented by migration 0085 (not applied to production). Refines DEC-032 and DEC-044 (the supervisor is the person responsible for a station). Supersedes the earlier contract-test rule that supervisors have no approval power.

- **Scope.** A supervisor sees only their own station(s): no All stations view.
- **Money.** Operational figures only. Profit, daily profit, financial position and the finance reports need the new `report.finance.view` (owner, administrator, finance). Operational reports (tank dips, stock movements, delivery variance, cash custody, daily reconciliation, sales by attendant, payment method) stay on `report.view`.
- **Approvals.** The supervisor approves the shift and day close (`reconciliation.approve`; the submitter can never approve their own). The supervisor approves an expense only up to a limit the owner sets and can change at any time (`expense_policies.supervisor_approval_limit`, edited with the other approval limits under `expense.policy.manage`, audited). No limit set means a supervisor approves nothing. Owner, administrator and finance approve any amount (`expense.approve.any_amount`). Purchase orders, price changes and credit limits are unchanged.
- **Station reads, read only.** `membership.view.station` (name and role of the people assigned to the station, through `app.station_staff_directory`) and `audit.view.station` (activity log filtered to events recorded against the station). No email, staff number or access details.
- **Not done.** Phone numbers are not stored anywhere for staff, so the station staff list cannot show them. The activity log shows only events whose audit metadata carries a station id; older or organisation-level events are not shown to a supervisor.
- **Hidden from a supervisor, found in the browser walk.** Regular (recurring) costs on the Expenses page, and the Customers and Staff fuel benefit menu items (customer accounts are read across the organisation, so a station-scoped supervisor was refused when opening them). The Reports station filter names the single station instead of "All stations".
- **Self-approval (2026-10-27, given in chat).** Only a sole owner may approve their own submission, because the owner is the last resort. With two active owners, each needs the other. Finance and administrators never approve their own and need another finance user, an administrator or an owner. Supervisors and attendants are never counted as the other approver, and never approve their own. Applies to every approval with separation of duties: expenses, purchase orders, price changes, reconciliation (close) and inventory cost revaluations. The approval permission is still required separately.

## Audit #2 judgement calls — 2026-10-30

Status: made autonomously while fixing docs/AUDIT2.md, per the brief ("record every judgement call and continue"). Each is small and reversible; the project lead should confirm or reverse.

- **A1, one source of truth for the station.** The saved-selection cookie (`shanda-fuel-context`) already existed and already survived every sidebar link. Options: (a) rebuild context handling, (b) close the two gaps found. Chose (b): a station or "all stations" named in the address is now saved by `GET /api/context`, and a company with one legal entity never has to name it. Rebuilding would risk what already works.
- **A2, what "missing" means.** A business day from a station's go-live to yesterday (plus the organisation's `report_grace_days`) is missing when any active shift template has no submitted, approved, posted or locked reconciliation. A station with no templates is expected to submit at least one report a day. Today is never missing. The old day-count in `dashboard-snapshot.ts` is deleted.
- **A3 and B7, one operating profit.** Operating profit is gross profit minus operating expenses, fixed costs and staff and management fuel at selling price (DEC-044), with the fuel posted on the day it was issued. `buildDailyProfit` is the single calculation: every day row is after staff fuel and the period is the sum of the days, so rows add up in every column. The audit's 33.34 gap between the dashboard and Daily Profit was exactly the staff fuel. The Station Daily Report gains a "Fuel given to staff" column.
- **A6, shift schedule guard.** One shift per template per business day, and no overlap with another running or planned shift at the station, enforced by a trigger (migration 0092) and checked first by `StartShift`. Judged on a shift's real window (a completed shift ends when it was completed; not-operated and cancelled shifts never count). Template-less ad-hoc shifts are exempt from the overlap rule, because real shifts always come from a template and many test fixtures deliberately reuse one window. A trigger rather than a unique index so existing rows can never make the migration fail.
- **A4, dips at shift close.** The last shift of a business day cannot be submitted until every active tank has a dip linked to that shift's report. "Last" is the template shift with the latest planned end; shifts without a template, cancelled and not-operated shifts are not held to it, for the same reason as A6. A stock difference already needed an explanation at submit, so a red variance was already covered. The dashboard's "tanks measured" counts a tank only when its latest dip is on the report's last day, the same test the shift report uses.
- **A5, locking a day.** A closed day cannot be locked while any shift report is draft, waiting for approval or sent back, or while an active tank has no dip for the day. The same query drives the disabled button and the server message. Older day-level reports (no shift attached) are not counted, so the earlier lock flow is unchanged.
- **C8, one "Add a tank" slot.** The brief says remove the duplicate card; you had earlier asked for placeholders so the row is not blank. Kept one placeholder, which satisfies both.
- **C2 and the lock wording.** "Waiting for management approval"; the lock note now says "Locking is permanent. After it, a change needs a recorded correction." instead of "named compensating workflows" (also C4).
- **B1, dashboard period.** One period (Today by default, This week from Monday, This month, or a custom range up to today) drives every total on the dashboard. It is kept in the page address, so the server reads the right records and a refresh or a shared link keeps it. The sales chart keeps its own 30-day window. Tiles that are a position right now (stock, cash held, card payments awaiting, owed by customers, owed to suppliers, net position, expenses awaiting approval, reports not submitted) say "As at [time]", in the same Harare business time the dashboard already uses. The old behaviour passed no dates to the daily figures, so they covered the month.
- **B9, how many decimals.** The database keeps its four decimals. On screen money is cents, in inputs a saved "450.0000" shows as "450.00" (a value with real digits past cents is shown exactly so that saving it again changes nothing), and Excel shows two decimals for money and litres and three for a price per litre while the cell value stays exact. CSV stays at recorded precision because it is the data export that other tools read, and the PDF is generated from it; say if you want both rounded too.
- **B6, one fixed-cost rule; the manual month step is removed.** Options: (a) keep "Add October 2026" as the one switch both screens respect, or (b) remove it. Chose (b). The report side already counted a regular cost from its start date, so (a) would have taken rent out of profit until someone pressed a button, which is the opposite of what an owner expects. A cost now counts from the day it starts: monthly amount ÷ days in that month for each active day, remainder on the month's last day, ending on its end date. The Expenses page shows regular costs apart from spending with what each has counted so far this month. The older recognition commands still exist in the API and a recorded recognition is honoured (never counted twice), but no screen asks anyone to use them.
- **B8, standard categories.** Created when the first station is activated, by code, leaving any existing category (and any name the owner changed) alone. Rent and wages are not here: they are regular costs with their own fixed-cost categories.
- **B4, custody is as at the end date.** The five places for cash are measured as at the report's end date over everything collected up to then, not just collections inside the chosen dates, because "where is the money now" cannot depend on the start date. Period flows (collected in the period, banked in the period) are unchanged and still used for period tiles. Cash in a location of type "transit" is shown as "with a collector"; cash in a collector or management location is "held by management".
- **B5, confirming a deposit.** Additive migration 0093 (bank_date, confirmation_reason on bank deposits). A reason of at least five characters is required whenever the confirmed amount differs from the deposit, up or down. "Banked with difference" is the new status label; the money still counts as banked only up to what the bank confirmed.
- **D2, the three new roles.** Auditor = every view permission and nothing else (so it can read all screens and change nothing, and cannot export, since an export is an action). Area manager = the supervisor's permissions plus the finance reports, over the stations assigned to it. Cash collector = receive collections, submit and accept handovers, see deposits. Added as role data (migration 0094) with no new permission code. A baseline mismatch between the code's and the database's permission lists was found and is documented, not changed here (docs/ROLES.md).
- **A7, Clerk keys.** The "secret key is invalid" error is a local key mismatch, not a code defect: keys must come from the same Clerk instance. Added `clerkEnvProblems` to name the problem in plain words; real keys are never committed or logged.


## Open questions found on the TEI Oils data — 2026-10-30

These need the owner's answer before anyone changes the code.

1. **Should cash paid out of the till on a shift (the Expenses step) count as an expense in profit?** Today it only lowers the cash expected. Profit counts recognised expenses only, so TEI Oils shows Expenses USD 0.00 on every day. Counting it is correct accounting, but it must not be counted twice when a formal expense for the same cost is also entered. Recommendation: recognise the shift expense when the report is approved, and let a formal expense link to it instead of duplicating it.
2. **Should a report page follow the station chosen at the top?** Today, with no station in the page's own filter it shows every station. Recommendation: when one station is chosen at the top and the address names none, start the report on that station, and say so in the filter bar.
3. **Stock books lag by one day.** Sales reach the books when a report is approved, so between close and approval the Tank page's Difference compares a dip with books that miss that day. The alert now waits; the Tank page does not. Recommendation: show the Tank page difference as "waiting for approval" in the same case.
